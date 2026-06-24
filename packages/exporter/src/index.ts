import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createGithubClient,
  DeferredError,
  type GraphqlClient,
  PushFailedError,
  RetryCoordinator,
  type StarredRestClient,
  ValidationFailedError,
} from '@starred/github-client';
import { type CanonicalRepo, type RunMeta, RunMetaSchema, SCHEMA_VERSION } from '@starred/schema';
import { type Config, loadConfig, readToken } from './config';
import { evaluateDegraded } from './degraded';
import { type EnumerateDeps, enumerate } from './enumerate';
import { type GitPublisher, RealGitPublisher } from './git';
import { normalizeEdge } from './normalize';
import { checkEmptyGuard, type PublishResult, publishDataset } from './publish';
import { serializeStars } from './serialize';

export const EXPORTER_VERSION = '0.1.0';

export interface RunOptions {
  configPath?: string;
  outDir?: string;
  graphql?: GraphqlClient;
  rest?: StarredRestClient;
  coordinator?: RetryCoordinator;
  git?: GitPublisher;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface RunOutcome {
  changed: boolean;
  degraded: boolean;
  published: boolean;
  repoCount: number;
  config: Config;
  runMeta: RunMeta;
}

function resolveDeps(options: RunOptions): EnumerateDeps {
  if (options.graphql && options.rest) {
    return { graphql: options.graphql, rest: options.rest };
  }
  const client = createGithubClient(readToken(options.env));
  return { graphql: options.graphql ?? client.graphql, rest: options.rest ?? client.rest };
}

export async function run(options: RunOptions = {}): Promise<RunOutcome> {
  const startedAt = performance.now();
  const now = options.now ?? (() => new Date());
  const config = loadConfig(options.configPath);
  const outDir = options.outDir ?? process.cwd();
  const coordinator = options.coordinator ?? new RetryCoordinator();
  const git = options.git ?? new RealGitPublisher(outDir);

  const enumeration = await enumerate(resolveDeps(options), {
    hydrateBatchSize: config.hydrate_batch_size,
    coordinator,
    reserveFloor: config.rate_limit_reserve,
  });

  // D5: drop private repos. Then append publishable degraded records.
  let privateFiltered = 0;
  const repos: CanonicalRepo[] = [];
  for (const edge of enumeration.edges) {
    if (edge.node.isPrivate) {
      privateFiltered += 1;
      continue;
    }
    repos.push(normalizeEdge(edge));
  }
  for (const failed of enumeration.failedRecords) repos.push(failed);

  const exported = repos.length;
  const failedPublishable = enumeration.failedRecords.length;
  const decision = evaluateDegraded(
    failedPublishable,
    enumeration.enumeratedAfterDedup,
    config.max_degraded_ratio,
  );

  // Reconciliation — an exact accounting identity; violation = pipeline bug.
  const accounted =
    exported + privateFiltered + enumeration.removedMidRun + enumeration.droppedUnidentifiable;
  if (accounted !== enumeration.enumeratedCount) {
    throw new Error(
      `reconciliation mismatch: enumerated=${enumeration.enumeratedCount} accounted=${accounted}`,
    );
  }

  // private_filtered is a credential-hygiene warning, not a failure: the public
  // dataset is still published (the second/third defense layers worked).
  const warnings =
    privateFiltered > 0
      ? [
          {
            code: 'PRIVATE_FILTERED',
            message: `${privateFiltered} private repo(s) filtered from output`,
          },
        ]
      : [];

  const buildMeta = (lifecycle: {
    dataset_changed: boolean;
    validation_passed: boolean;
    staged: boolean;
    commit_created: boolean;
    push_succeeded: boolean;
    published: boolean;
  }): RunMeta =>
    RunMetaSchema.parse({
      schema_version: SCHEMA_VERSION,
      generated_at: now().toISOString(),
      exporter_version: EXPORTER_VERSION,
      duration_ms: Math.round(performance.now() - startedAt),
      ...lifecycle,
      degraded: decision.degraded,
      degraded_ratio: decision.degradedRatio,
      enumeration: {
        source: enumeration.source,
        is_over_limit: enumeration.isOverLimit,
        reported: enumeration.totalCountReported,
        enumerated: enumeration.enumeratedCount,
        duplicates: enumeration.duplicateCount,
        duplicate_conflicts: enumeration.duplicateConflictCount,
        restarted: enumeration.restarted,
      },
      counts: {
        exported,
        private_filtered: privateFiltered,
        removed_mid_run: enumeration.removedMidRun,
        dropped_unidentifiable: enumeration.droppedUnidentifiable,
        hydration_failed_publishable: failedPublishable,
      },
      github_api: {
        graphql: {
          requests: enumeration.graphqlRequests,
          cost: enumeration.rateLimit?.cost ?? 0,
          remaining: enumeration.rateLimit?.remaining ?? 0,
          reset_at: enumeration.rateLimit?.reset_at ?? null,
        },
        rest: {
          requests: enumeration.restRequests,
          remaining: enumeration.restRemaining,
          reset_at: enumeration.restResetAt,
        },
      },
      retry: {
        attempts: coordinator.telemetry.attempts,
        total_wait_ms: Math.round(coordinator.telemetry.totalWaitMs),
        secondary_limit_events: coordinator.telemetry.secondaryLimitEvents,
        global_cooldowns: coordinator.telemetry.globalCooldowns,
      },
      hydrate: {
        requests: enumeration.hydrateTelemetry.requests,
        initial_batches: enumeration.hydrateTelemetry.initialBatches,
        bisections: enumeration.hydrateTelemetry.bisections,
        max_bisection_depth: enumeration.hydrateTelemetry.maxBisectionDepth,
        singleton_failures: enumeration.hydrateTelemetry.singletonFailures,
      },
      warnings,
      errors: [],
    } satisfies RunMeta);

  const writeMeta = (meta: RunMeta): void =>
    writeFileSync(resolve(outDir, config.output.run_meta), JSON.stringify(meta, null, 2) + '\n');

  // Degraded gate: over threshold ⇒ never publish.
  if (!decision.withinThreshold) {
    writeMeta(
      buildMeta({
        dataset_changed: false,
        validation_passed: true,
        staged: false,
        commit_created: false,
        push_succeeded: false,
        published: false,
      }),
    );
    throw new DeferredError(
      `degraded ratio ${failedPublishable}/${enumeration.enumeratedAfterDedup} exceeds max ${config.max_degraded_ratio}`,
      'DEGRADED_THRESHOLD_EXCEEDED',
    );
  }

  // Empty-result safety guard (F2): never overwrite a non-empty published
  // dataset with an empty one unless explicitly allowed.
  try {
    checkEmptyGuard({
      outDir,
      starsFileName: config.output.stars,
      exportedCount: exported,
      allowEmpty: config.allow_empty,
    });
  } catch (err) {
    writeMeta(
      buildMeta({
        dataset_changed: false,
        validation_passed: true,
        staged: false,
        commit_created: false,
        push_succeeded: false,
        published: false,
      }),
    );
    throw err;
  }

  const starsJson = serializeStars(repos);

  let publishResult: PublishResult;
  try {
    publishResult = await publishDataset({
      outDir,
      starsFileName: config.output.stars,
      datasetMetaFileName: config.output.dataset_meta,
      starsJson,
      repoCount: repos.length,
      now: now(),
      git,
    });
  } catch (err) {
    if (err instanceof ValidationFailedError) {
      writeMeta(
        buildMeta({
          dataset_changed: false,
          validation_passed: false,
          staged: false,
          commit_created: false,
          push_succeeded: false,
          published: false,
        }),
      );
    }
    throw err;
  }

  const published = publishResult.pushSucceeded;
  const meta = buildMeta({
    dataset_changed: publishResult.datasetChanged,
    validation_passed: true,
    staged: publishResult.staged,
    commit_created: publishResult.commitCreated,
    push_succeeded: publishResult.pushSucceeded,
    published,
  });
  writeMeta(meta);

  if (publishResult.datasetChanged && !publishResult.commitCreated) {
    throw new DeferredError('git commit failed; remote last-known-good unchanged', 'COMMIT_FAILED');
  }
  if (publishResult.datasetChanged && publishResult.commitCreated && !publishResult.pushSucceeded) {
    throw new PushFailedError('git push failed; remote last-known-good unchanged');
  }

  return {
    changed: publishResult.datasetChanged,
    degraded: decision.degraded,
    published,
    repoCount: repos.length,
    config,
    runMeta: meta,
  };
}
