import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CanonicalRepo } from '@starred/schema';
import { NoClassifiedResults, NoResults } from '../../components/states';
import type { AnnotationStatus, LoadedAnnotations } from '../../data/load-annotations';
import type {
  LoadedSkillsClassification,
  SkillsClassificationStatus,
} from '../../data/load-skills-classification';
import type { Density, GroupBy } from '../../state/dashboard-state';
import type { DashboardStateControls } from '../../state/use-dashboard-state';
import { activeFilterCount, FilterChips } from '../filters/FilterChips';
import { FilterControls } from '../filters/FilterControls';
import { FilterDrawer } from '../filters/FilterDrawer';
import { defaultDirection, SORT_FIELDS, type SortField } from '../sorting/sorting';
import { groupByPrimaryCategory } from './group';
import { RepositoryCard } from './RepositoryCard';
import {
  dashboardToView,
  deriveFacetOptions,
  prepareRepositories,
  selectFromPrepared,
} from './select';
import { ContextExportPanel } from '../context/ContextExportPanel';

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
 * The grouped-mode result line (P7 §15.7, owner-pinned composition): the
 * classified count and group count, then the query / filtered qualifiers, then
 * the U1 disclosure of matching repos omitted for lack of a classification.
 * `groupedCount` is never presented as the full result count.
 */
