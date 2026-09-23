import { useId, useMemo, useState } from 'react';
import type { DiscoveryCandidate, CandidateStatus, SourceKind } from '@starred/discovery/contracts';
import type { LoadedDiscovery } from '../../data/load-discovery';
import { DiscoveryCard } from './DiscoveryCard';

interface DiscoveryFilter {
  status: CandidateStatus | 'all';
  language: string;
  sourceKind: SourceKind | 'all';
  archived: 'all' | 'active' | 'archived';
  query: string;
}

const DEFAULT_FILTER: DiscoveryFilter = {
  status: 'all',
  language: '',
  sourceKind: 'all',
  archived: 'all',
  query: '',
};

function matchesQuery(candidate: DiscoveryCandidate, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  if (candidate.full_name.toLowerCase().includes(lower)) return true;
  if (candidate.description?.toLowerCase().includes(lower)) return true;
  if (candidate.first_seen_source.raw_ref?.toLowerCase().includes(lower)) return true;
  return false;
}

function applyFilter(
  candidates: readonly DiscoveryCandidate[],
  filter: DiscoveryFilter,
): DiscoveryCandidate[] {
  return candidates.filter((c) => {
    if (filter.status !== 'all' && c.status !== filter.status) return false;
    if (filter.language && c.primary_language !== filter.language) return false;
    if (filter.sourceKind !== 'all' && c.first_seen_source.kind !== filter.sourceKind) return false;
    if (filter.archived === 'active' && c.archived) return false;
    if (filter.archived === 'archived' && !c.archived) return false;
    return matchesQuery(c, filter.query);
  });
}

function deriveLanguages(candidates: readonly DiscoveryCandidate[]): string[] {
  const langs = new Set<string>();
  for (const c of candidates) {
    if (c.primary_language) langs.add(c.primary_language);
  }
  return [...langs].sort();
}

function deriveSourceKinds(candidates: readonly DiscoveryCandidate[]): SourceKind[] {
  const kinds = new Set<SourceKind>();
  for (const c of candidates) {
    kinds.add(c.first_seen_source.kind);
  }
  return [...kinds].sort() as SourceKind[];
}

export function DiscoveryInbox({ discovery }: { discovery: LoadedDiscovery }) {
  const [filter, setFilter] = useState<DiscoveryFilter>(DEFAULT_FILTER);
  const searchId = useId();

  const languages = useMemo(() => deriveLanguages(discovery.candidates), [discovery.candidates]);
  const sourceKinds = useMemo(
    () => deriveSourceKinds(discovery.candidates),
    [discovery.candidates],
  );
  const results = useMemo(
    () => applyFilter(discovery.candidates, filter),
    [discovery.candidates, filter],
  );

  const update = (patch: Partial<DiscoveryFilter>) => setFilter((prev) => ({ ...prev, ...patch }));

  return (
    <section className="discovery-inbox" aria-labelledby="discovery-heading">
      <h2 id="discovery-heading" className="results-heading">
        Discovery Inbox
      </h2>
      <p className="discovery-meta">
        {discovery.candidateCount} candidate{discovery.candidateCount === 1 ? '' : 's'}
        {' · '}
        {discovery.sourceCount} source{discovery.sourceCount === 1 ? '' : 's'}
        {' · '}
        Generated {new Date(discovery.generatedAt).toISOString().slice(0, 10)}
      </p>

      <div className="discovery-toolbar">
        <div className="search">
          <label className="visually-hidden" htmlFor={searchId}>
            Search candidates
          </label>
          <input
            id={searchId}
            type="search"
            value={filter.query}
            onChange={(e) => update({ query: e.target.value })}
            placeholder="Search candidates..."
          />
          {filter.query ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => update({ query: '' })}
            >
              ×
            </button>
          ) : null}
        </div>

        <select
          value={filter.status}
          onChange={(e) => update({ status: e.target.value as DiscoveryFilter['status'] })}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="candidate">Candidate</option>
          <option value="promoted">Promoted</option>
          <option value="dismissed">Dismissed</option>
        </select>

        {languages.length > 0 ? (
          <select
            value={filter.language}
            onChange={(e) => update({ language: e.target.value })}
            aria-label="Filter by language"
          >
            <option value="">All languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        ) : null}

        {sourceKinds.length > 1 ? (
          <select
            value={filter.sourceKind}
            onChange={(e) =>
              update({ sourceKind: e.target.value as DiscoveryFilter['sourceKind'] })
            }
            aria-label="Filter by source"
          >
            <option value="all">All sources</option>
            {sourceKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        ) : null}

        <select
          value={filter.archived}
          onChange={(e) => update({ archived: e.target.value as DiscoveryFilter['archived'] })}
          aria-label="Filter by archived status"
        >
          <option value="all">Active & archived</option>
          <option value="active">Active only</option>
          <option value="archived">Archived only</option>
        </select>
      </div>

      <p className="result-count" role="status">
        {results.length} of {discovery.candidateCount} candidates
        {filter.query ? ` for "${filter.query}"` : ''}
      </p>

      {results.length === 0 ? (
        <div className="no-results">
          <h3>No candidates match</h3>
          <p>Try adjusting your filters or search query.</p>
          <button type="button" onClick={() => setFilter(DEFAULT_FILTER)}>
            Clear all filters
          </button>
        </div>
      ) : (
        <ul className="card-list">
          {results.map((candidate) => (
            <DiscoveryCard key={candidate.node_id} candidate={candidate} />
          ))}
        </ul>
      )}
    </section>
  );
}
