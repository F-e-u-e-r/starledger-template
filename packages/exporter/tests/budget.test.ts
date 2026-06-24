import { type GraphqlClient, RateLimitInsufficientError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { enumerate } from '../src/enumerate';
import { fakeGraphql, fakeRest, makeRawEdge, makeTestCoordinator } from './helpers';

function probeWithRemaining(remaining: number): GraphqlClient {
  return (async (query: string) => {
    if (query.includes('query Probe')) {
      return {
        rateLimit: { cost: 1, remaining, resetAt: '2026-06-18T01:00:00Z' },
        viewer: { login: 'o', starredRepositories: { isOverLimit: false, totalCount: 1 } },
      };
    }
    return {
      rateLimit: { cost: 1, remaining, resetAt: '2026-06-18T01:00:00Z' },
      viewer: {
        starredRepositories: {
          isOverLimit: false,
          totalCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [makeRawEdge('2026-05-01T00:00:00Z', { id: 'R_1', nameWithOwner: 'a/1' })],
        },
      },
    };
  }) as GraphqlClient;
}

describe('budget reserve floor (BUD-2)', () => {
  it('defers (exit 20) when GraphQL remaining is below the reserve floor', async () => {
    await expect(
      enumerate(
        { graphql: probeWithRemaining(10), rest: fakeRest([]) },
        { coordinator: makeTestCoordinator(), reserveFloor: 100 },
      ),
    ).rejects.toBeInstanceOf(RateLimitInsufficientError);
  });

  it('proceeds when remaining is above the reserve floor', async () => {
    const result = await enumerate(
      { graphql: fakeGraphql({ isOverLimit: false, edges: [] }), rest: fakeRest([]) },
      { coordinator: makeTestCoordinator(), reserveFloor: 100 },
    );
    expect(result.source).toBe('graphql');
  });

  it('reserve floor of 0 disables the guard', async () => {
    const result = await enumerate(
      { graphql: probeWithRemaining(1), rest: fakeRest([]) },
      { coordinator: makeTestCoordinator(), reserveFloor: 0 },
    );
    expect(result.source).toBe('graphql');
  });
});
