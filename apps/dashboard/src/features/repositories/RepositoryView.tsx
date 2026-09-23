import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CanonicalRepo } from '@starred/schema';
import { NoResults } from '../../components/states';
import type { AnnotationStatus, LoadedAnnotations } from '../../data/load-annotations';
import type {
  LoadedSkillsClassification,
  SkillsClassificationStatus,
} from '../../data/load-skills-classification';
import type { Density } from '../../state/dashboard-state';
import type { DashboardStateControls } from '../../state/use-dashboard-state';
import { activeFilterCount, FilterChips } from '../filters/FilterChips';
import { FilterControls } from '../filters/FilterControls';
import { FilterDrawer } from '../filters/FilterDrawer';
import { defaultDirection, SORT_FIELDS, type SortField } from '../sorting/sorting';
import { RepositoryCard } from './RepositoryCard';
import {
  dashboardToView,
  deriveFacetOptions,
  prepareRepositories,
  selectFromPrepared,
} from './select';

const SORT_LABELS: Record<SortField, string> = {
  starred_at: 'Recently starred',
  stargazer_count: 'Stars',
  pushed_at: 'Recently pushed',
  latest_stable_release: 'Latest stable release',
  name_with_owner: 'Name',
};

/** Fixed page size for the results list (P7 §6, M1). */
const PAGE_SIZE = 48;

function formatLastSynced(iso: string | undefined, now: Date): string {
  if (!iso) return 'Last synced unavailable';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Last synced unavailable';
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return `Last synced ${d.toISOString().slice(0, 10)}`;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Last synced just now';
  if (minutes < 60) return `Last synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last synced ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Last synced ${days} day${days === 1 ? '' : 's'} ago`;
  return `Last synced ${d.toISOString().slice(0, 10)}`;
}

/**
 * A single result line. A query dominates the phrasing (and notes that filters
 * are also narrowing it); otherwise active filters read as "N of M · filtered",
 * and the unfiltered dataset reads as the plain total.
 */
function resultSummary(count: number, total: number, query: string, filtered: boolean): string {
  const q = query.trim();
  if (q) {
    const base = `${count} result${count === 1 ? '' : 's'} for "${q}"`;
    return filtered ? `${base} · filtered` : base;
  }
  if (filtered) return `${count} of ${total} · filtered`;
  return `${count} of ${total} repositories`;
}

/**
 * The full P1.3 dashboard: URL-synced canonical state, every facet control,
 * active-filter chips, a responsive card list and accessible result states.
 *
 * Performance: per-dataset work (`prepareRepositories` = derive + searchable
 * text, and `deriveFacetOptions`) is memoized by [repos, sessionNow] plus the
 * optional-layer join maps, so it re-runs when the AI or skills layer settles
 * (a bounded, per-load count); only the cheap search/filter/sort pass re-runs
 * as the dashboard state changes.
 */
