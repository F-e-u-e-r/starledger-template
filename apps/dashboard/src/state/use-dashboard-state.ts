import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DashboardState,
  DEFAULT_DASHBOARD_STATE,
  normalizeDashboardState,
  parseDashboardState,
  serializeDashboardState,
} from './dashboard-state';

/** `replace` for rapid changes (typing); `push` for discrete actions (a new history entry). */
export type HistoryMode = 'push' | 'replace';

/**
 * Fields whose semantic change resets `page → 1` (§6.3). `density` and `page`
 * itself are intentionally absent: density never resets, and an explicit page is
 * handled separately. `scope`/`skillCategories` joined with M2.4 (§4.11).
 */
const PAGE_RESET_FIELDS: readonly (keyof DashboardState)[] = [
  'view',
  'scope',
  'query',
  'sort',
  'direction',
  'languages',
  'topics',
  'licenses',
  'categories',
  'aiTags',
  'skillCategories',
  'archived',
  'fork',
  'stale',
  'stableRelease',
  'anyRelease',
  'hydrationStatuses',
];

/** Value equality for canonical fields (arrays are already sorted + deduped). */
function fieldsEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function readUrlState(): DashboardState {
  return parseDashboardState(new URLSearchParams(window.location.search));
}

function writeUrl(state: DashboardState, mode: HistoryMode): void {
  const qs = serializeDashboardState(state);
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  if (mode === 'replace') window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

export interface DashboardStateControls {
  state: DashboardState;
  /** Merge a partial update. `mode` defaults to 'push'; pass 'replace' for typing. */
  update: (partial: Partial<DashboardState>, mode?: HistoryMode) => void;
  set: (next: DashboardState, mode?: HistoryMode) => void;
  reset: (mode?: HistoryMode) => void;
}

/**
 * Canonical dashboard state, synchronized with the URL. Initialized from the URL
 * (so reload and shared links restore state), written back on every change, and
 * restored on back/forward via `popstate`. The state object is the single source
 * of truth; the URL is a projection of it.
 *
 * Call this ONCE at the top of the tree (App) and pass the controls down — a
 * second instance would hold a competing React copy and desync from this one
 * (pushState/replaceState do not fire `popstate`).
 */
export function useDashboardState(): DashboardStateControls {
  const [state, setState] = useState<DashboardState>(readUrlState);

  // Mirror the latest state in a ref so updaters can read it without running side
  // effects inside the reducer (which StrictMode double-invokes).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Back/forward navigation restores state FROM the URL (no write-back).
  useEffect(() => {
    const onPop = () => setState(readUrlState());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const set = useCallback((next: DashboardState, mode: HistoryMode = 'push') => {
    // Keep the in-memory state canonical too (not just the URL), so the state
    // object is genuinely the single source of truth.
    const canonical = normalizeDashboardState(next);
    stateRef.current = canonical;
    writeUrl(canonical, mode);
    setState(canonical);
  }, []);

  const update = useCallback(
    (partial: Partial<DashboardState>, mode: HistoryMode = 'push') => {
      const current = stateRef.current;
      const merged = normalizeDashboardState({ ...current, ...partial });
      // Reset page → 1 only on a genuine value change to a reset-triggering field
      // (not mere key presence), and never when the caller set `page` explicitly.
      const pageExplicit = 'page' in partial;
      const semanticChange =
        !pageExplicit && PAGE_RESET_FIELDS.some((f) => !fieldsEqual(current[f], merged[f]));
      set(semanticChange ? { ...merged, page: 1 } : merged, mode);
    },
    [set],
  );

  const reset = useCallback(
    (mode: HistoryMode = 'push') =>
      // "Clear all" clears the query axis (search / sort / filters) and returns to
      // page 1, but PRESERVES the user's `view` (active tab) and `density` (display
      // preference): a filter clear-all must not discard navigation/display choices.
      set(
        {
          ...DEFAULT_DASHBOARD_STATE,
          view: stateRef.current.view,
          density: stateRef.current.density,
        },
        mode,
      ),
    [set],
  );

  return { state, update, set, reset };
}
