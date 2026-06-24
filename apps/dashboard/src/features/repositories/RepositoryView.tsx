import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { CanonicalRepo } from '@starred/schema';
import { NoResults } from '../../components/states';
import type { LoadedAnnotations } from '../../data/load-annotations';
import { useDashboardState } from '../../state/use-dashboard-state';
import { activeFilterCount, FilterChips } from '../filters/FilterChips';
import { FilterControls } from '../filters/FilterControls';
import { FilterDrawer } from '../filters/FilterDrawer';
import { SORT_FIELDS, type SortField } from '../sorting/sorting';
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
 * text, and `deriveFacetOptions`) is memoized by [repos, sessionNow]; only the
 * cheap search/filter/sort pass re-runs as the dashboard state changes.
 */
export function RepositoryView({
  repos,
  datasetGeneratedAt,
  initialNow,
  annotations,
}: {
  repos: CanonicalRepo[];
  datasetGeneratedAt?: string;
  initialNow?: Date;
  annotations?: LoadedAnnotations | null;
}) {
  const { state, update, reset } = useDashboardState();
  const [sessionNow] = useState(() => initialNow ?? new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const searchId = useId();

  const annotationsByNodeId = annotations?.byNodeId;
  const prepared = useMemo(
    () => prepareRepositories(repos, sessionNow, annotationsByNodeId),
    [repos, sessionNow, annotationsByNodeId],
  );
  const facets = useMemo(() => deriveFacetOptions(prepared), [prepared]);
  const aiCount = useMemo(() => prepared.reduce((n, r) => (r.ai ? n + 1 : n), 0), [prepared]);
  const hasDegraded = useMemo(() => repos.some((repo) => repo.hydration_status !== 'ok'), [repos]);
  const results = useMemo(
    () => selectFromPrepared(prepared, dashboardToView(state)),
    [prepared, state],
  );

  // Stable focus target so chip removal / clear-all never drop focus to <body>.
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusResults = () => resultsHeadingRef.current?.focus();
  // Drawer close restores focus here, never to <body> (A11Y-5).
  const filtersToggleRef = useRef<HTMLButtonElement>(null);
  const filterCount = activeFilterCount(state);

  return (
    <main className="dashboard">
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
        <div className="toolbar">
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
            Filters{filterCount > 0 ? ` ${filterCount}` : ''}
          </button>
          <label className="sort">
            <span>Sort</span>
            <select
              value={state.sort}
              onChange={(e) => update({ sort: e.target.value as SortField })}
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
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label="Filters">
          <FilterControls state={state} facets={facets} update={update} hasDegraded={hasDegraded} />
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
          />

          <p className="result-count" role="status">
            {resultSummary(results.length, repos.length, state.query, filterCount > 0)}
          </p>

          {results.length === 0 ? (
            <NoResults
              onClearFilters={() => {
                reset();
                focusResults();
              }}
            />
          ) : (
            <ul className="card-list">
              {results.map((repo) => (
                <RepositoryCard key={repo.node_id} repo={repo} now={sessionNow} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <FilterDrawer open={filtersOpen} onClose={closeFilters} returnFocusRef={filtersToggleRef}>
        <FilterControls state={state} facets={facets} update={update} hasDegraded={hasDegraded} />
      </FilterDrawer>
    </main>
  );
}
