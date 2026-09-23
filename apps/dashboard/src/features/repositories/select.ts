import type { CanonicalRepo } from '@starred/schema';
import { type DerivedRepo, deriveRepo } from '../../data/derive-fields';
import type { RepoAnnotation } from '../../data/load-annotations';
import type { RepoSkillsClassification } from '../../data/load-skills-classification';
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
 * and precompute searchable text ONCE per input set. Memoize by
 * [repos, now, annotations, skills, skillCategoryLabels] — the pass re-runs
 * when an optional layer settles (annotations and, since M2.4, skills),
 * mirroring the AI layer's existing behavior; everything after this is
 * independent of the dataset metadata and the clock.
 */
export function prepareRepositories(
  repos: readonly CanonicalRepo[],
  now: Date,
  annotations?: ReadonlyMap<string, RepoAnnotation>,
  skills?: ReadonlyMap<string, RepoSkillsClassification>,
  skillCategoryLabels?: ReadonlyMap<string, string>,
): SearchableRepo[] {
  return repos.map((repo) => {
    const derived = deriveRepo(
      repo,
      now,
      annotations?.get(repo.node_id) ?? null,
      skills?.get(repo.node_id) ?? null,
    );
    // Search enrichment (P7 §4.12/§7): `searchText` gains the classification
    // taxonomy labels + curated summary through `derived.skills`, which is
    // non-null only when the caller passed a coherent-ready join map — the
    // readiness gate lives at the caller (RepositoryView), never here.
    return { ...derived, searchText: buildSearchText(derived, skillCategoryLabels) };
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

/**
 * Map the canonical DashboardState onto the pipeline's ViewState.
 *
 * `aiReady` gates the AI-derived facets (P7 §2.2): when the optional AI layer is
 * not `ready`, `categories`/`aiTags` are neutralized here so an unavailable layer
 * can never suppress base repos (the shipped fail-soft bug — a bookmarked
 * `?category=…` with no annotations would otherwise match nothing and blank the
 * dashboard). The URL value is untouched (it lives in `DashboardState`), so it is
 * retained for recoverability and re-applies once the layer loads. Defaults to
 * `true` so non-AI callers (tests, `selectRepositories`) are unaffected.
 *
 * `skillsReady` gates the skills-classification facets the same way (P7 §4.11,
 * M24-FS-1): when the layer is not `ready`, `scope`/`skillCategories` are
 * neutralized here — requested values stay in the URL, results are never zeroed
 * by the optional layer's absence. Unlike `aiReady`, it defaults to `false`
 * (fail-closed): the skills surface is new with no legacy callers to preserve,
 * so activation always requires an explicit `true` from a status-owning caller
 * (charter #2; pre-commit R1 F-A, pinned by M24-STS-3).
 */
export function dashboardToView(s: DashboardState, aiReady = true, skillsReady = false): ViewState {
  return {
    query: s.query,
    sort: { field: s.sort, direction: s.direction },
    filters: {
      languages: s.languages,
      topics: s.topics,
      licenses: s.licenses,
      categories: aiReady ? s.categories : [],
      aiTags: aiReady ? s.aiTags : [],
      skillsScope: skillsReady && s.scope === 'skills',
      skillCategories: skillsReady ? s.skillCategories : [],
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
