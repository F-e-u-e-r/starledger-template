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
      set({ ...stateRef.current, ...partial }, mode);
    },
    [set],
  );

  const reset = useCallback(
    (mode: HistoryMode = 'push') => set(DEFAULT_DASHBOARD_STATE, mode),
    [set],
  );

  return { state, update, set, reset };
}
