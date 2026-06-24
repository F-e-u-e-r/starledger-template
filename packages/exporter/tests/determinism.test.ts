import type { RawRepoNode, RawStarEdge, Seed } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { mergeSeeds } from '../src/hydrate';
import { normalizeEdge } from '../src/normalize';
import { serializeStars, sortRepos } from '../src/serialize';
import { makeRawNode, makeRepo } from './helpers';

const repos = [
  makeRepo({ node_id: 'R_c', starred_at: '2026-03-01T00:00:00Z' }),
  makeRepo({ node_id: 'R_a', starred_at: '2026-05-01T00:00:00Z' }),
  makeRepo({ node_id: 'R_b', starred_at: '2026-05-01T00:00:00Z' }), // ties with R_a on starred_at
  makeRepo({ node_id: 'R_d', starred_at: '2026-01-01T00:00:00Z' }),
];

describe('deterministic serialization (DET-2)', () => {
  it('is identical across repeated runs', () => {
    expect(serializeStars(repos)).toBe(serializeStars(repos));
  });

  it('is independent of input order', () => {
    const shuffled = [repos[1]!, repos[3]!, repos[0]!, repos[2]!];
    expect(serializeStars(shuffled)).toBe(serializeStars(repos));
  });

  it('sorts by starred_at DESC, then node_id ASC as tiebreak', () => {
    const order = sortRepos(repos).map((r) => r.node_id);
    expect(order).toEqual(['R_a', 'R_b', 'R_c', 'R_d']);
  });

  it('emits a single trailing newline and 2-space indent', () => {
    const out = serializeStars(repos);
    expect(out.endsWith('}\n')).toBe(true);
    expect(out).toContain('\n  "schema_version"');
  });

  it('round-trips: re-serializing parsed output is stable', () => {
    const once = serializeStars(repos);
    const parsed = JSON.parse(once) as { repos: Parameters<typeof serializeStars>[0] };
    expect(serializeStars(parsed.repos)).toBe(once);
  });
});

describe('execution-path independence (DET-1)', () => {
  // The same logical dataset, expressed once as GraphQL star edges and once as
  // REST seeds + hydrated nodes, must serialize to byte-identical stars.json.
  const nodes: Array<{ starredAt: string; node: RawRepoNode }> = [
    {
      starredAt: '2026-05-01T00:00:00Z',
      node: makeRawNode({
        id: 'R_a',
        nameWithOwner: 'a/alpha',
        name: 'alpha',
        primaryLanguage: { name: 'Go' },
        repositoryTopics: { nodes: [{ topic: { name: 'cli' } }] },
        latestRelease: {
          tagName: 'v1.0.0',
          publishedAt: '2026-04-01T00:00:00Z',
          url: 'https://x/r',
        },
      }),
    },
    {
      starredAt: '2026-03-01T00:00:00Z',
      node: makeRawNode({ id: 'R_b', nameWithOwner: 'b/beta', name: 'beta' }),
    },
  ];

  it('GraphQL path and REST-fallback path produce identical bytes', () => {
    // GraphQL path: edges normalize directly.
    const graphqlEdges: RawStarEdge[] = nodes.map((n) => ({
      starredAt: n.starredAt,
      node: n.node,
    }));
    const fromGraphql = serializeStars(graphqlEdges.map(normalizeEdge));

    // REST path: seeds (identity + starred_at) hydrated by node_id, then merged.
    const seeds: Seed[] = nodes.map((n) => ({
      node_id: n.node.id,
      starred_at: n.starredAt,
      name_with_owner: n.node.nameWithOwner,
      url: n.node.url,
    }));
    const nodesById = new Map(nodes.map((n) => [n.node.id, n.node]));
    const merged = mergeSeeds(seeds, { nodesById, nullNodeIds: [], failedNodeIds: [] });
    const fromRest = serializeStars(merged.edges.map(normalizeEdge));

    expect(fromRest).toBe(fromGraphql);
  });
});
