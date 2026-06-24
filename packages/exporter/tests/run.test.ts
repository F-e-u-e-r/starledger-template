import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeferredError, type GraphqlClient, PushFailedError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { run } from '../src/index';
import { sha256 } from '../src/serialize';
import {
  FakeGit,
  fakeGraphql,
  fakeRest,
  httpError,
  makeRawEdge,
  makeRawNode,
  makeStarRow,
  makeTestCoordinator,
} from './helpers';

const NOW = () => new Date('2026-06-18T00:00:00Z');
const RATE = { cost: 1, remaining: 4999, resetAt: '2026-06-18T01:00:00Z' };

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'stars-run-'));
}

describe('run — validated git publication', () => {
  it('PUB-8 / HASH-1: a changed dataset is published in one commit; meta sha matches bytes', async () => {
    const dir = tmp();
    const git = new FakeGit();
    const edges = [makeRawEdge('2026-05-01T00:00:00Z', { id: 'R_1', nameWithOwner: 'a/1' })];
    const outcome = await run({
      outDir: dir,
      graphql: fakeGraphql({ isOverLimit: false, edges }),
      rest: fakeRest([]),
      git,
      coordinator: makeTestCoordinator(),
      now: NOW,
    });
    expect(outcome.published).toBe(true);
    expect(outcome.changed).toBe(true);
    expect(git.commits).toEqual([['stars.json', 'dataset-meta.json']]);
    const meta = JSON.parse(readFileSync(join(dir, 'run-meta.json'), 'utf8'));
    expect(meta.published).toBe(true);
    const datasetMeta = JSON.parse(readFileSync(join(dir, 'dataset-meta.json'), 'utf8'));
    expect(datasetMeta.stars_sha256).toBe(sha256(readFileSync(join(dir, 'stars.json'), 'utf8')));
  });

  it('PUB-4: an unchanged dataset is exit-0 with no new commit and published=false', async () => {
    const dir = tmp();
    const git = new FakeGit();
    const opts = {
      outDir: dir,
      graphql: fakeGraphql({
        isOverLimit: false,
        edges: [makeRawEdge('2026-05-01T00:00:00Z', { id: 'R_1', nameWithOwner: 'a/1' })],
      }),
      rest: fakeRest([]),
      git,
      coordinator: makeTestCoordinator(),
      now: NOW,
    };
    await run(opts);
    const second = await run(opts);
    expect(second.changed).toBe(false);
    expect(second.published).toBe(false);
    expect(git.commits).toHaveLength(1);
  });

  it('PUB-7: a push failure defers (exit 20), records push_succeeded=false, remote unchanged', async () => {
    const dir = tmp();
    const git = new FakeGit({ failPush: true });
    await expect(
      run({
        outDir: dir,
        graphql: fakeGraphql({
          isOverLimit: false,
          edges: [makeRawEdge('2026-05-01T00:00:00Z', { id: 'R_1', nameWithOwner: 'a/1' })],
        }),
        rest: fakeRest([]),
        git,
        coordinator: makeTestCoordinator(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(PushFailedError);
    const meta = JSON.parse(readFileSync(join(dir, 'run-meta.json'), 'utf8'));
    expect(meta.push_succeeded).toBe(false);
    expect(meta.published).toBe(false);
  });

  it('DEG-3: an over-threshold degraded run is deferred (exit 20) and not committed', async () => {
    const dir = tmp();
    const git = new FakeGit();
    // probe says over-limit; hydrate always times out → the single seed fails → ratio 1.0
    const graphql = (async (query: string) => {
      if (query.includes('query Probe')) {
        return {
          rateLimit: RATE,
          viewer: { login: 'o', starredRepositories: { isOverLimit: true, totalCount: 1 } },
        };
      }
      if (query.includes('query Hydrate')) throw httpError(504, 'timeout');
      throw new Error('unexpected query');
    }) as GraphqlClient;
    const rest = fakeRest([
      { rows: [makeStarRow('R_1', '2026-05-01T00:00:00Z')], linkHeader: null },
    ]);

    await expect(
      run({
        outDir: dir,
        graphql,
        rest,
        git,
        coordinator: makeTestCoordinator({ maxAttempts: 2 }),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DeferredError);
    expect(git.commits).toHaveLength(0);
    expect(existsSync(join(dir, 'stars.json'))).toBe(false);
    const meta = JSON.parse(readFileSync(join(dir, 'run-meta.json'), 'utf8'));
    expect(meta.published).toBe(false);
    expect(meta.counts.hydration_failed_publishable).toBe(1);
  });

  it('PRIV-1/2 + DEG-5/6: private filtered & removed counted separately; reconciliation holds', async () => {
    const dir = tmp();
    const nodesById = new Map([
      ['R_pub', makeRawNode({ id: 'R_pub', nameWithOwner: 'a/pub' })],
      ['R_priv', makeRawNode({ id: 'R_priv', nameWithOwner: 'a/priv', isPrivate: true })],
    ]);
    const rest = fakeRest([
      {
        rows: [
          makeStarRow('R_pub', '2026-05-01T00:00:00Z'),
          makeStarRow('R_priv', '2026-04-01T00:00:00Z'),
          makeStarRow('R_gone', '2026-03-01T00:00:00Z'),
        ],
        linkHeader: null,
      },
    ]);
    const outcome = await run({
      outDir: dir,
      graphql: fakeGraphql({ isOverLimit: true, nodesById }),
      rest,
      git: new FakeGit(),
      coordinator: makeTestCoordinator(),
      now: NOW,
    });
    expect(outcome.changed).toBe(true); // reconciliation held (no throw)
    const stars = JSON.parse(readFileSync(join(dir, 'stars.json'), 'utf8'));
    expect(stars.repos.map((r: { node_id: string }) => r.node_id)).toEqual(['R_pub']);
    const meta = JSON.parse(readFileSync(join(dir, 'run-meta.json'), 'utf8'));
    expect(meta.counts.private_filtered).toBe(1);
    expect(meta.counts.removed_mid_run).toBe(1);
    expect(meta.counts.hydration_failed_publishable).toBe(0);
    expect(meta.degraded).toBe(false);
    // PRIV warning surfaced but still published
    expect(meta.warnings.some((w: { code: string }) => w.code === 'PRIVATE_FILTERED')).toBe(true);
  });

  it('BUD-1: run-meta records GraphQL/REST budget and hydrate/retry telemetry', async () => {
    const dir = tmp();
    const edges = [makeRawEdge('2026-05-01T00:00:00Z', { id: 'R_1', nameWithOwner: 'a/1' })];
    await run({
      outDir: dir,
      graphql: fakeGraphql({ isOverLimit: false, edges }),
      rest: fakeRest([]),
      git: new FakeGit(),
      coordinator: makeTestCoordinator(),
      now: NOW,
    });
    const meta = JSON.parse(readFileSync(join(dir, 'run-meta.json'), 'utf8'));
    expect(meta.github_api.graphql.requests).toBeGreaterThanOrEqual(2); // probe + page(s)
    expect(meta.github_api.graphql.remaining).toBeGreaterThan(0);
    expect(meta.github_api.rest.requests).toBe(0);
    expect(meta.retry.global_cooldowns).toBe(0);
    expect(meta.hydrate.initial_batches).toBe(0); // GraphQL path: inline hydration
  });

  it('REL-GATE-2: a safety-gate failure (empty guard) produces no commit; previous data intact', async () => {
    const dir = tmp();
    const git = new FakeGit();
    // First run publishes one repo.
    await run({
      outDir: dir,
      graphql: fakeGraphql({
        isOverLimit: false,
        edges: [makeRawEdge('2026-05-01T00:00:00Z', { id: 'R_1', nameWithOwner: 'a/1' })],
      }),
      rest: fakeRest([]),
      git,
      coordinator: makeTestCoordinator(),
      now: NOW,
    });
    const before = readFileSync(join(dir, 'stars.json'), 'utf8');

    // Second run enumerates empty → empty guard defers, nothing committed.
    await expect(
      run({
        outDir: dir,
        graphql: fakeGraphql({ isOverLimit: false, edges: [] }),
        rest: fakeRest([]),
        git,
        coordinator: makeTestCoordinator(),
        now: NOW,
      }),
    ).rejects.toMatchObject({ exitCode: 20 });

    expect(git.commits).toHaveLength(1); // no second commit
    expect(readFileSync(join(dir, 'stars.json'), 'utf8')).toBe(before); // previous data intact
  });
});
