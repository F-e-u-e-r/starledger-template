import type {
  AgentExecutorKind,
  ClassificationCandidates,
  ClassificationManifest,
} from '@starred/ai-schema';
import { validateCandidate, type ValidatedCandidate } from './validate-candidate';

/** The branch prefix each approved executor uses for its pull requests. */
export const EXECUTOR_BRANCH_PREFIX: Record<AgentExecutorKind, string> = {
  'claude-routine': 'claude/',
  'codex-automation': 'codex/',
};

export interface RejectedCandidate {
  job_id: string;
  node_id: string;
  reason: string;
}

export interface RunReconciliation {
  /** Candidates that matched a manifest job and passed deterministic validation. */
  applied: ValidatedCandidate[];
  /** node_ids of manifest jobs with NO valid candidate — recorded for retry, never dropped. */
  pendingRetry: string[];
  /** Candidates rejected (no matching job, wrong executor, stale, or invalid). */
  rejected: RejectedCandidate[];
}

function compareNodeId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reconcile an executor's (partial, untrusted) candidate bundle against the
 * trusted manifest. This is the candidate-side mirror of the planner's trust
 * boundary:
 *
 *   - a candidate is matched to a manifest job by `job_id` and validated exactly
 *     (executor binding, source fingerprint, taxonomy/prompt/profile versions,
 *     category and tag vocabulary) — a stale, wrong-executor, or smuggled
 *     candidate is REJECTED, never applied;
 *   - a manifest job with no valid candidate is recorded in `pendingRetry`, so a
 *     later run reclassifies it — a job is never silently dropped;
 *   - an executor cannot introduce a node the planner did not authorize: a
 *     candidate whose `job_id` is not in the manifest is rejected.
 *
 * Partial candidate sets are therefore first-class — the executor classifies what
 * it can and the rest waits. The caller decides policy on `rejected`; the CLI
 * `apply` hard-fails so a bad candidate can never enter an artifact silently.
 */
export function reconcileRun(
  manifest: ClassificationManifest,
  bundle: ClassificationCandidates,
): RunReconciliation {
  const jobsById = new Map(manifest.jobs.map((job) => [job.job_id, job]));
  const applied: ValidatedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const coveredNodeIds = new Set<string>();

  for (const candidate of bundle.candidates) {
    const job = jobsById.get(candidate.job_id);
    if (job === undefined) {
      rejected.push({
        job_id: candidate.job_id,
        node_id: candidate.node_id,
        reason: 'candidate does not correspond to any job in the manifest',
      });
      continue;
    }
    try {
      applied.push(validateCandidate(candidate, job));
      coveredNodeIds.add(job.node_id);
    } catch (error) {
      rejected.push({
        job_id: candidate.job_id,
        node_id: candidate.node_id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const pendingRetry = manifest.jobs
    .filter((job) => !coveredNodeIds.has(job.node_id))
    .map((job) => job.node_id)
    .sort(compareNodeId);

  return { applied, pendingRetry, rejected };
}
