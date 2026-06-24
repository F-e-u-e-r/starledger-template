import {
  DuplicateConflictError,
  enumerateStarsRest,
  ExporterError,
  fetchAllStarsGraphql,
  type GraphqlClient,
  type HydrateTelemetry,
  hydrateByNodeIds,
  probeStars,
  RateLimitInsufficientError,
  type RateLimit,
  type RawStarEdge,
  RetryBudgetExhaustedError,
  type RetryCoordinator,
  type StarredRestClient,
} from '@starred/github-client';
import type { CanonicalRepo, EnumerationSource } from '@starred/schema';
import { mergeSeeds } from './hydrate';

export interface EnumerateDeps {
  graphql: GraphqlClient;
  rest: StarredRestClient;
}

export interface EnumerationResult {
  edges: RawStarEdge[];
  failedRecords: CanonicalRepo[];
  source: EnumerationSource;
  isOverLimit: boolean;
  totalCountReported: number;
  enumeratedCount: number;
  enumeratedAfterDedup: number;
  removedMidRun: number;
  droppedUnidentifiable: number;
  duplicateCount: number;
  duplicateConflictCount: number;
  restarted: boolean;
  hydrateTelemetry: HydrateTelemetry;
  rateLimit: RateLimit | null;
  graphqlRequests: number;
  restRequests: number;
  restRemaining: number | null;
  restResetAt: string | null;
}

const EMPTY_HYDRATE: HydrateTelemetry = {
  requests: 0,
  initialBatches: 0,
  bisections: 0,
  maxBisectionDepth: 0,
  singletonFailures: 0,
};

async function runStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ExporterError) {
      err.message = `${stage}: ${err.message}`;
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${stage}: ${message}`);
  }
}

async function enumerateViaRestFallback(
  deps: EnumerateDeps,
  opts: { hydrateBatchSize?: number; coordinator?: RetryCoordinator },
  probe: { isOverLimit: boolean; totalCount: number; rateLimit: RateLimit },
): Promise<EnumerationResult> {
  // REST fallback with a single snapshot-conflict restart.
  let restarted = false;
  let rest = await runStage('rest-enumeration', () =>
    enumerateStarsRest(deps.rest, { coordinator: opts.coordinator }),
  );
  if (rest.duplicateConflictCount > 0) {
    restarted = true;
    rest = await runStage('rest-enumeration-restart', () =>
      enumerateStarsRest(deps.rest, { coordinator: opts.coordinator }),
    );
    if (rest.duplicateConflictCount > 0) {
      throw new DuplicateConflictError(
        `snapshot conflict persisted after restart (${rest.duplicateConflictCount} conflicts)`,
      );
    }
  }

  const hydrate = await runStage('rest-hydration', () =>
    hydrateByNodeIds(
      deps.graphql,
      rest.seeds.map((seed) => seed.node_id),
      { batchSize: opts.hydrateBatchSize, coordinator: opts.coordinator },
    ),
  );
  const merged = mergeSeeds(rest.seeds, hydrate);

  return {
    edges: merged.edges,
    failedRecords: merged.failedRecords,
    source: 'rest-fallback',
    isOverLimit: probe.isOverLimit,
    totalCountReported: probe.totalCount,
    enumeratedCount: rest.seeds.length + rest.droppedUnidentifiable,
    enumeratedAfterDedup: rest.seeds.length,
    removedMidRun: merged.removedMidRun,
    droppedUnidentifiable: rest.droppedUnidentifiable + merged.droppedUnidentifiable,
    duplicateCount: rest.duplicateCount,
    duplicateConflictCount: rest.duplicateConflictCount,
    restarted,
    hydrateTelemetry: hydrate.telemetry,
    rateLimit: hydrate.rateLimit ?? probe.rateLimit,
    graphqlRequests: 1 + hydrate.telemetry.requests,
    restRequests: rest.pages,
    restRemaining: rest.rateRemaining,
    restResetAt: rest.rateResetAt,
  };
}

export async function enumerate(
  deps: EnumerateDeps,
  opts: { hydrateBatchSize?: number; coordinator?: RetryCoordinator; reserveFloor?: number } = {},
): Promise<EnumerationResult> {
  const probe = await runStage('probe', () => probeStars(deps.graphql, opts.coordinator));

  // Budget reserve floor (P0.6.2): if we are already near the limit, stop before
  // doing any heavy enumeration/hydration work, deferring this run (exit 20).
  const reserve = opts.reserveFloor ?? 0;
  if (reserve > 0 && probe.rateLimit.remaining < reserve) {
    throw new RateLimitInsufficientError(
      `GraphQL rate remaining ${probe.rateLimit.remaining} is below reserve floor ${reserve}`,
    );
  }

  if (!probe.isOverLimit) {
    let all: Awaited<ReturnType<typeof fetchAllStarsGraphql>>;
    try {
      all = await runStage('graphql-pagination', () =>
        fetchAllStarsGraphql(deps.graphql, { coordinator: opts.coordinator }),
      );
    } catch (err) {
      // A successful probe proves GraphQL can answer cheap requests. If only the
      // heavier starredRepositories page walk keeps timing out or 5xxing, switch
      // to the complete REST enumeration path instead of deferring the whole run.
      if (err instanceof RetryBudgetExhaustedError) {
        return enumerateViaRestFallback(deps, opts, probe);
      }
      throw err;
    }
    return {
      edges: all.edges,
      failedRecords: [],
      source: 'graphql',
      isOverLimit: false,
      totalCountReported: probe.totalCount,
      enumeratedCount: all.edges.length,
      enumeratedAfterDedup: all.edges.length,
      removedMidRun: 0,
      droppedUnidentifiable: 0,
      duplicateCount: 0,
      duplicateConflictCount: 0,
      restarted: false,
      hydrateTelemetry: EMPTY_HYDRATE,
      rateLimit: all.rateLimit ?? probe.rateLimit,
      graphqlRequests: 1 + all.pages,
      restRequests: 0,
      restRemaining: null,
      restResetAt: null,
    };
  }

  return enumerateViaRestFallback(deps, opts, probe);
}
