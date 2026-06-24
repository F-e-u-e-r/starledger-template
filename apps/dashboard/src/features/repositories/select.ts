import type { CanonicalRepo } from '@starred/schema';
import { type DerivedRepo, deriveRepo } from '../../data/derive-fields';
import type { RepoAnnotation } from '../../data/load-annotations';
import type { DashboardState } from '../../state/dashboard-state';
import { applyFilters, type FilterState } from '../filters/filters';
import { buildSearchText, matchesSearchText } from '../search/search';
import { sortRepos, type SortDirection, type SortField } from '../sorting/sorting';

export interface ViewState {
  query: string;
  filters: FilterState;
  sort: { field: SortField; direction: SortDirection };
}

/** A derived repo with its normalized searchable text precomputed once. */
export interface SearchableRepo extends DerivedRepo {
  searchText: string;
}

/**
 * Per-dataset preparation (the expensive, clock-dependent half): derive fields
 * and precompute searchable text ONCE. Memoize by [repos, now]; everything after
 * this is independent of the dataset metadata and the clock.
 */
export function prepareRepositories(
  repos: readonly CanonicalRepo[],
  now: Date,
  annotations?: ReadonlyMap<string, RepoAnnotation>,
): SearchableRepo[] {
  return repos.map((repo) => {
    const derived = deriveRepo(repo, now, annotations?.get(repo.node_id) ?? null);
    return { ...derived, searchText: buildSearchText(derived) };
  });
}

/**
 * The per-interaction half: search → filter → sort over already-prepared repos.
 * Takes NO clock and never re-derives, so re-running it on every keystroke or
 * control change cannot redo per-repo metadata work (PERF-2).
 */
export function selectFromPrepared(
  prepared: readonly SearchableRepo[],
  view: ViewState,
): SearchableRepo[] {
  const searched = prepared.filter((repo) => matchesSearchText(repo.searchText, view.query));
  const filtered = applyFilters(searched, view.filters);
  return sortRepos(filtered, view.sort.field, view.sort.direction);
}

/** Convenience composition: prepare + select. Pure; deterministic for a fixed `now`. */
export function selectRepositories(
  repos: readonly CanonicalRepo[],
  view: ViewState,
  now: Date,
): DerivedRepo[] {
  return selectFromPrepared(prepareRepositories(repos, now), view);
}

/** Map the canonical DashboardState onto the pipeline's ViewState. */
export function dashboardToView(s: DashboardState): ViewState {
  return {
    query: s.query,
    sort: { field: s.sort, direction: s.direction },
    filters: {
      languages: s.languages,
      topics: s.topics,
      licenses: s.licenses,
      categories: s.categories,
      aiTags: s.aiTags,
      archived: s.archived,
      fork: s.fork,
      stale: s.stale,
      stableRelease: s.stableRelease,
      anyRelease: s.anyRelease,
      hydrationStatuses: s.hydrationStatuses,
    },
  };
}

export interface FacetOptions {
  languages: string[];
  topics: string[];
  licenses: string[];
  /** AI facets — empty (and therefore hidden) unless valid annotations are present. */
  categories: string[];
  aiTags: string[];
}

/**
 * Facet option lists derived from the dataset (so they track the data, not a
 * hardcoded list). Accepts canonical OR AI-joined repos; the category/aiTag
 * facets stay empty until annotations are present.
 */
export function deriveFacetOptions(
  repos: readonly (CanonicalRepo & { ai?: RepoAnnotation | null })[],
): FacetOptions {
  const languages = new Set<string>();
  const topics = new Set<string>();
  const licenses = new Set<string>();
  const categories = new Set<string>();
  const aiTags = new Set<string>();
  for (const repo of repos) {
    if (repo.primary_language) languages.add(repo.primary_language);
    for (const topic of repo.topics) topics.add(topic);
    if (repo.license_spdx) licenses.add(repo.license_spdx);
    if (repo.ai) {
      categories.add(repo.ai.category);
      for (const tag of repo.ai.tags) aiTags.add(tag);
    }
  }
  const sorted = (set: Set<string>) => [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    languages: sorted(languages),
    topics: sorted(topics),
    licenses: sorted(licenses),
    categories: sorted(categories),
    aiTags: sorted(aiTags),
  };
}
