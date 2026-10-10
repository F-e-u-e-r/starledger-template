import { z } from 'zod';
import { AI_SCHEMA_VERSION } from './artifact';
import { AgentExecutorKindSchema } from './execution-profile';
import {
  canonicalizeClassificationJob,
  ClassificationJobSchema,
  LowercaseSha256Schema,
  type ClassificationJob,
} from './job';
import { TAXONOMY_VERSION } from './taxonomy';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reasons a planned manifest can be empty, recorded so a zero-job manifest is
 * machine-distinguishable instead of stdout-prose-parsed (issue #207 item 1).
 * Present (non-null) IFF the manifest has zero jobs. `drained-at-base` is the
 * ONLY value that means "every canonical repo is classified at its current
 * fingerprint"; the others each mask a distinct non-completion:
 *   - `disabled`    — AI classification is off; no live discovery ran.
 *   - `zero-budget` — eligible new/retry/refresh work exists but a 0 budget
 *                     ceiling truncated all of it away.
 *   - `all-omitted` — work was selected within budget but every job was omitted
 *                     because its README bytes were not fetchable this run.
 *   - `deferred`    — the only remaining repos are held back (a retry still in
 *                     backoff, or a terminally-unavailable repo) — not actionable
 *                     this run, but NOT a drained backlog either.
 * There is deliberately no `executor-mismatch`: an executor-kind change alters
 * each repo's fingerprint and surfaces as ordinary refresh eligibility (i.e.
 * `zero-budget` under a 0 refresh ceiling), not a distinct empty reason.
 */
export const PLAN_EMPTY_REASONS = [
  'disabled',
  'zero-budget',
  'drained-at-base',
  'all-omitted',
  'deferred',
] as const;
export const PlanEmptyReasonSchema = z.enum(PLAN_EMPTY_REASONS);
export type PlanEmptyReason = z.infer<typeof PlanEmptyReasonSchema>;

/**
 * Plan-time diagnostics for one `plan` run, carried on the manifest so a zero-job
 * outcome is machine-checkable (issue #207 items 1 & 2). The completion gate
 * asserts no refresh/retry work was masked by a 0 budget instead of trusting
 * "jobs = 0 + node_id sets equal", which a changed-fingerprint repo under a 0
 * refresh/retry ceiling would falsely satisfy.
 */
export const PlanSummarySchema = z
  .object({
    /** Repos that would produce a NEW job, counted BEFORE any budget ceiling. */
    eligible_new: z.number().int().nonnegative(),
    /** Repos that would produce a RETRY job, counted BEFORE any budget ceiling. */
    eligible_retry: z.number().int().nonnegative(),
    /** Repos that would produce a REFRESH job, counted BEFORE any budget ceiling. */
    eligible_refresh: z.number().int().nonnegative(),
    /**
     * Jobs selected within budget but dropped because their README bytes were not
     * fetchable this run (re-planned next run). Mirrors the stdout "omitted N
     * probe-ok job(s)" line as a machine-readable count.
     */
    omitted_unfetchable: z.number().int().nonnegative(),
    /**
     * Repos held in retry backoff this run (a failed attempt whose next_retry_at
     * has not elapsed). They produce no job and are NOT counted in eligible_* (a
     * skip bucket), yet they are un-drained work — surfaced so the completion
     * gate cannot read their absence from eligible_* as a drained backlog.
     */
    deferred_retry: z.number().int().nonnegative(),
    /** Why the manifest is empty; null IFF jobs > 0. See PLAN_EMPTY_REASONS. */
    empty_reason: PlanEmptyReasonSchema.nullable(),
  })
  .strict();
export type PlanSummary = z.infer<typeof PlanSummarySchema>;

