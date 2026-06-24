import { type GraphqlClient, hydrateByNodeIds, type RawRepoNode } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { mergeSeeds } from '../src/hydrate';
import { makeRawNode, makeSeed, makeTestCoordinator } from './helpers';

const RATE = { cost: 1, remaining: 4999, resetAt: '2026-06-18T01:00:00Z' };

/** Fake Hydrate query returning a caller-controlled nodes array (order / nulls). */
function fakeHydrate(nodesFor: (ids: string[]) => Array<RawRepoNode | null>): GraphqlClient {
  return (async (_query: string, variables?: Record<string, unknown>) => ({
    rateLimit: RATE,
    nodes: nodesFor((variables?.ids as string[] | undefined) ?? []),
  })) as GraphqlClient;
}

describe('hydrateByNodeIds', () => {
  it('retries an empty GraphQL hydrate response before processing the batch', async () => {
    let calls = 0;
    const gql = (async (_query: string, variables?: Record<string, unknown>) => {
      calls += 1;
      if (calls === 1) return undefined;
      const ids = (variables?.ids as string[] | undefined) ?? [];
      return { rateLimit: RATE, nodes: ids.map((id) => makeRawNode({ id })) };
    }) as GraphqlClient;

    const result = await hydrateByNodeIds(gql, ['R_1'], { coordinator: makeTestCoordinator() });

    expect(calls).toBe(2);
    expect([...result.nodesById.keys()]).toEqual(['R_1']);
  });

  it('HYD-1: merges by node_id regardless of returned order', async () => {
    const byId = new Map<string, RawRepoNode>([
      ['R_1', makeRawNode({ id: 'R_1', nameWithOwner: 'a/1' })],
      ['R_2', makeRawNode({ id: 'R_2', nameWithOwner: 'a/2' })],
      ['R_3', makeRawNode({ id: 'R_3', nameWithOwner: 'a/3' })],
    ]);
    const gql = fakeHydrate((ids) => ids.map((id) => byId.get(id) ?? null).reverse());
    const { nodesById } = await hydrateByNodeIds(gql, ['R_1', 'R_2', 'R_3'], {
      coordinator: makeTestCoordinator(),
    });
    expect(nodesById.get('R_1')?.nameWithOwner).toBe('a/1');
    expect(nodesById.get('R_2')?.nameWithOwner).toBe('a/2');
    expect(nodesById.get('R_3')?.nameWithOwner).toBe('a/3');
  });

  it('HYD-2: a null in the middle is tracked, not shifted', async () => {
    const gql = fakeHydrate((ids) =>
      ids.map((id) => (id === 'R_2' ? null : makeRawNode({ id, nameWithOwner: `a/${id}` }))),
    );
    const { nodesById, nullNodeIds } = await hydrateByNodeIds(gql, ['R_1', 'R_2', 'R_3'], {
      coordinator: makeTestCoordinator(),
    });
    expect(nullNodeIds).toEqual(['R_2']);
    expect(nodesById.has('R_2')).toBe(false);
    expect(nodesById.get('R_1')?.nameWithOwner).toBe('a/R_1');
    expect(nodesById.get('R_3')?.nameWithOwner).toBe('a/R_3');
  });

  it('respects the configured batch size', async () => {
    const batches: number[] = [];
    const gql = fakeHydrate((ids) => {
      batches.push(ids.length);
      return ids.map((id) => makeRawNode({ id }));
    });
    await hydrateByNodeIds(gql, ['R_1', 'R_2', 'R_3', 'R_4', 'R_5'], {
      batchSize: 2,
      coordinator: makeTestCoordinator(),
    });
    expect(batches).toEqual([2, 2, 1]);
  });
});

describe('mergeSeeds', () => {
  it('a null node becomes removed_mid_run; others unaffected', () => {
    const seeds = [
      makeSeed('R_1', '2026-05-01T00:00:00Z'),
      makeSeed('R_2', '2026-04-01T00:00:00Z'),
    ];
    const nodesById = new Map<string, RawRepoNode>([
      ['R_1', makeRawNode({ id: 'R_1', nameWithOwner: 'a/1' })],
    ]);
    const merged = mergeSeeds(seeds, { nodesById, nullNodeIds: ['R_2'], failedNodeIds: [] });
    expect(merged.edges.map((e) => e.node.id)).toEqual(['R_1']);
    expect(merged.removedMidRun).toBe(1);
    expect(merged.failedRecords).toHaveLength(0);
  });

  it('HYD-3: uses the hydrated (current) name after a rename/transfer', () => {
    const seeds = [makeSeed('R_1', '2026-05-01T00:00:00Z')];
    const nodesById = new Map<string, RawRepoNode>([
      ['R_1', makeRawNode({ id: 'R_1', nameWithOwner: 'neworg/newname', name: 'newname' })],
    ]);
    const { edges } = mergeSeeds(seeds, { nodesById, nullNodeIds: [], failedNodeIds: [] });
    expect(edges[0]?.node.nameWithOwner).toBe('neworg/newname');
    expect(edges[0]?.starredAt).toBe('2026-05-01T00:00:00Z');
  });

  it('a failed node with identity becomes a publishable degraded record', () => {
    const seeds = [makeSeed('R_x', '2026-05-01T00:00:00Z')];
    const merged = mergeSeeds(seeds, {
      nodesById: new Map(),
      nullNodeIds: [],
      failedNodeIds: ['R_x'],
    });
    expect(merged.failedRecords).toHaveLength(1);
    expect(merged.failedRecords[0]?.hydration_status).toBe('failed');
    expect(merged.failedRecords[0]?.name_with_owner).toBe('acme/R_x');
    expect(merged.failedRecords[0]?.unavailable_fields.length).toBeGreaterThan(0);
  });

  it('a failed node WITHOUT identity is dropped', () => {
    const seeds = [makeSeed('R_x', '2026-05-01T00:00:00Z', { name_with_owner: null, url: null })];
    const merged = mergeSeeds(seeds, {
      nodesById: new Map(),
      nullNodeIds: [],
      failedNodeIds: ['R_x'],
    });
    expect(merged.failedRecords).toHaveLength(0);
    expect(merged.droppedUnidentifiable).toBe(1);
  });
});
