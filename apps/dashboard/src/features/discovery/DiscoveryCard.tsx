import type { DiscoveryCandidate } from '@starred/discovery/contracts';

function fmtStars(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}m`;
  if (value >= 100000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<string, string> = {
  candidate: 'Candidate',
  dismissed: 'Dismissed',
  promoted: 'Promoted',
};

export function DiscoveryCard({ candidate }: { candidate: DiscoveryCandidate }) {
  const statusClass = `badge-discovery-${candidate.status}`;

  return (
    <li className="card discovery-card">
      <div className="card-top">
        <div className="card-identity">
          <h3 className="card-title">
            <a href={candidate.html_url}>{candidate.full_name}</a>
          </h3>
          <span className="badges">
            <span className={`badge ${statusClass}`}>
              {STATUS_LABELS[candidate.status] ?? candidate.status}
            </span>
            {candidate.archived ? <span className="badge badge-archived">Archived</span> : null}
            {candidate.fork ? <span className="badge badge-fork">Fork</span> : null}
          </span>
        </div>
        <span className="star-count">
          {candidate.stargazer_count !== null ? (
            <span
              aria-label={`${candidate.stargazer_count} stars`}
              title={`${candidate.stargazer_count} stars`}
            >
              ★ {fmtStars(candidate.stargazer_count)}
            </span>
          ) : null}
        </span>
      </div>

      {candidate.description ? (
        <p className="card-desc" title={candidate.description}>
          {candidate.description}
        </p>
      ) : null}

      <ul className="repo-highlights" aria-label="Candidate highlights">
        <li>{candidate.primary_language ?? <span className="none">No language</span>}</li>
        <li>
          {candidate.sources.length} source{candidate.sources.length === 1 ? '' : 's'}
          {' · '}
          {candidate.first_seen_source.kind}
        </li>
        <li>Discovered {fmtDate(candidate.discovered_at)}</li>
      </ul>

      {candidate.first_seen_source.raw_ref ? (
        <p className="discovery-note">{candidate.first_seen_source.raw_ref}</p>
      ) : null}

      {candidate.decision_reason ? (
        <p className="discovery-reason">{candidate.decision_reason}</p>
      ) : null}

      <div className="card-footer">
        <span>{candidate.first_seen_source.kind}</span>
        <span>
          <a href={candidate.html_url} className="discovery-open">
            Open on GitHub
          </a>
        </span>
      </div>
    </li>
  );
}
