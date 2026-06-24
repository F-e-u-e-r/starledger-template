import { useState } from 'react';
import type { DerivedRepo, ReleaseAvailability } from '../../data/derive-fields';

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function fmtMonthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(d);
}

function fmtRelativeDate(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return `Updated ${fmtDate(iso)}`;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
  return `Updated ${fmtMonthYear(iso)}`;
}

function fmtStars(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}m`;
  if (value >= 100000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function unavailable(repo: DerivedRepo, field: string): boolean {
  return (repo.unavailable_fields as readonly string[]).includes(field);
}

const UNKNOWN = <span className="unknown">Information unavailable</span>;
const TOPIC_LIMIT = 4;

function ReleaseValue({
  availability,
  tag,
  date,
  kind,
}: {
  availability: ReleaseAvailability;
  tag: string | null;
  date: string | null;
  kind: string;
}) {
  if (availability === 'unavailable') return UNKNOWN;
  if (availability === 'none') return <span className="none">{`No ${kind} release`}</span>;
  return (
    <span>
      {tag}
      {date ? <span className="muted"> · {date}</span> : null}
    </span>
  );
}

/**
 * One responsive repository entry. A field that is `null` but NOT in
 * `unavailable_fields` renders as confirmed-absent ("None" / "No release"); a
 * field listed as unavailable renders as "Information unavailable" — the two are
 * never conflated (DATA-4 / CARD-1).
 */
export function RepositoryCard({ repo, now = new Date() }: { repo: DerivedRepo; now?: Date }) {
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const starred = fmtMonthYear(repo.starred_at);
  const pushed = unavailable(repo, 'pushed_at')
    ? UNKNOWN
    : (fmtRelativeDate(repo.pushed_at, now) ?? <span className="none">No push date</span>);
  const language = unavailable(repo, 'primary_language')
    ? UNKNOWN
    : (repo.primary_language ?? <span className="none">No language</span>);
  const license = unavailable(repo, 'license_spdx')
    ? UNKNOWN
    : (repo.license_spdx ?? <span className="none">No license</span>);
  const stars = unavailable(repo, 'stargazer_count') ? null : (repo.stargazer_count ?? 0);
  const degraded = repo.hydration_status !== 'ok';
  // Latest (any) release sits next to the stable release, but only when it adds
  // information — a prerelease-only repo, or a prerelease newer than the stable
  // tag — so the common "stable == latest" case is not stated twice (CARD-5).
  const stableTag = repo.latest_stable_release?.tag_name ?? null;
  const latestTag = repo.latest_any_release?.tag_name ?? null;
  const latestDate = fmtDate(repo.latest_any_release?.published_at ?? null);
  const showLatest =
    repo.anyRelease === 'has' && (repo.stableRelease !== 'has' || latestTag !== stableTag);
  const visibleTopics = topicsExpanded ? repo.topics : repo.topics.slice(0, TOPIC_LIMIT);
  const hiddenTopicCount = Math.max(0, repo.topics.length - visibleTopics.length);
  const aiGenerated = repo.ai ? fmtDate(repo.ai.generatedAt) : null;

  return (
    <li className="card">
      <div className="card-top">
        <div className="card-identity">
          <h3 className="card-title">
            <a href={repo.url}>{repo.name_with_owner}</a>
          </h3>
          <span className="badges">
            {repo.is_archived === true ? (
              <span className="badge badge-archived">Archived</span>
            ) : null}
            {repo.is_fork === true ? <span className="badge badge-fork">Fork</span> : null}
            {degraded ? (
              <span className="badge badge-degraded">
                {repo.hydration_status === 'failed' ? 'Data unavailable' : 'Partial data'}
              </span>
            ) : null}
          </span>
        </div>
        <span className="star-count">
          {stars === null ? (
            UNKNOWN
          ) : (
            <span aria-label={`${stars} stars`} title={`${stars} stars`}>
              ★ {fmtStars(stars)}
            </span>
          )}
        </span>
      </div>

      {repo.description ? (
        <p className="card-desc" title={repo.description}>
          {repo.description}
        </p>
      ) : null}

      {repo.ai ? (
        <section className="card-ai" aria-label="AI enrichment">
          <p className="ai-head">
            <span className="badge badge-ai">
              AI<span className="visually-hidden">-generated</span>
            </span>
            <span className="ai-category">{repo.ai.category}</span>
          </p>
          <p className="ai-summary">{repo.ai.summary}</p>
          {repo.ai.tags.length > 0 ? (
            <ul className="ai-tags" aria-label="AI tags">
              {repo.ai.tags.map((t) => (
                <li key={t} className="ai-tag">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="ai-meta muted">
            AI-generated{aiGenerated ? ` · ${aiGenerated}` : ''}
            {repo.ai.modelLabel ? ` · ${repo.ai.modelLabel}` : ''}
          </p>
        </section>
      ) : null}

      <ul className="repo-highlights" aria-label="Repository highlights">
        <li>{language}</li>
        <li>{pushed}</li>
        <li>
          <ReleaseValue
            availability={repo.stableRelease}
            tag={repo.latest_stable_release?.tag_name ?? null}
            date={fmtDate(repo.latest_stable_release?.published_at ?? null)}
            kind="stable"
          />
        </li>
        {showLatest ? (
          <li className="latest-release">
            latest {latestTag}
            {latestDate ? <span className="muted"> · {latestDate}</span> : null}
          </li>
        ) : null}
      </ul>

      {repo.topics.length > 0 ? (
        <ul className="topics" aria-label="Topics">
          {visibleTopics.map((t) => (
            <li key={t} className="topic">
              {t}
            </li>
          ))}
          {hiddenTopicCount > 0 ? (
            <li>
              <button
                type="button"
                className="topic topic-more"
                aria-expanded={topicsExpanded}
                onClick={() => setTopicsExpanded(true)}
              >
                +{hiddenTopicCount}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="card-footer">
        <span>{license}</span>
        <span>
          {starred ? `Starred ${starred}` : <span className="none">Starred date unknown</span>}
        </span>
      </div>
    </li>
  );
}
