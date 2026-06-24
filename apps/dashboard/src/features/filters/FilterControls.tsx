import { useId, useState } from 'react';
import type { ReleaseAvailability } from '../../data/derive-fields';
import type { BooleanFilter, DashboardState, HydrationStatus } from '../../state/dashboard-state';
import type { HistoryMode } from '../../state/use-dashboard-state';
import type { FacetOptions } from '../repositories/select';

type Option<T extends string> = { value: T; label: string };

const RELEASE_OPTIONS: Option<ReleaseAvailability>[] = [
  { value: 'has', label: 'Has release' },
  { value: 'none', label: 'No release' },
  { value: 'unavailable', label: 'Unavailable' },
];
const HYDRATION_OPTIONS: Option<HydrationStatus>[] = [
  { value: 'ok', label: 'OK' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
];
const BOOLEAN_OPTIONS: { value: BooleanFilter; label: string }[] = [
  { value: null, label: 'All' },
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Multi-select facet (OR within the facet). Renders nothing when there are no options. */
function CheckboxFacet<T extends string>({
  legend,
  options,
  selected,
  onChange,
  initialLimit,
  hideLegend = false,
  help,
}: {
  legend: string;
  options: Option<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  initialLimit?: number;
  hideLegend?: boolean;
  help?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const helpId = useId();
  if (options.length === 0) return null;
  const limited = initialLimit && !showAll ? options.slice(0, initialLimit) : options;
  const selectedOverflow =
    initialLimit && !showAll
      ? options.filter(
          (opt) => selected.includes(opt.value) && !limited.some((v) => v.value === opt.value),
        )
      : [];
  const visible = [...limited, ...selectedOverflow];
  const hiddenCount = options.length - visible.length;
  return (
    <fieldset className="facet" aria-describedby={help ? helpId : undefined}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      {help ? (
        <p id={helpId} className="facet-help">
          {help}
        </p>
      ) : null}
      <div className="facet-options">
        {visible.map((opt) => (
          <label key={opt.value} className="facet-option">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => onChange(toggle(selected, opt.value))}
            />
            {opt.label}
          </label>
        ))}
      </div>
      {hiddenCount > 0 ? (
        <button type="button" className="facet-more" onClick={() => setShowAll(true)}>
          Show {hiddenCount} more
        </button>
      ) : null}
    </fieldset>
  );
}

/** Tri-state All / Yes / No facet. */
function TriStateFacet({
  legend,
  value,
  onChange,
  help,
}: {
  legend: string;
  value: BooleanFilter;
  onChange: (next: BooleanFilter) => void;
  help?: string;
}) {
  const name = useId();
  const helpId = useId();
  return (
    <fieldset className="facet" aria-describedby={help ? helpId : undefined}>
      <legend>{legend}</legend>
      {help ? (
        <p id={helpId} className="facet-help">
          {help}
        </p>
      ) : null}
      <div className="facet-options">
        {BOOLEAN_OPTIONS.map((opt) => (
          <label key={String(opt.value)} className="facet-option">
            <input
              type="radio"
              name={name}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Topic facet: a long list, so a client-side filter narrows the visible checkboxes. */
function TopicFacet({
  topics,
  selected,
  onChange,
}: {
  topics: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  if (topics.length === 0) return null;
  const needle = filter.trim().toLowerCase();
  const matching = needle ? topics.filter((t) => t.toLowerCase().includes(needle)) : topics;
  const limited = showAll ? matching : matching.slice(0, 12);
  const selectedOverflow = showAll
    ? []
    : matching.filter((t) => selected.includes(t) && !limited.includes(t));
  const visible = [...limited, ...selectedOverflow];
  const hiddenCount = matching.length - visible.length;
  return (
    <fieldset className="facet">
      <legend className="visually-hidden">Topics</legend>
      <label className="facet-filter">
        <span className="visually-hidden">Filter topics</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter topics…"
        />
      </label>
      <div className="facet-options facet-options--scroll">
        {visible.map((t) => (
          <label key={t} className="facet-option">
            <input
              type="checkbox"
              checked={selected.includes(t)}
              onChange={() => onChange(toggle(selected, t))}
            />
            {t}
          </label>
        ))}
        {visible.length === 0 ? <p className="facet-empty">No matching topics</p> : null}
      </div>
      {hiddenCount > 0 ? (
        <button type="button" className="facet-more" onClick={() => setShowAll(true)}>
          Show {hiddenCount} more
        </button>
      ) : null}
    </fieldset>
  );
}

const opt = (v: string): Option<string> => ({ value: v, label: v });

function FilterSection({
  title,
  count,
  selectedCount,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  selectedCount: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const active = selectedCount > 0;
  return (
    <section className="filter-section">
      <button
        type="button"
        className="filter-section-trigger"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <span
          className={
            active ? 'filter-section-count filter-section-count--active' : 'filter-section-count'
          }
        >
          {active ? `${selectedCount} selected` : `${count} options`}
        </span>
        <span aria-hidden="true" className="filter-section-chevron">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="filter-section-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Every supported P1 facet. Semantics: AND across facets, OR within a facet.
 * Facet changes are discrete actions and push a history entry by default.
 *
 * The Data status facet is hidden unless the dataset actually contains degraded
 * repositories (or the filter is already active via a bookmark), so a fully
 * healthy dataset never surfaces an internal-sounding control with nothing to act on.
 */
export function FilterControls({
  state,
  facets,
  update,
  hasDegraded,
}: {
  state: DashboardState;
  facets: FacetOptions;
  update: (partial: Partial<DashboardState>, mode?: HistoryMode) => void;
  hasDegraded: boolean;
}) {
  const repoTypeSelected =
    (state.archived !== null ? 1 : 0) +
    (state.fork !== null ? 1 : 0) +
    (state.stale !== null ? 1 : 0);
  const showDataStatus = hasDegraded || state.hydrationStatuses.length > 0;
  return (
    <div className="filters">
      <FilterSection
        title="Language"
        count={facets.languages.length}
        selectedCount={state.languages.length}
        defaultOpen
      >
        <CheckboxFacet
          legend="Language"
          options={facets.languages.map(opt)}
          selected={state.languages}
          onChange={(languages) => update({ languages })}
          initialLimit={10}
          hideLegend
        />
      </FilterSection>
      <FilterSection
        title="Topics"
        count={facets.topics.length}
        selectedCount={state.topics.length}
        defaultOpen={false}
      >
        <TopicFacet
          topics={facets.topics}
          selected={state.topics}
          onChange={(topics) => update({ topics })}
        />
      </FilterSection>
      <FilterSection
        title="License"
        count={facets.licenses.length}
        selectedCount={state.licenses.length}
        defaultOpen={false}
      >
        <CheckboxFacet
          legend="License"
          options={facets.licenses.map(opt)}
          selected={state.licenses}
          onChange={(licenses) => update({ licenses })}
          initialLimit={10}
          hideLegend
        />
      </FilterSection>
      {facets.categories.length > 0 ? (
        <FilterSection
          title="AI category"
          count={facets.categories.length}
          selectedCount={state.categories.length}
          defaultOpen
        >
          <CheckboxFacet
            legend="AI category"
            options={facets.categories.map(opt)}
            selected={state.categories}
            onChange={(categories) => update({ categories })}
            initialLimit={10}
            hideLegend
            help="AI-generated classification — secondary to the GitHub description."
          />
        </FilterSection>
      ) : null}
      {facets.aiTags.length > 0 ? (
        <FilterSection
          title="AI tags"
          count={facets.aiTags.length}
          selectedCount={state.aiTags.length}
          defaultOpen={false}
        >
          <CheckboxFacet
            legend="AI tags"
            options={facets.aiTags.map(opt)}
            selected={state.aiTags}
            onChange={(aiTags) => update({ aiTags })}
            initialLimit={12}
            hideLegend
          />
        </FilterSection>
      ) : null}
      <FilterSection title="Repository type" count={3} selectedCount={repoTypeSelected} defaultOpen>
        <TriStateFacet
          legend="Archived"
          value={state.archived}
          onChange={(archived) => update({ archived })}
        />
        <TriStateFacet legend="Fork" value={state.fork} onChange={(fork) => update({ fork })} />
        <TriStateFacet
          legend="Stale"
          value={state.stale}
          onChange={(stale) => update({ stale })}
          help="No pushes in over a year."
        />
      </FilterSection>
      <FilterSection
        title="Release status"
        count={RELEASE_OPTIONS.length * 2}
        selectedCount={state.stableRelease.length + state.anyRelease.length}
        defaultOpen
      >
        <CheckboxFacet
          legend="Stable release"
          options={RELEASE_OPTIONS}
          selected={state.stableRelease}
          onChange={(stableRelease) => update({ stableRelease })}
          help="“Unavailable” means release data couldn’t be fetched — not the same as no release."
        />
        <CheckboxFacet
          legend="Any release"
          options={RELEASE_OPTIONS}
          selected={state.anyRelease}
          onChange={(anyRelease) => update({ anyRelease })}
        />
      </FilterSection>
      {showDataStatus ? (
        <FilterSection
          title="Data status"
          count={HYDRATION_OPTIONS.length}
          selectedCount={state.hydrationStatuses.length}
          defaultOpen={false}
        >
          <CheckboxFacet
            legend="Data"
            options={HYDRATION_OPTIONS}
            selected={state.hydrationStatuses}
            onChange={(hydrationStatuses) => update({ hydrationStatuses })}
            hideLegend
            help="How completely each repository’s metadata was fetched."
          />
        </FilterSection>
      ) : null}
    </div>
  );
}
