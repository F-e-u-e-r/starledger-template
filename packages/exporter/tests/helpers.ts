import {
  type GraphqlClient,
  type RawRepoNode,
  type RawStarEdge,
  type RetryConfig,
  RetryCoordinator,
  type Seed,
  type StarRow,
  type StarredPage,
  type StarredRestClient,
} from '@starred/github-client';
import type { CanonicalRepo } from '@starred/schema';
import type { GitPublisher } from '../src/git';

const RATE_LIMIT = { cost: 1, remaining: 4999, resetAt: '2026-06-18T01:00:00Z' };

/** Inspectable fake GitPublisher; can simulate commit/push failure. */
export class FakeGit implements GitPublisher {
  readonly commits: string[][] = [];
  pushes = 0;
  constructor(private readonly opts: { failPush?: boolean; failCommit?: boolean } = {}) {}
  async commit(files: readonly string[]): Promise<void> {
    if (this.opts.failCommit) throw new Error('simulated commit failure');
    this.commits.push([...files]);
  }
  async push(): Promise<void> {
    if (this.opts.failPush) throw new Error('simulated push failure');
    this.pushes += 1;
  }
}

/** A valid baseline CanonicalRepo; override fields per test. */
export function makeRepo(overrides: Partial<CanonicalRepo> = {}): CanonicalRepo {
  return {
    node_id: 'R_base',
    name_with_owner: 'acme/base',
    owner: 'acme',
    name: 'base',
    url: 'https://github.com/acme/base',
    description: null,
    homepage_url: null,
    primary_language: null,
    topics: [],
    license_spdx: null,
    stargazer_count: 0,
    fork_count: 0,
    open_issues_count: 0,
    is_archived: false,
    is_disabled: false,
    is_fork: false,
    created_at: '2020-01-01T00:00:00Z',
    pushed_at: null,
    updated_at: '2020-01-02T00:00:00Z',
    latest_stable_release: null,
    latest_any_release: null,
    starred_at: '2026-01-01T00:00:00Z',
    hydration_status: 'ok',
    unavailable_fields: [],
    ...overrides,
  };
}

/** A valid baseline raw GraphQL repo node; override fields per test. */
export function makeRawNode(overrides: Partial<RawRepoNode> = {}): RawRepoNode {
  return {
    id: 'R_base',
    nameWithOwner: 'acme/base',
    name: 'base',
    owner: { login: 'acme' },
    url: 'https://github.com/acme/base',
    description: null,
    homepageUrl: null,
    stargazerCount: 0,
    forkCount: 0,
    isArchived: false,
    isDisabled: false,
    isFork: false,
    isPrivate: false,
    createdAt: '2020-01-01T00:00:00Z',
    pushedAt: null,
    updatedAt: '2020-01-02T00:00:00Z',
    primaryLanguage: null,
    licenseInfo: null,
    repositoryTopics: { nodes: [] },
    issues: { totalCount: 0 },
    latestRelease: null,
    releases: { nodes: [] },
    ...overrides,
  };
}

export function makeRawEdge(
  starredAt: string,
  nodeOverrides: Partial<RawRepoNode> = {},
): RawStarEdge {
  return { starredAt, node: makeRawNode(nodeOverrides) };
}

export function makeStarRow(
  nodeId: string | null,
  starredAt: string | null,
  identity: { full_name?: string | null; html_url?: string | null } = {},
): StarRow {
  return {
    starred_at: starredAt,
    repo: {
      node_id: nodeId,
      full_name: identity.full_name ?? (nodeId ? `acme/${nodeId}` : null),
      html_url: identity.html_url ?? (nodeId ? `https://github.com/acme/${nodeId}` : null),
    },
  };
}

export function makeSeed(nodeId: string, starredAt: string, identity: Partial<Seed> = {}): Seed {
  return {
    node_id: nodeId,
    starred_at: starredAt,
    name_with_owner: `acme/${nodeId}`,
    url: `https://github.com/acme/${nodeId}`,
    ...identity,
  };
}

/**
 * Fake GraphQL client answering Probe, Stars, and Hydrate (nodes) by operation
 * name. Hydrate returns nodes positionally for the requested ids.
 */
export function fakeGraphql(opts: {
  isOverLimit: boolean;
  totalCount?: number;
  edges?: RawStarEdge[];
  nodesById?: ReadonlyMap<string, RawRepoNode>;
}): GraphqlClient {
  const totalCount = opts.totalCount ?? opts.edges?.length ?? opts.nodesById?.size ?? 0;
  return (async (query: string, variables?: Record<string, unknown>) => {
    if (query.includes('query Probe')) {
      return {
        rateLimit: RATE_LIMIT,
        viewer: {
          login: 'octocat',
          starredRepositories: { isOverLimit: opts.isOverLimit, totalCount },
        },
      };
    }
    if (query.includes('query Hydrate')) {
      const ids = (variables?.ids as string[] | undefined) ?? [];
      return { rateLimit: RATE_LIMIT, nodes: ids.map((id) => opts.nodesById?.get(id) ?? null) };
    }
    return {
      rateLimit: RATE_LIMIT,
      viewer: {
        starredRepositories: {
          isOverLimit: opts.isOverLimit,
          totalCount,
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: opts.edges ?? [],
        },
      },
    };
  }) as GraphqlClient;
}

/** Fake REST client serving predefined pages (1-based). */
export function fakeRest(pages: readonly StarredPage[]): StarredRestClient {
  return {
    async fetchStarredPage(page: number): Promise<StarredPage> {
      return pages[page - 1] ?? { rows: [], linkHeader: null };
    },
  };
}

/** An Octokit-shaped HTTP error for classifier-driven tests. */
export function httpError(
  status: number,
  message = `HTTP ${status}`,
  headers: Record<string, string> = {},
): Error {
  const err = new Error(message) as Error & {
    status: number;
    response: { headers: Record<string, string> };
  };
  err.status = status;
  err.response = { headers };
  return err;
}

/** A coordinator whose clock advances by the (instant) sleep amount: fast + deterministic. */
export function makeTestCoordinator(config: Partial<RetryConfig> = {}): RetryCoordinator {
  let clock = 0;
  return new RetryCoordinator({
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    random: () => 0,
    config,
  });
}
