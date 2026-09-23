import type { CanonicalRepo } from '@starred/schema';
import type { RepoAnnotation } from './load-annotations';
import type { RepoSkillsClassification } from './load-skills-classification';

/** Three-state availability that preserves P0's `null` (absent) vs unknown distinction. */
export type ReleaseAvailability = 'has' | 'none' | 'unavailable';

export interface DerivedRepo extends CanonicalRepo {
  /** Months since last push; null if `pushed_at` is unknown/absent. */
  monthsSincePush: number | null;
  /** True only when the push date is known and older than the threshold. */
  isStale: boolean;
  stableRelease: ReleaseAvailability;
  anyRelease: ReleaseAvailability;
  /**
   * Optional AI enrichment, joined by `node_id` (`null` when unannotated — an
   * unannotated repo is still fully visible). It is a SEPARATE, clearly-secondary
   * layer and never overrides a canonical field.
   */
  ai: RepoAnnotation | null;
  /**
   * Optional skills classification, joined by `node_id` (P7 §4.11; `null` when
   * unclassified — "absence is not a classification", the repo stays fully
   * visible). Same secondary-layer discipline as `ai`.
   */
  skills: RepoSkillsClassification | null;
}

export const STALE_MONTHS = 12;
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

function availability(
  repo: CanonicalRepo,
  field: 'latest_stable_release' | 'latest_any_release',
): ReleaseAvailability {
  if (repo.unavailable_fields.includes(field)) return 'unavailable';
  return repo[field] !== null ? 'has' : 'none';
}

export function deriveRepo(
  repo: CanonicalRepo,
  now: Date,
  annotation: RepoAnnotation | null = null,
  skillsClassification: RepoSkillsClassification | null = null,
): DerivedRepo {
  const pushKnown = !repo.unavailable_fields.includes('pushed_at') && repo.pushed_at !== null;
  const monthsSincePush = pushKnown
    ? (now.getTime() - new Date(repo.pushed_at as string).getTime()) / MS_PER_MONTH
    : null;
  return {
    ...repo,
    monthsSincePush,
    // An unknown push date is NOT stale (matches the unknown-vs-absent rule).
    isStale: monthsSincePush !== null && monthsSincePush > STALE_MONTHS,
    stableRelease: availability(repo, 'latest_stable_release'),
    anyRelease: availability(repo, 'latest_any_release'),
    ai: annotation,
    skills: skillsClassification,
  };
}

export function deriveAll(
  repos: readonly CanonicalRepo[],
  now: Date,
  annotations?: ReadonlyMap<string, RepoAnnotation>,
  skills?: ReadonlyMap<string, RepoSkillsClassification>,
): DerivedRepo[] {
  return repos.map((repo) =>
    deriveRepo(
      repo,
      now,
      annotations?.get(repo.node_id) ?? null,
      skills?.get(repo.node_id) ?? null,
    ),
  );
}
