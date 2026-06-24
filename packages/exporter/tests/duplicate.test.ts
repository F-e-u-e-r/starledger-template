import {
  DuplicateConflictError,
  type RawRepoNode,
  type StarredPage,
  type StarredRestClient,
} from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { enumerate } from '../src/enumerate';
import { fakeGraphql, makeRawNode, makeStarRow, makeTestCoordinator } from './helpers';

/** A REST client whose data differs per full enumeration pass (page 1 starts a pass). */
function statefulRest(passes: StarredPage[][]): StarredRestClient {
  let pass = -1;
  return {
    async fetchStarredPage(page: number): Promise<StarredPage> {
      if (page === 1) pass += 1;
      const chosen = passes[Math.min(pass, passes.length - 1)];
      return chosen?.[page - 1] ?? { rows: [], linkHeader: null };
    },
  };
}

const nodesById = new Map<string, RawRepoNode>([
  ['R_1', makeRawNode({ id: 'R_1', nameWithOwner: 'a/1' })],
]);
const graphql = () => fakeGraphql({ isOverLimit: true, nodesById });

const conflictPass: StarredPage[] = [
  {
    rows: [makeStarRow('R_1', '2026-05-01T00:00:00Z'), makeStarRow('R_1', '2026-01-01T00:00:00Z')],
    linkHeader: null,
  },
];

describe('duplicate conflict handling (DUP-1..4)', () => {
  it('DUP-1: same node_id + same starred_at is a benign duplicate', async () => {
    const rest = statefulRest([
      [
        {
          rows: [
            makeStarRow('R_1', '2026-05-01T00:00:00Z'),
            makeStarRow('R_1', '2026-05-01T00:00:00Z'),
          ],
          linkHeader: null,
        },
      ],
    ]);
    const res = await enumerate(
      { graphql: graphql(), rest },
      { coordinator: makeTestCoordinator() },
    );
    expect(res.duplicateCount).toBe(1);
    expect(res.duplicateConflictCount).toBe(0);
    expect(res.restarted).toBe(false);
    expect(res.edges).toHaveLength(1);
  });

  it('DUP-2/DUP-3: a snapshot conflict triggers one restart, then proceeds', async () => {
    const cleanPass: StarredPage[] = [
      { rows: [makeStarRow('R_1', '2026-05-01T00:00:00Z')], linkHeader: null },
    ];
    const rest = statefulRest([conflictPass, cleanPass]);
    const res = await enumerate(
      { graphql: graphql(), rest },
      { coordinator: makeTestCoordinator() },
    );
    expect(res.restarted).toBe(true);
    expect(res.duplicateConflictCount).toBe(0);
    expect(res.edges).toHaveLength(1);
  });

  it('DUP-4: a persistent conflict fails closed', async () => {
    const rest = statefulRest([conflictPass, conflictPass]);
    await expect(
      enumerate({ graphql: graphql(), rest }, { coordinator: makeTestCoordinator() }),
    ).rejects.toBeInstanceOf(DuplicateConflictError);
  });
});
