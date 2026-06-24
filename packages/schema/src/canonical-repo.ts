import { z } from 'zod';

/**
 * A release reference as GitHub's "Latest" release (Repository.latestRelease).
 * NOTE (ADR): the latest-stable selection is delegated to GitHub; this app does
 * NOT reproduce GitHub's non-draft/non-prerelease selection algorithm.
 */
export const StableReleaseSchema = z
  .object({
    tag_name: z.string().min(1),
    published_at: z.string().nullable(),
    url: z.string().url(),
  })
  .strict();

/** The most-recently-created release, including prereleases. */
export const AnyReleaseSchema = z
  .object({
    tag_name: z.string().min(1),
    published_at: z.string().nullable(),
    is_prerelease: z.boolean(),
  })
  .strict();

/**
 * Fields populated during hydration. Only these may appear in
 * `unavailable_fields` when hydration is incomplete. Identity fields
 * (node_id, name_with_owner, owner, name, url) and `starred_at` are never
 * hydration-optional — a record missing them is dropped, not published.
 */
export const HYDRATABLE_FIELDS = [
  'description',
  'homepage_url',
  'primary_language',
  'topics',
  'license_spdx',
  'stargazer_count',
  'fork_count',
  'open_issues_count',
  'is_archived',
  'is_disabled',
  'is_fork',
  'created_at',
  'pushed_at',
  'updated_at',
  'latest_stable_release',
  'latest_any_release',
] as const;

export const HydratableFieldSchema = z.enum(HYDRATABLE_FIELDS);
export type HydratableField = z.infer<typeof HydratableFieldSchema>;

export const HydrationStatusSchema = z.enum(['ok', 'partial', 'failed']);

const CanonicalRepoBase = z
  .object({
    // --- identity (never unavailable) ---
    node_id: z.string().min(1),
    name_with_owner: z.string().min(1),
    owner: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),

    // --- hydrated metadata (nullable = confirmed-absent unless listed in unavailable_fields) ---
    description: z.string().nullable(),
    homepage_url: z.string().nullable(),
    primary_language: z.string().nullable(),
    topics: z.array(z.string()),
    license_spdx: z.string().nullable(),
    stargazer_count: z.number().int().nonnegative().nullable(),
    fork_count: z.number().int().nonnegative().nullable(),
    open_issues_count: z.number().int().nonnegative().nullable(),
    is_archived: z.boolean().nullable(),
    is_disabled: z.boolean().nullable(),
    is_fork: z.boolean().nullable(),
    created_at: z.string().nullable(),
    pushed_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    latest_stable_release: StableReleaseSchema.nullable(),
    latest_any_release: AnyReleaseSchema.nullable(),

    // --- provenance from enumeration (never unavailable) ---
    starred_at: z.string().min(1),

    // --- hydration bookkeeping ---
    hydration_status: HydrationStatusSchema,
    unavailable_fields: z.array(HydratableFieldSchema),
  })
  .strict();

/**
 * CanonicalRepo with cross-field invariants enforced (not just per-field types):
 *
 *  - `hydration_status === "ok"`  ⟹ `unavailable_fields` is empty.
 *  - `hydration_status === "failed"` ⟹ `unavailable_fields` is non-empty.
 *  - every field listed in `unavailable_fields` must be empty (null, or [] for
 *    arrays): its value is UNKNOWN and must not be read as "absent".
 *  - a null field NOT listed in `unavailable_fields` means "confirmed absent".
 */
export const CanonicalRepoSchema = CanonicalRepoBase.superRefine((repo, ctx) => {
  if (repo.hydration_status === 'ok' && repo.unavailable_fields.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'hydration_status "ok" requires an empty unavailable_fields array',
      path: ['unavailable_fields'],
    });
  }

  if (repo.hydration_status === 'failed' && repo.unavailable_fields.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'hydration_status "failed" must list the unavailable_fields',
      path: ['unavailable_fields'],
    });
  }

  for (const field of repo.unavailable_fields) {
    const value = (repo as Record<string, unknown>)[field];
    const isEmpty = value === null || (Array.isArray(value) && value.length === 0);
    if (!isEmpty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `field "${field}" is listed as unavailable but carries a concrete value`,
        path: [field],
      });
    }
  }
});

export type StableRelease = z.infer<typeof StableReleaseSchema>;
export type AnyRelease = z.infer<typeof AnyReleaseSchema>;
export type CanonicalRepo = z.infer<typeof CanonicalRepoSchema>;
