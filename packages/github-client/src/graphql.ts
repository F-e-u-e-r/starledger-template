import { RetryBudgetExhaustedError, RetryableResponseError } from './errors';
import type { RateLimit, RawRateLimit } from './rate-limit';
import { toRateLimit } from './rate-limit';
import { classifyError, RetryCoordinator } from './retry';

/**
 * Minimal callable contract for a GraphQL client. The real `@octokit/graphql`
 * instance satisfies it; tests inject a fake that returns fixtures.
 */
export type GraphqlClient = <T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasRateLimit(value: unknown): value is RawRateLimit {
  if (!isRecord(value)) return false;
  return (
    typeof value.cost === 'number' &&
    typeof value.remaining === 'number' &&
    typeof value.resetAt === 'string'
  );
}

/**
 * GitHub has occasionally returned a 2xx GraphQL response with no usable data
 * envelope. Validate it inside RetryCoordinator so an empty response retries
 * instead of escaping later as an unhelpful TypeError.
 */
function requireResponse<T>(
  value: unknown,
  operation: string,
  predicate: (response: Record<string, unknown>) => boolean,
): T {
  if (!isRecord(value) || !predicate(value)) {
    throw new RetryableResponseError(`GitHub GraphQL ${operation} returned an incomplete response`);
  }
  return value as T;
}

/** Raw GitHub GraphQL repository node, exactly as returned by STARS_PAGE_QUERY. */
export interface RawRepoNode {
  id: string;
  nameWithOwner: string;
  name: string;
  owner: { login: string };
  url: string;
  description: string | null;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  isDisabled: boolean;
  isFork: boolean;
  isPrivate: boolean;
  createdAt: string;
  pushedAt: string | null;
  updatedAt: string;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
  issues: { totalCount: number };
  latestRelease: { tagName: string; publishedAt: string | null; url: string } | null;
  releases: {
    nodes: Array<{ tagName: string; publishedAt: string | null; isPrerelease: boolean }>;
  };
}

export interface RawStarEdge {
  starredAt: string;
  node: RawRepoNode;
}

/** Cheap probe: reads isOverLimit + totalCount (and the viewer login). */
export const PROBE_QUERY = `query Probe {
  rateLimit { cost remaining resetAt }
  viewer {
    login
    starredRepositories(first: 1) {
      isOverLimit
      totalCount
    }
  }
}`;

/**
 * The repository node selection, shared by STARS_PAGE_QUERY (GraphQL path) and
 * NODES_QUERY (REST-fallback hydration). Both paths MUST select identical fields
 * so they produce identical RawRepoNode → identical CanonicalRepo → identical
 * stars.json bytes (invariant I2 / DET-1).
 */
export const REPO_NODE_FIELDS = `
  id
  nameWithOwner
  name
  owner { login }
  url
  description
  homepageUrl
  stargazerCount
  forkCount
  isArchived
  isDisabled
  isFork
  isPrivate
  createdAt
  pushedAt
  updatedAt
  primaryLanguage { name }
  licenseInfo { spdxId }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  issues(states: OPEN) { totalCount }
  latestRelease { tagName publishedAt url }
  releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
    nodes { tagName publishedAt isPrerelease }
  }
`;

export const STARS_PAGE_QUERY = `query Stars($cursor: String, $pageSize: Int!) {
  rateLimit { cost remaining resetAt }
  viewer {
    starredRepositories(first: $pageSize, after: $cursor, orderBy: { field: STARRED_AT, direction: DESC }) {
      isOverLimit
      totalCount
      pageInfo { hasNextPage endCursor }
      edges {
        starredAt
        node { ${REPO_NODE_FIELDS} }
      }
    }
  }
}`;

/** Hydrate repositories by node id (REST-fallback path). Returns Repository | null per id. */
export const NODES_QUERY = `query Hydrate($ids: [ID!]!) {
  rateLimit { cost remaining resetAt }
  nodes(ids: $ids) {
    __typename
    ... on Repository { ${REPO_NODE_FIELDS} }
  }
}`;

interface ProbeResponse {
  rateLimit: RawRateLimit;
  viewer: {
    login: string;
    starredRepositories: { isOverLimit: boolean; totalCount: number };
  };
}

export interface ProbeResult {
  login: string;
  isOverLimit: boolean;
  totalCount: number;
  rateLimit: RateLimit;
}

export async function probeStars(
  gql: GraphqlClient,
  coordinator: RetryCoordinator = new RetryCoordinator(),
): Promise<ProbeResult> {
  const res = await coordinator.run(
    async () =>
      requireResponse<ProbeResponse>(await gql(PROBE_QUERY), 'probe', (response) => {
        const viewer = response.viewer;
        return (
          hasRateLimit(response.rateLimit) &&
          isRecord(viewer) &&
          typeof viewer.login === 'string' &&
          isRecord(viewer.starredRepositories)
        );
      }),
    { classify: classifyError },
  );
  const conn = res.viewer.starredRepositories;
  return {
    login: res.viewer.login,
    isOverLimit: conn.isOverLimit,
    totalCount: conn.totalCount,
    rateLimit: toRateLimit(res.rateLimit),
  };
}

interface StarsPageResponse {
  rateLimit: RawRateLimit;
  viewer: {
    starredRepositories: {
      isOverLimit: boolean;
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: RawStarEdge[];
    };
  };
}

export interface GraphqlStarsResult {
  edges: RawStarEdge[];
  totalCount: number;
  isOverLimit: boolean;
  rateLimit: RateLimit | null;
  pages: number;
}

