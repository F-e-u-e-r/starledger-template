import { type GraphqlClient, hydrateByNodeIds, TerminalError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { httpError, makeRawNode, makeTestCoordinator } from './helpers';

const RATE = { cost: 1, remaining: 4999, resetAt: '2026-06-18T01:00:00Z' };

/** gql that 504s for batches larger than `maxOkSize`, else returns nodes. */
function sizeGatedGql(maxOkSize: number): GraphqlClient {
  return (async (_q: string, vars?: Record<string, unknown>) => {
    const ids = (vars?.ids as string[] | undefined) ?? [];
    if (ids.length > maxOkSize) throw httpError(504, 'timeout');
    return { rateLimit: RATE, nodes: ids.map((id) => makeRawNode({ id })) };
  }) as GraphqlClient;
}

/** gql that 504s for any batch containing a poison id, else returns nodes. */
function poisonGql(poison: string): GraphqlClient {
  return (async (_q: string, vars?: Record<string, unknown>) => {
    const ids = (vars?.ids as string[] | undefined) ?? [];
    if (ids.includes(poison)) throw httpError(504, 'timeout');
    return { rateLimit: RATE, nodes: ids.map((id) => makeRawNode({ id })) };
  }) as GraphqlClient;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `R_${i + 1}`);

describe('hydrate bisection (BIS-1..6)', () => {
  it('BIS-1: a large timing-out batch is bisected until every node succeeds', async () => {
    const res = await hydrateByNodeIds(sizeGatedGql(20), ids(75), {
      batchSize: 75,
      coordinator: makeTestCoordinator({ maxAttempts: 2 }),
    });
    expect(res.nodesById.size).toBe(75);
    expect(res.failedNodeIds).toHaveLength(0);
    expect(res.telemetry.bisections).toBeGreaterThan(0);
    expect(res.telemetry.maxBisectionDepth).toBeGreaterThan(0);
  });

  it('BIS-2: a single poison node is isolated; the rest hydrate', async () => {
    const list = [...ids(8), 'R_poison'];
    const res = await hydrateByNodeIds(poisonGql('R_poison'), list, {
      batchSize: 9,
      coordinator: makeTestCoordinator({ maxAttempts: 2 }),
    });
    expect(res.failedNodeIds).toEqual(['R_poison']);
    expect(res.nodesById.size).toBe(8);
    expect(res.telemetry.singletonFailures).toBe(1);
  });

  it('BIS-3: out-of-order nodes still merge by node_id', async () => {
    const gql = (async (_q: string, vars?: Record<string, unknown>) => {
      const list = (vars?.ids as string[] | undefined) ?? [];
      return { rateLimit: RATE, nodes: list.map((id) => makeRawNode({ id })).reverse() };
    }) as GraphqlClient;
    const res = await hydrateByNodeIds(gql, ids(3), { coordinator: makeTestCoordinator() });
    expect([...res.nodesById.keys()].sort()).toEqual(['R_1', 'R_2', 'R_3']);
  });

  it('BIS-4: a null in the middle does not shift entries', async () => {
    const gql = (async (_q: string, vars?: Record<string, unknown>) => {
      const list = (vars?.ids as string[] | undefined) ?? [];
      return {
        rateLimit: RATE,
        nodes: list.map((id) => (id === 'R_2' ? null : makeRawNode({ id }))),
      };
    }) as GraphqlClient;
    const res = await hydrateByNodeIds(gql, ids(3), { coordinator: makeTestCoordinator() });
    expect(res.nullNodeIds).toEqual(['R_2']);
    expect(res.nodesById.size).toBe(2);
  });

  it('BIS-5: an auth/schema error is NOT bisected — it propagates', async () => {
    let calls = 0;
    const gql = (async () => {
      calls += 1;
      throw httpError(401, 'bad credentials');
    }) as GraphqlClient;
    await expect(
      hydrateByNodeIds(gql, ids(4), { batchSize: 4, coordinator: makeTestCoordinator() }),
    ).rejects.toBeInstanceOf(TerminalError);
    expect(calls).toBe(1); // single request: no retry, no split
  });

  it('BIS-6: a singleton that keeps failing is marked hydration-failed', async () => {
    const gql = (async () => {
      throw httpError(504, 'timeout');
    }) as GraphqlClient;
    const res = await hydrateByNodeIds(gql, ['R_1'], {
      batchSize: 1,
      coordinator: makeTestCoordinator({ maxAttempts: 2 }),
    });
    expect(res.failedNodeIds).toEqual(['R_1']);
    expect(res.telemetry.singletonFailures).toBe(1);
  });
});
