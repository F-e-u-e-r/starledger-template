import { GitObjectOidSchema, UtcTimestampSchema } from '@starred/ai-schema';
import { z } from 'zod';

export const CLASSIFIER_STATE_SCHEMA_VERSION = '1.0';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * A bounded, SAFE error code. The state never records a raw upstream error body
 * — only a fixed code that is meaningless to an attacker and cannot leak a
 * secret. `unavailable` is a deterministic, repository-level terminal reason.
 */
export const ClassifierErrorCodeSchema = z.enum([
  'rate_limited',
  'not_found',
  'unavailable',
  'server_error',
  'network',
  'invalid_candidate',
  'timeout',
]);
export type ClassifierErrorCode = z.infer<typeof ClassifierErrorCodeSchema>;

/**
 * Per-repository operational state — ONLY what the next run needs to plan: the
 * README path/OID cache, the last source fingerprint, retry bookkeeping, and a
 * terminal-unavailable flag. It deliberately holds NO README content, prompt,
 * candidate, model response, secret, or raw upstream error body; `.strict()` plus
 * the bounded `last_error_code` enforce that by construction.
 */
export const ClassifierRepoStateSchema = z
  .object({
    node_id: z.string().min(1),
    readme_path: z.string().min(1).nullable(),
    readme_oid: GitObjectOidSchema.nullable(),
    last_fingerprint: z.string().regex(HEX64, 'must be a lowercase hex sha256').nullable(),
    attempts: z.number().int().nonnegative(),
    last_error_code: ClassifierErrorCodeSchema.nullable(),
    next_retry_at: UtcTimestampSchema.nullable(),
    terminal_unavailable: z.boolean(),
  })
  .strict()
  .superRefine((repo, ctx) => {
    const pathNull = repo.readme_path === null;
    const oidNull = repo.readme_oid === null;
    if (pathNull !== oidNull) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'readme_path and readme_oid must both be set or both be null',
        path: ['readme_oid'],
      });
    }
  });
export type ClassifierRepoState = z.infer<typeof ClassifierRepoStateSchema>;

export const ClassifierStateSchema = z
  .object({
    schema_version: z.literal(CLASSIFIER_STATE_SCHEMA_VERSION),
    repos: z.array(ClassifierRepoStateSchema),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = state.repos.map((repo) => repo.node_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repos'],
        message: 'state repos must have unique node_id',
      });
    }
    const sorted = [...ids].sort(compareNodeId);
    if (ids.some((id, index) => id !== sorted[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repos'],
        message: 'state repos must be sorted by node_id ascending',
      });
    }
  });
export type ClassifierState = z.infer<typeof ClassifierStateSchema>;

export const EMPTY_CLASSIFIER_STATE: ClassifierState = {
  schema_version: CLASSIFIER_STATE_SCHEMA_VERSION,
  repos: [],
};

function compareNodeId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalizeRepoState(repo: ClassifierRepoState): Record<string, unknown> {
  return {
    node_id: repo.node_id,
    readme_path: repo.readme_path,
    readme_oid: repo.readme_oid,
    last_fingerprint: repo.last_fingerprint,
    attempts: repo.attempts,
    last_error_code: repo.last_error_code,
    next_retry_at: repo.next_retry_at,
    terminal_unavailable: repo.terminal_unavailable,
  };
}

/**
 * Deterministic state bytes (STATE-1): fixed key order, repos sorted by node_id,
 * 2-space indent, single trailing newline. Identical logical state serializes
 * byte-identically, so the Git store is genuinely commit-on-change.
 */
export function serializeClassifierState(state: ClassifierState): string {
  // Canonicalize order BEFORE validating, so any logical state serializes to the
  // single sorted committed form (the schema itself requires sorted, unique repos).
  const validated = ClassifierStateSchema.parse({
    schema_version: state.schema_version,
    repos: [...state.repos].sort((a, b) => compareNodeId(a.node_id, b.node_id)),
  });
  const repos = validated.repos.map(canonicalizeRepoState);
  return JSON.stringify({ schema_version: validated.schema_version, repos }, null, 2) + '\n';
}

/**
 * Parse + validate remote state bytes. THROWS on malformed/invalid input so the
 * caller keeps the last-known-good remote state rather than overwriting it with a
 * re-baseline (STATE-2). `null`/empty means "no state has been persisted yet".
 */
export function loadClassifierState(bytes: string | null): ClassifierState {
  if (bytes === null || bytes.trim() === '') return EMPTY_CLASSIFIER_STATE;
  let json: unknown;
  try {
    json = JSON.parse(bytes);
  } catch {
    throw new Error('classifier-state.json is not valid JSON');
  }
  return ClassifierStateSchema.parse(json);
}

/** Index state by node_id for O(1) planner lookups. */
export function indexState(state: ClassifierState): Map<string, ClassifierRepoState> {
  return new Map(state.repos.map((repo) => [repo.node_id, repo]));
}