/**
 * Paginate viewer.starredRepositories fully via GraphQL (hydration is inline).
 * Used only when the probe reports isOverLimit === false.
 */
export async function fetchAllStarsGraphql(
  gql: GraphqlClient,
  opts: { pageSize?: number; maxPages?: number; coordinator?: RetryCoordinator } = {},
): Promise<GraphqlStarsResult> {
  const pageSize = opts.pageSize ?? 100;
  const coordinator = opts.coordinator ?? new RetryCoordinator();
  let cursor: string | null = null;
  let totalCount = 0;
  let isOverLimit = false;
  let rateLimit: RateLimit | null = null;
  let pages = 0;
  const edges: RawStarEdge[] = [];

  do {
    const res = await coordinator.run(
      async () =>
        requireResponse<StarsPageResponse>(
          await gql(STARS_PAGE_QUERY, { cursor, pageSize }),
          'star enumeration',
          (response) => {
            const viewer = response.viewer;
            return (
              hasRateLimit(response.rateLimit) &&
              isRecord(viewer) &&
              isRecord(viewer.starredRepositories)
            );
          },
        ),
      { classify: classifyError },
    );
    const conn = res.viewer.starredRepositories;
    isOverLimit = conn.isOverLimit;
    totalCount = conn.totalCount;
    rateLimit = toRateLimit(res.rateLimit);
    edges.push(...conn.edges);
    pages += 1;
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    if (opts.maxPages !== undefined && pages >= opts.maxPages) break;
  } while (cursor !== null);

  return { edges, totalCount, isOverLimit, rateLimit, pages };
}

interface NodesResponse {
  rateLimit: RawRateLimit;
  nodes: Array<(RawRepoNode & { __typename?: string }) | null>;
}

export interface HydrateTelemetry {
  requests: number;
  initialBatches: number;
  bisections: number;
  maxBisectionDepth: number;
  singletonFailures: number;
}

export interface HydrateResult {
  /** Successfully hydrated, keyed by `node.id` — NEVER positional. */
  nodesById: Map<string, RawRepoNode>;
  /** API explicitly returned null: repo deleted / private / inaccessible (→ removed_mid_run). */
  nullNodeIds: string[];
  /** Could not be fetched after retries + bisection to a singleton (→ degraded record). */
  failedNodeIds: string[];
  telemetry: HydrateTelemetry;
  rateLimit: RateLimit | null;
}

/**
 * Hydrate repository metadata via GraphQL `nodes(ids:)` in tunable batches
 * (default 75 — not an API contract). On a RETRYABLE exhaustion the batch is
 * bisected to isolate the problematic node(s); a singleton that still fails is
 * recorded in `failedNodeIds` rather than failing the whole run. Auth/schema/
 * rate-limit errors are NOT bisected — they propagate (one global failure must
 * not be amplified into many sub-requests).
 *
 * Successful nodes are merged by `node.id`; a null entry is mapped to its
 * REQUESTED id by position (GitHub returns nulls positionally), so a null in
 * the middle of a batch never shifts other entries.
 */
export async function hydrateByNodeIds(
  gql: GraphqlClient,
  ids: readonly string[],
  opts: { batchSize?: number; coordinator?: RetryCoordinator } = {},
): Promise<HydrateResult> {
  const batchSize = opts.batchSize ?? 75;
  const coordinator = opts.coordinator ?? new RetryCoordinator();
  const nodesById = new Map<string, RawRepoNode>();
  const nullNodeIds: string[] = [];
  const failedNodeIds: string[] = [];
  const telemetry: HydrateTelemetry = {
    requests: 0,
    initialBatches: Math.ceil(ids.length / batchSize),
    bisections: 0,
    maxBisectionDepth: 0,
    singletonFailures: 0,
  };
  let rateLimit: RateLimit | null = null;

  const hydrateBatch = async (batch: string[], depth: number): Promise<void> => {
    telemetry.requests += 1;
    let res: NodesResponse;
    try {
      res = await coordinator.run(
        async () =>
          requireResponse<NodesResponse>(
            await gql(NODES_QUERY, { ids: batch }),
            'hydration',
            (response) => hasRateLimit(response.rateLimit) && Array.isArray(response.nodes),
          ),
        { classify: classifyError },
      );
    } catch (err) {
      if (err instanceof RetryBudgetExhaustedError) {
        if (batch.length > 1) {
          telemetry.bisections += 1;
          telemetry.maxBisectionDepth = Math.max(telemetry.maxBisectionDepth, depth + 1);
          const mid = Math.floor(batch.length / 2);
          await hydrateBatch(batch.slice(0, mid), depth + 1);
          await hydrateBatch(batch.slice(mid), depth + 1);
          return;
        }
        telemetry.singletonFailures += 1;
        const onlyId = batch[0];
        if (onlyId !== undefined) failedNodeIds.push(onlyId);
        return;
      }
      throw err; // terminal / deferred — never bisect
    }

    rateLimit = toRateLimit(res.rateLimit);
    res.nodes.forEach((node, i) => {
      const requestedId = batch[i];
      if (requestedId === undefined) return;
      if (node === null || typeof node.id !== 'string') {
        nullNodeIds.push(requestedId);
        return;
      }
      nodesById.set(node.id, node);
    });
  };

  for (let i = 0; i < ids.length; i += batchSize) {
    await hydrateBatch(ids.slice(i, i + batchSize), 0);
  }

  return { nodesById, nullNodeIds, failedNodeIds, telemetry, rateLimit };
}
