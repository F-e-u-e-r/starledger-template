import type { ReleaseAvailability } from '../../data/derive-fields';
import type { DashboardState, HydrationStatus } from '../../state/dashboard-state';
import type { HistoryMode } from '../../state/use-dashboard-state';

const RELEASE_LABEL: Record<ReleaseAvailability, string> = {
  has: 'Has release',
  none: 'No release',
  unavailable: 'Unavailable',
};
const HYDRATION_LABEL: Record<HydrationStatus, string> = {
  ok: 'OK',
  partial: 'Partial',
  failed: 'Failed',
};

interface Chip {
  id: string;
  label: string;
  remove: () => void;
}

function buildChips(
  state: DashboardState,
  update: (partial: Partial<DashboardState>, mode?: HistoryMode) => void,
): Chip[] {
  const chips: Chip[] = [];

  for (const v of state.languages) {
    chips.push({
      id: `language:${v}`,
      label: `Language: ${v}`,
      remove: () => update({ languages: state.languages.filter((x) => x !== v) }),
    });
  }
  for (const v of state.topics) {
    chips.push({
      id: `topic:${v}`,
      label: `Topic: ${v}`,
      remove: () => update({ topics: state.topics.filter((x) => x !== v) }),
    });
  }
  for (const v of state.licenses) {
    chips.push({
      id: `license:${v}`,
      label: `License: ${v}`,
      remove: () => update({ licenses: state.licenses.filter((x) => x !== v) }),
    });
  }
  for (const v of state.categories) {
    chips.push({
      id: `category:${v}`,
      label: `Category: ${v}`,
      remove: () => update({ categories: state.categories.filter((x) => x !== v) }),
    });
  }
  for (const v of state.aiTags) {
    chips.push({
      id: `aiTag:${v}`,
      label: `AI tag: ${v}`,
      remove: () => update({ aiTags: state.aiTags.filter((x) => x !== v) }),
    });
  }
  if (state.archived !== null) {
    chips.push({
      id: 'archived',
      label: `Archived: ${state.archived ? 'Yes' : 'No'}`,
      remove: () => update({ archived: null }),
    });
  }
  if (state.fork !== null) {
    chips.push({
      id: 'fork',
      label: `Fork: ${state.fork ? 'Yes' : 'No'}`,
      remove: () => update({ fork: null }),
    });
  }
  if (state.stale !== null) {
    chips.push({
      id: 'stale',
      label: `Stale: ${state.stale ? 'Yes' : 'No'}`,
      remove: () => update({ stale: null }),
    });
  }
  for (const v of state.stableRelease) {
    chips.push({
      id: `stable:${v}`,
      label: `Stable: ${RELEASE_LABEL[v]}`,
      remove: () => update({ stableRelease: state.stableRelease.filter((x) => x !== v) }),
    });
  }
  for (const v of state.anyRelease) {
    chips.push({
      id: `any:${v}`,
      label: `Any release: ${RELEASE_LABEL[v]}`,
      remove: () => update({ anyRelease: state.anyRelease.filter((x) => x !== v) }),
    });
  }
  for (const v of state.hydrationStatuses) {
    chips.push({
      id: `hydration:${v}`,
      label: `Data: ${HYDRATION_LABEL[v]}`,
      remove: () => update({ hydrationStatuses: state.hydrationStatuses.filter((x) => x !== v) }),
    });
  }
  return chips;
}

export function activeFilterCount(state: DashboardState): number {
  return buildChips(state, () => {}).length;
}

/**
 * Active-filter chips: one chip per selected value, each removable on its own,
 * plus a clear-all. After any removal focus is handed to `onAfterRemove` so it is
 * never dropped to <body> when a chip unmounts (A11Y-4).
 */
export function FilterChips({
  state,
  update,
  onClearAll,
  onAfterRemove,
}: {
  state: DashboardState;
  update: (partial: Partial<DashboardState>, mode?: HistoryMode) => void;
  onClearAll: () => void;
  onAfterRemove: () => void;
}) {
  const chips = buildChips(state, update);
  if (chips.length === 0) return null;

  return (
    <div className="chips" role="group" aria-label="Active filters">
      <span className="chips-count">
        {chips.length} active filter{chips.length === 1 ? '' : 's'}
      </span>
      <ul className="chips-list">
        {chips.map((chip) => (
          <li key={chip.id}>
            <button
              type="button"
              className="chip"
              onClick={() => {
                chip.remove();
                onAfterRemove();
              }}
            >
              <span>{chip.label}</span>
              <span aria-hidden="true" className="chip-x">
                ×
              </span>
              <span className="visually-hidden"> — remove filter</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="chip-clear"
        onClick={() => {
          onClearAll();
          onAfterRemove();
        }}
      >
        Clear all
      </button>
    </div>
  );
}