export function RepositoryView({
  repos,
  controls,
  datasetGeneratedAt,
  initialNow,
  annotations,
  annotationStatus,
  skillsClassification,
  skillsStatus,
  starsSha256,
}: {
  repos: CanonicalRepo[];
  /** Canonical state controls, owned by App (single source of truth, §6.4). */
  controls: DashboardStateControls;
  datasetGeneratedAt?: string;
  initialNow?: Date;
  annotations?: LoadedAnnotations | null;
  /** Lifecycle of the optional AI layer (P7 §2.2). Defaults from `annotations`. */
  annotationStatus?: AnnotationStatus;
  /** The optional skills-classification layer (P7 §4.11). */
  skillsClassification?: LoadedSkillsClassification | null;
  /** Lifecycle of the skills layer. Activation requires `'ready'` — data
   *  presence alone never activates (charter #2); omitted ⇒ not ready. */
  skillsStatus?: SkillsClassificationStatus;
  /** Live dataset `stars_sha256` — drives ONLY the §2.1 soft provenance note
   *  (never a gate; the mismatch is the steady state under daily sync). */
  starsSha256?: string;
}) {
  const { state, update, reset } = controls;
  const [sessionNow] = useState(() => initialNow ?? new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const searchId = useId();

  const annotationsByNodeId = annotations?.byNodeId;
  // The optional AI layer is usable only when `ready`; a missing status falls
  // back to "ready iff annotations are present" so existing callers/tests behave.
  const aiReady = annotationStatus ? annotationStatus === 'ready' : annotations != null;
  // Skills layer readiness (P7 §4.11, charter #2): activation requires a
  // COHERENT ready layer — status `ready` AND data. Neither half alone
  // activates: data without status never projects (pre-commit R1 F-A,
  // M24-STS-1), and a `ready` status without data would otherwise turn the
  // scope/facet into a match-nothing filter and zero the results with no
  // degraded surface (pre-commit R2 sol, M24-STS-4). Deliberately STRICTER
  // than the AI layer's data-presence fallback (an M0 decision preserving
  // then-existing callers; this surface is new and has none). The join map is
  // passed only when ready, so a not-ready layer STRUCTURALLY cannot influence
  // badges or filtering — `repo.skills` is then null everywhere (M24-BDG-1).
  const skillsReady = skillsStatus === 'ready' && skillsClassification != null;
  const skillsByNodeId = skillsReady ? skillsClassification?.byNodeId : undefined;
  // Taxonomy labels for badges, chips and the search corpus (§4.11/§4.12) —
  // canonical-order artifact data, present only under the same coherent-ready
  // gate as the join map, so a not-ready layer cannot reach the corpus either.
  const skillCategories = skillsReady ? skillsClassification?.categories : undefined;
  const skillCategoryLabels = useMemo(
    () =>
      skillCategories ? new Map(skillCategories.map((c) => [c.id, c.label] as const)) : undefined,
    [skillCategories],
  );
  const prepared = useMemo(
    () =>
      prepareRepositories(
        repos,
        sessionNow,
        annotationsByNodeId,
        skillsByNodeId,
        skillCategoryLabels,
      ),
    [repos, sessionNow, annotationsByNodeId, skillsByNodeId, skillCategoryLabels],
  );
  const facets = useMemo(() => deriveFacetOptions(prepared), [prepared]);
  const aiCount = useMemo(() => prepared.reduce((n, r) => (r.ai ? n + 1 : n), 0), [prepared]);
  const hasDegraded = useMemo(() => repos.some((repo) => repo.hydration_status !== 'ok'), [repos]);
  // §2.1 soft provenance note: ready + hash differs from the live dataset.
  const skillsGeneratedAgainstOlderSnapshot =
    skillsReady &&
    skillsClassification != null &&
    starsSha256 != null &&
    skillsClassification.generatedAgainstStarsSha256 !== starsSha256;
  const skillsFacetData =
    skillsReady && skillsClassification != null && skillCategories
      ? {
          categories: skillCategories,
          generatedAgainstOlderSnapshot: skillsGeneratedAgainstOlderSnapshot,
          // §4.12 coverage line: generation-time statistics, presentation only —
          // never a readiness input (the F2 re-entry pin: matched=0 must not
          // suppress the section or any filter semantics).
          coverage: skillsClassification.coverage,
        }
      : null;
  // AI- and skills-dependent filters are applied only when their layer is ready
  // (P7 §2.2/§4.11): when not, they are neutralized so base repos are never
  // suppressed — results are never zeroed by an optional layer's absence.
  const results = useMemo(
    () => selectFromPrepared(prepared, dashboardToView(state, aiReady, skillsReady)),
    [prepared, state, aiReady, skillsReady],
  );

  // Pagination (§6.2): `state.page` is the REQUESTED page; the EFFECTIVE page is
  // clamped against the current result count. When they differ (e.g. a stale
  // bookmark `?page=999`), reconcile by rewriting the URL with the effective page
  // — `replace`, so no history entry is added — converging in a single step.
  const lastPage = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const effectivePage = Math.min(Math.max(1, state.page), lastPage);
  useEffect(() => {
    if (state.page !== effectivePage) update({ page: effectivePage }, 'replace');
  }, [state.page, effectivePage, update]);
  const pageItems = results.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE);

  // Stable focus target so chip removal / clear-all never drop focus to <body>.
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusResults = () => resultsHeadingRef.current?.focus();
  // Drawer close restores focus here, never to <body> (A11Y-5).
  const filtersToggleRef = useRef<HTMLButtonElement>(null);
  // Ephemeral is-scrolled presentation flag (§13 M1.2c): drives the stuck-state
  // elevation shadow only — never a second owner of any canonical control.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // The sticky sidebar must stick BELOW the sticky toolbar or the opaque
  // toolbar covers the sidebar's top ~39px (PR #239 review, finding 1). The
  // toolbar's height is layout-dependent (flex-wrap), so publish it as a CSS
  // variable the sidebar's `top`/`max-height` consume (presentation only).
  const mainRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    const toolbar = toolbarRef.current;
    if (!main || !toolbar) return;
    const publish = () => main.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return; // jsdom: geometry is browser-verified
    const ro = new ResizeObserver(publish);
    ro.observe(toolbar);
    return () => ro.disconnect();
  }, []);
  const filterCount = activeFilterCount(state);
  // AI facets present in state but inert because the layer isn't ready: still
  // shown as removable chips (recoverability) with a degraded notice, but NOT
  // counted as effective filters in the result summary (P7 §2.2).
  const suppressedAiFilterCount = aiReady ? 0 : state.categories.length + state.aiTags.length;
  const aiFilterSuppressed = suppressedAiFilterCount > 0;
  // Same exclusion for requested-but-inert skills values (§4.11, M24-CNT-1).
  const suppressedSkillsFilterCount = skillsReady
    ? 0
    : (state.scope !== 'all' ? 1 : 0) + state.skillCategories.length;
  const skillsFilterSuppressed = suppressedSkillsFilterCount > 0;
  const effectiveFilterCount = filterCount - suppressedAiFilterCount - suppressedSkillsFilterCount;

  return (
    <main ref={mainRef} className={`dashboard density-${state.density}`}>
      <header className="dashboard-head">
        <div className="brand-row">
          <div>
            <h1>StarLedger</h1>
            <p>Search, sort, and filter your GitHub stars.</p>
          </div>
          <p className="dataset-status">
            {repos.length} starred repositories · {formatLastSynced(datasetGeneratedAt, sessionNow)}
            {annotations ? ` · ${aiCount} of ${repos.length} AI-enriched` : ''}
          </p>
        </div>
      </header>

      {/* Direct child of .dashboard on purpose: position:sticky is constrained
          to its parent's box, so nesting this back inside the (short)
          .dashboard-head would silently un-stick it (STICK-1 pins this). */}
      <div ref={toolbarRef} className={`toolbar${scrolled ? ' is-scrolled' : ''}`}>
        <div className="search">
          <label className="visually-hidden" htmlFor={searchId}>
            Search repositories
          </label>
          <input
            id={searchId}
            type="search"
            value={state.query}
            onChange={(e) => update({ query: e.target.value }, 'replace')}
            placeholder="Search by repository, description, topic, or language..."
          />
          {state.query ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => update({ query: '' }, 'replace')}
            >
              ×
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          ref={filtersToggleRef}
          onClick={() => setFiltersOpen(true)}
        >
          Filters{effectiveFilterCount > 0 ? ` ${effectiveFilterCount}` : ''}
        </button>
        <label className="sort">
          <span>Sort</span>
          <select
            value={state.sort}
            onChange={(e) => {
              // Changing the field resets direction to that field's natural
              // default (Name → A→Z), instead of inheriting a stale desc.
              const sort = e.target.value as SortField;
              update({ sort, direction: defaultDirection(sort) });
            }}
          >
            {SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {SORT_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => update({ direction: state.direction === 'asc' ? 'desc' : 'asc' })}
          aria-label={`Sort direction: ${state.direction === 'asc' ? 'ascending' : 'descending'}. Activate to toggle.`}
        >
          {state.direction === 'asc' ? '↑ Ascending' : '↓ Descending'}
        </button>
        <label className="density">
          <span>Density</span>
          <select
            value={state.density}
            onChange={(e) => update({ density: e.target.value as Density })}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </label>
      </div>

      <div className="layout">
        <aside className="sidebar" aria-label="Filters">
          <FilterControls
            state={state}
            facets={facets}
            update={update}
            hasDegraded={hasDegraded}
            skills={skillsFacetData}
          />
        </aside>

        <section className="results" aria-labelledby="results-heading">
          <h2
            id="results-heading"
            tabIndex={-1}
            ref={resultsHeadingRef}
            className="results-heading"
          >
            Starred repositories
          </h2>

          <FilterChips
            state={state}
            update={update}
            onClearAll={() => reset()}
            onAfterRemove={focusResults}
            skillCategoryLabels={skillCategoryLabels}
          />

          <p className="result-count" role="status">
            {resultSummary(results.length, repos.length, state.query, effectiveFilterCount > 0)}
          </p>

          {aiFilterSuppressed ? (
            <p className="degraded-notice" role="status">
              {annotationStatus === 'loading'
                ? 'AI classification is still loading — its category and tag filters will apply once it’s ready.'
                : 'AI classification is unavailable, so its category and tag filters aren’t being applied. They stay in your link and re-apply once enrichment loads.'}
            </p>
          ) : null}

          {skillsFilterSuppressed ? (
            <p className="degraded-notice" role="status">
              {skillsStatus === 'loading'
                ? 'Skills classification is still loading — the Skills-ecosystem scope and skill-category filters will apply once it’s ready.'
                : 'Skills classification is unavailable, so the Skills-ecosystem scope and skill-category filters aren’t being applied. They stay in your link and re-apply once the layer loads.'}
            </p>
          ) : null}

          {results.length === 0 ? (
            <NoResults
              onClearFilters={() => {
                reset();
                focusResults();
              }}
            />
          ) : (
            <>
              <ul className="card-list">
                {pageItems.map((repo) => (
                  <RepositoryCard
                    key={repo.node_id}
                    repo={repo}
                    now={sessionNow}
                    selectedTopics={state.topics}
                    skillCategoryLabels={skillCategoryLabels}
                  />
                ))}
              </ul>
              {lastPage > 1 ? (
                <nav className="pager" aria-label="Pagination">
                  {/* aria-disabled (not `disabled`) at the boundaries: the button
                      stays focusable so activating Prev/Next onto the first/last
                      page never strands keyboard focus on a now-disabled control.
                      The handler guards the no-op. */}
                  <button
                    type="button"
                    className="pager-prev"
                    aria-disabled={effectivePage <= 1}
                    onClick={() => {
                      if (effectivePage > 1) update({ page: effectivePage - 1 });
                    }}
                  >
                    ← Previous
                  </button>
                  <span className="pager-status" role="status">
                    Page {effectivePage} of {lastPage}
                  </span>
                  <button
                    type="button"
                    className="pager-next"
                    aria-disabled={effectivePage >= lastPage}
                    onClick={() => {
                      if (effectivePage < lastPage) update({ page: effectivePage + 1 });
                    }}
                  >
                    Next →
                  </button>
                </nav>
              ) : null}
            </>
          )}
        </section>
      </div>

      <FilterDrawer open={filtersOpen} onClose={closeFilters} returnFocusRef={filtersToggleRef}>
        <FilterControls
          state={state}
          facets={facets}
          update={update}
          hasDegraded={hasDegraded}
          skills={skillsFacetData}
        />
      </FilterDrawer>
    </main>
  );
}
