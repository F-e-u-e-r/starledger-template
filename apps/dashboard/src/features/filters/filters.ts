import type { DerivedRepo, ReleaseAvailability } from '../../data/derive-fields';

type HydrationStatus = DerivedRepo['hydration_status'];

/**
 * Facet filters. Semantics: AND across facets, OR within a facet (multi-select).
 * An empty array / `null` means "any". The two release facets (stable, any) are
 * each three-state, so filtering for "none" never matches "unavailable"
 * (preserves the unknown-vs-absent rule).
 */
export interface FilterState {
  languages: string[];
  topics: string[];
  licenses: string[];
  categories: string[];
  aiTags: string[];
  archived: boolean | null;
  fork: boolean | null;
  stableRelease: ReleaseAvailability[];
  anyRelease: ReleaseAvailability[];
  hydrationStatuses: HydrationStatus[];
  stale: boolean | null;
}

export const EMPTY_FILTERS: FilterState = {
  languages: [],
  topics: [],
  licenses: [],
  categories: [],
  aiTags: [],
  archived: null,
  fork: null,
  stableRelease: [],
  anyRelease: [],
  hydrationStatuses: [],
  stale: null,
};

export function applyFilters<T extends DerivedRepo>(repos: readonly T[], f: FilterState): T[] {
  return repos.filter((repo) => {
    if (
      f.languages.length > 0 &&
      !(repo.primary_language && f.languages.includes(repo.primary_language))
    ) {
      return false;
    }
    if (f.topics.length > 0 && !repo.topics.some((t) => f.topics.includes(t))) return false;
    if (f.licenses.length > 0 && !(repo.license_spdx && f.licenses.includes(repo.license_spdx))) {
      return false;
    }
    // AI facets (OR within, AND across): a repo with no annotation cannot match an
    // AI facet, so it is excluded while a category or AI-tag filter is active.
    if (f.categories.length > 0 && !(repo.ai && f.categories.includes(repo.ai.category))) {
      return false;
    }
    if (f.aiTags.length > 0 && !(repo.ai && repo.ai.tags.some((t) => f.aiTags.includes(t)))) {
      return false;
    }
    if (f.archived !== null && repo.is_archived !== f.archived) return false;
    if (f.fork !== null && repo.is_fork !== f.fork) return false;
    // Release facets are independent and three-state: an exact-value `includes`
    // check keeps "none" from ever matching "unavailable" (unknown ≠ absent).
    if (f.stableRelease.length > 0 && !f.stableRelease.includes(repo.stableRelease)) return false;
    if (f.anyRelease.length > 0 && !f.anyRelease.includes(repo.anyRelease)) return false;
    if (f.hydrationStatuses.length > 0 && !f.hydrationStatuses.includes(repo.hydration_status)) {
      return false;
    }
    if (f.stale !== null && repo.isStale !== f.stale) return false;
    return true;
  });
}