/** A deterministic, temporary bounded work list for one agent execution. */
export const ClassificationManifestSchema = z
  .object({
    schema_version: z.literal(AI_SCHEMA_VERSION),
    taxonomy_version: z.literal(TAXONOMY_VERSION),
    prompt_version: z.string().min(1),
    execution_profile_version: z.string().min(1),
    executor_kind: AgentExecutorKindSchema,
    /**
     * The canonical `stars.json` SHA-256 this manifest was planned against. It is
     * recorded at the MANIFEST level (and mirrored in ai-annotations-meta.json),
     * deliberately NOT inside the per-repo source fingerprint: an unrelated star
     * delta changes this value but must never change a repository's fingerprint
     * or churn its annotation. P3.3's provenance gate verifies it is current.
     */
    dataset_sha256: LowercaseSha256Schema,
    jobs: z.array(ClassificationJobSchema),
    /**
     * Optional plan-time diagnostics (issue #207). Additive and backward
     * compatible: the executor, validate, apply, and provenance paths read only
     * `jobs`/`dataset_sha256` and ignore this. The `plan` command always
     * populates it; the P3 completion gate requires it (fail-closed if absent).
     */
    plan_summary: PlanSummarySchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const nodeIds = manifest.jobs.map((job) => job.node_id);
    if (new Set(nodeIds).size !== nodeIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jobs'],
        message: 'jobs must have unique node_id',
      });
    }
    const sorted = [...nodeIds].sort(compareText);
    if (nodeIds.some((nodeId, index) => nodeId !== sorted[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['jobs'],
        message: 'jobs must be sorted by node_id ascending',
      });
    }
    for (const [index, job] of manifest.jobs.entries()) {
      if (
        job.taxonomy_version !== manifest.taxonomy_version ||
        job.prompt_version !== manifest.prompt_version ||
        job.execution_profile_version !== manifest.execution_profile_version ||
        job.executor_kind !== manifest.executor_kind
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['jobs', index],
          message: 'job versions must match the manifest versions',
        });
      }
    }
    if (manifest.plan_summary !== undefined) {
      // empty_reason is the machine-readable "why zero jobs"; it is meaningful
      // only for an empty manifest and must be absent (null) otherwise.
      const reason = manifest.plan_summary.empty_reason;
      if (manifest.jobs.length === 0 && reason === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plan_summary', 'empty_reason'],
          message: 'empty_reason must be set when jobs is empty',
        });
      }
      if (manifest.jobs.length > 0 && reason !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plan_summary', 'empty_reason'],
          message: 'empty_reason must be null when jobs is non-empty',
        });
      }
    }
  });
export type ClassificationManifest = z.infer<typeof ClassificationManifestSchema>;

export interface BuildClassificationManifestInput {
  promptVersion: string;
  executionProfileVersion: string;
  executorKind: z.infer<typeof AgentExecutorKindSchema>;
  datasetSha256: string;
  jobs: readonly ClassificationJob[];
  /** Optional plan-time diagnostics (issue #207); omit for callers that do not plan. */
  planSummary?: PlanSummary;
}

export function buildClassificationManifest(
  input: BuildClassificationManifestInput,
): ClassificationManifest {
  return ClassificationManifestSchema.parse({
    schema_version: AI_SCHEMA_VERSION,
    taxonomy_version: TAXONOMY_VERSION,
    prompt_version: input.promptVersion,
    execution_profile_version: input.executionProfileVersion,
    executor_kind: input.executorKind,
    dataset_sha256: input.datasetSha256,
    jobs: [...input.jobs].sort((a, b) => compareText(a.node_id, b.node_id)),
    ...(input.planSummary !== undefined ? { plan_summary: input.planSummary } : {}),
  });
}

export function serializeClassificationManifest(manifest: ClassificationManifest): string {
  const validated = ClassificationManifestSchema.parse(manifest);
  return (
    JSON.stringify(
      {
        schema_version: validated.schema_version,
        taxonomy_version: validated.taxonomy_version,
        prompt_version: validated.prompt_version,
        execution_profile_version: validated.execution_profile_version,
        executor_kind: validated.executor_kind,
        dataset_sha256: validated.dataset_sha256,
        ...(validated.plan_summary !== undefined
          ? {
              plan_summary: {
                eligible_new: validated.plan_summary.eligible_new,
                eligible_retry: validated.plan_summary.eligible_retry,
                eligible_refresh: validated.plan_summary.eligible_refresh,
                omitted_unfetchable: validated.plan_summary.omitted_unfetchable,
                deferred_retry: validated.plan_summary.deferred_retry,
                empty_reason: validated.plan_summary.empty_reason,
              },
            }
          : {}),
        jobs: validated.jobs.map(canonicalizeClassificationJob),
      },
      null,
      2,
    ) + '\n'
  );
}
