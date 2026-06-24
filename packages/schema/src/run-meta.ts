import { z } from 'zod';
import { SCHEMA_VERSION } from './stars';

export const EnumerationSourceSchema = z.enum(['graphql', 'rest-fallback']);
export type EnumerationSource = z.infer<typeof EnumerationSourceSchema>;

const int = () => z.number().int().nonnegative();

/**
 * Per-execution telemetry. NOT committed (git-ignored) — uploaded as a CI
 * artifact / written to the job summary. Carries every volatile field (incl.
 * API budget) so none of it leaks into the deterministic stars.json.
 */
export const RunMetaSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    generated_at: z.string(),
    exporter_version: z.string(),
    duration_ms: int(),

    // publication lifecycle
    dataset_changed: z.boolean(),
    validation_passed: z.boolean(),
    degraded: z.boolean(),
    degraded_ratio: z.number().min(0).max(1),
    staged: z.boolean(),
    commit_created: z.boolean(),
    push_succeeded: z.boolean(),
    published: z.boolean(),

    enumeration: z
      .object({
        source: EnumerationSourceSchema,
        is_over_limit: z.boolean(),
        reported: int(),
        enumerated: int(),
        duplicates: int(),
        duplicate_conflicts: int(),
        restarted: z.boolean(),
      })
      .strict(),
    counts: z
      .object({
        exported: int(),
        private_filtered: int(),
        removed_mid_run: int(),
        dropped_unidentifiable: int(),
        hydration_failed_publishable: int(),
      })
      .strict(),

    // --- budget telemetry (P0.6) ---
    github_api: z
      .object({
        graphql: z
          .object({
            requests: int(),
            cost: int(),
            remaining: int(),
            reset_at: z.string().nullable(),
          })
          .strict(),
        rest: z
          .object({
            requests: int(),
            remaining: z.number().int().nullable(),
            reset_at: z.string().nullable(),
          })
          .strict(),
      })
      .strict(),
    retry: z
      .object({
        attempts: int(),
        total_wait_ms: int(),
        secondary_limit_events: int(),
        global_cooldowns: int(),
      })
      .strict(),
    hydrate: z
      .object({
        requests: int(),
        initial_batches: int(),
        bisections: int(),
        max_bisection_depth: int(),
        singleton_failures: int(),
      })
      .strict(),

    warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    errors: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  })
  .strict();

export type RunMeta = z.infer<typeof RunMetaSchema>;