function groupedResultSummary(
  groupedCount: number,
  groupCount: number,
  excludedCount: number,
  query: string,
  filtered: boolean,
): string {
  const q = query.trim();
  let text =
    `${groupedCount} classified ${groupedCount === 1 ? 'repository' : 'repositories'}` +
    ` in ${groupCount} ${groupCount === 1 ? 'category' : 'categories'}`;
  if (q) text += ` for "${q}"`;
  if (filtered) text += ' · filtered';
  if (excludedCount > 0) {
    text +=
      ` · ${excludedCount} matching ${excludedCount === 1 ? 'repository' : 'repositories'}` +
      ` without Skills classification ${excludedCount === 1 ? 'is' : 'are'} not shown`;
  }
  return text;
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
  /** Lifecycle of the optional AI layer (P7 §2.2). Activation requires `'ready'`
   *  AND data — data presence alone never activates (F4); omitted ⇒ not ready. */
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
  // Context Builder export panel (P7 §19): local open state, opened from the
  // results header; focus returns to its trigger on close.
  const [contextOpen, setContextOpen] = useState(false);
  const closeContext = useCallback(() => setContextOpen(false), []);
  const copyContextRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();

  const annotationsByNodeId = annotations?.byNodeId;
  // The optional AI layer is EFFECTIVE-READY only under a COHERENT ready shape —
  // status `ready` AND data present (F4, P7 §4.11) — symmetric with `skillsReady`
  // below; neither half alone activates. This closes the two fail-open mirrors the
  // former M0 data-presence fallback left: a `ready` status without data would turn
  // a requested AI filter into a match-nothing filter and silently zero results
  // (F4-P1), and data under an omitted status would activate the layer from presence
  // alone (F4-P2). App — the only producer — sets the (status, data) pair atomically,
  // so real coherent-ready behavior is unchanged; only App-unreachable incoherent
  // shapes change, and there only effective filtering is neutralized (the requested
  // AI URL/filter state is retained for recoverability, exactly as when not ready).
  const aiReady = annotationStatus === 'ready' && annotations != null;
  // Skills layer readiness (P7 §4.11, charter #2): activation requires a
  // COHERENT ready layer — status `ready` AND data. Neither half alone
  // activates: data without status never projects (pre-commit R1 F-A,
  // M24-STS-1), and a `ready` status without data would otherwise turn the
  // scope/facet into a match-nothing filter and zero the results with no
  // degraded surface (pre-commit R2 sol, M24-STS-4). Symmetric with the AI
  // layer's coherent-ready gate above — F4 closed the AI layer's former M0
  // data-presence fallback, so both gates are now identical in shape (this
  // skills surface itself never had legacy callers). The join map is
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
  // The effective ViewState (fail-soft AI/skills gating) and the full filtered +
  // ordered result set it produces — BEFORE pagination. The Context Builder panel
  // exports this SAME `results`/`view`, so its exported set is the Browse set by
  // construction (one filter-semantics source; no recomputation, no second clock).
  const view = useMemo(
    () => dashboardToView(state, aiReady, skillsReady),
    [state, aiReady, skillsReady],
  );
  const results = useMemo(() => selectFromPrepared(prepared, view), [prepared, view]);

  // Grouped presentation (P7 §15.3–15.5, M4.1): `state.group` is the REQUESTED
  // value — retained in the URL and shown by the control — and is EFFECTIVE
  // only under the same coherent-ready conjunction as the join map (§6.5
  // fail-soft; never reconciled, it becomes valid when the layer loads). It is
  // presentation-only: `results` above is the SAME effective set the flat list
  // shows (`group` never enters `dashboardToView`), and grouping is a pure
  // projection of it, computed only in grouped mode (`repo.skills` is non-null
  // only under a ready join, so the projection is well-defined exactly then).
  const effectiveGroup: GroupBy = state.group === 'skill' && skillsReady ? 'skill' : 'none';
  const grouped = useMemo(
    () =>
      effectiveGroup === 'skill' && skillCategories
        ? groupByPrimaryCategory(results, skillCategories)
        : null,
    [results, skillCategories, effectiveGroup],
  );

  // Pagination (§6.2): `state.page` is the REQUESTED page; the EFFECTIVE page is
  // clamped against the current result count. When they differ (e.g. a stale
  // bookmark `?page=999`), reconcile by rewriting the URL with the effective page
  // — `replace`, so no history entry is added — converging in a single step.
  // Grouped mode renders the complete classified set on ONE page (§15.5, D1):
  // no slicing and no pager, so a requested `page > 1` converges to 1 by the
  // same rewrite. The >400 threshold is an owner re-entry trigger, never a
  // runtime mode switch (D10).
  const lastPage =
    effectiveGroup === 'skill' ? 1 : Math.max(1, Math.ceil(results.length / PAGE_SIZE));
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
  // Requested grouped mode while the layer is not ready (§15.6): the list stays
  // flat and a separate notice explains why — independent of the skills FILTER
  // notice above, so both can coexist. `group` is not a filter: it never enters
  // `activeFilterCount`, the `Filters N` badge or "· filtered" (M41-CNT-1).
  const groupRequestedButInert = state.group === 'skill' && effectiveGroup === 'none';
  const clearFilters = () => {
    reset();
    focusResults();
  };
  // E-G offers "Clear filters" only while there is something to clear (§15.7).
  const canClearFilters = effectiveFilterCount > 0 || state.query.trim() !== '';

  return (
    <main ref={mainRef} className={`dashboard density-${state.density}`}>
      <header className="dashboard-head">
        <div className="brand-row">
          <div className="brand-identity">
            {/* `>_` prompt mark — StarLedger joins the Portfolio product family.
                Decorative (aria-hidden); the adjacent <h1> is the accessible name
                (M3-ID-3). Muted emerald via `.brand-mark { color: var(--accent-muted) }`. */}
            <span className="brand-mark" aria-hidden="true">
              {'>_'}
            </span>
            <div>
              <h1>StarLedger</h1>
              <p>Search, sort, and filter your GitHub stars.</p>
            </div>
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
        {/* Always reflects the REQUESTED group and is never disabled: while
            the skills layer is not ready the choice stays in the link and
            applies once it loads (§15.6/§15.8). */}
        <label className="group">
          <span>Group</span>
          <select
            value={state.group}
            onChange={(e) => update({ group: e.target.value as GroupBy })}
          >
            <option value="none">None</option>
            <option value="skill">Skill category</option>
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
          <div className="results-head">
            <h2
              id="results-heading"
              tabIndex={-1}
              ref={resultsHeadingRef}
              className="results-heading"
            >
              Starred repositories
            </h2>
            {/* Context Builder (§19): export the current filtered set as portable
                Markdown/JSON without leaving the Starred view. */}
            <button
              type="button"
              className="copy-context-button"
              ref={copyContextRef}
              onClick={() => setContextOpen(true)}
            >
              Copy context
            </button>
          </div>

          <FilterChips
            state={state}
            update={update}
            onClearAll={() => reset()}
            onAfterRemove={focusResults}
            skillCategoryLabels={skillCategoryLabels}
          />

          {/* The grouped composition is pinned for "grouped, ready, ≥1 group"
              (§15.7); the zero-result and grouped-empty states keep the flat
              summary of the actual result set — their explanation lives in
              `NoResults` / E-G, so nothing is said twice. */}
          <p className="result-count" role="status">
            {grouped && grouped.groups.length > 0
              ? groupedResultSummary(
                  grouped.groupedCount,
                  grouped.groups.length,
                  grouped.excludedCount,
                  state.query,
                  effectiveFilterCount > 0,
                )
              : resultSummary(results.length, repos.length, state.query, effectiveFilterCount > 0)}
          </p>
          {/* U1 recovery (§15.7): the immediate sibling AFTER the summary and
              OUTSIDE its live region, so the announced text stays the summary
              alone. Only with ≥1 group — the grouped-empty state carries its
              own button. */}
          {grouped && grouped.groups.length > 0 && grouped.excludedCount > 0 ? (
            <button
              type="button"
              className="show-as-list"
              onClick={() => update({ group: 'none' })}
            >
              Show as list
            </button>
          ) : null}

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

          {groupRequestedButInert ? (
            <p className="degraded-notice" role="status">
              {skillsStatus === 'loading'
                ? 'Skills classification is still loading — grouped view will apply once it’s ready. Showing the list view meanwhile.'
                : 'Skills classification is unavailable, so grouped view isn’t applied and results are shown as a list. Group stays in your link and applies once the layer loads.'}
            </p>
          ) : null}

          {results.length === 0 ? (
            // Unchanged regardless of `group` (§15.7): nothing matched at all.
            <NoResults onClearFilters={clearFilters} />
          ) : grouped ? (
            grouped.groups.length === 0 ? (
              // E-G: matches exist, none classified — nothing to group (§15.7).
              <NoClassifiedResults
                excludedCount={grouped.excludedCount}
                onShowAsList={() => update({ group: 'none' })}
                onClearFilters={canClearFilters ? clearFilters : undefined}
              />
            ) : (
              // Grouped DOM (§15.8): h2 results → h3 group → h4 card. Every
              // group renders its WHOLE membership (single page, §15.5); `{id}`
              // is the taxonomy slug — unique per artifact, a valid DOM id.
              <div className="result-groups">
                {grouped.groups.map((group) => (
                  <section
                    key={group.id}
                    className="result-group"
                    aria-labelledby={`group-${group.id}`}
                  >
                    <h3 id={`group-${group.id}`} className="result-group-heading">
                      {group.label}{' '}
                      <span className="result-group-count">· {group.repos.length}</span>
                    </h3>
                    <ul className="card-list">
                      {group.repos.map((repo) => (
                        <RepositoryCard
                          key={repo.node_id}
                          repo={repo}
                          now={sessionNow}
                          selectedTopics={state.topics}
                          skillCategoryLabels={skillCategoryLabels}
                          headingLevel={4}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )
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

      <ContextExportPanel
        open={contextOpen}
        onClose={closeContext}
        returnFocusRef={copyContextRef}
        results={results}
        view={view}
        aiReady={aiReady}
        starsSha256={starsSha256}
        datasetGeneratedAt={datasetGeneratedAt}
      />
    </main>
  );
}
