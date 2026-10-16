import { useId, useMemo, useState } from 'react';
import type { CanonicalRepo } from '@starred/schema';
import { deriveAll } from '../../data/derive-fields';
import type { AnnotationStatus, LoadedAnnotations } from '../../data/load-annotations';
import type {
  LoadedSkillsClassification,
  SkillsClassificationStatus,
} from '../../data/load-skills-classification';
import {
  type Coverage,
  type Provenance,
  computeCategoryDistribution,
  computeClassificationCoverage,
  computeStaleStars,
  computeStarringActivity,
} from '@starred/insights';

/**
 * M4.3a Insights view (P7 §17): four deterministic read-only insight cards
 * (PC · SA · ST · CC) over the SAME loaded stars dataset the Starred view uses.
 * Each card is INDEPENDENTLY fail-soft: PC needs the AI layer coherent-ready and
 * CC needs the skills layer coherent-ready (same status-AND-data gate as
 * RepositoryView, F4/§4.11); SA and ST are canonical and always render. The repo
 * browse state is not read here — it is preserved-but-inactive while this view is
 * active (App does not mount RepositoryView). No trend/growth claim is made: every
 * number is a function of the current snapshot (§17, orientation crux).
 */
export function InsightsView({
  repos,
  annotations,
  annotationStatus,
  skillsClassification,
  skillsStatus,
  starsSha256,
  initialNow,
}: {
  repos: CanonicalRepo[];
  annotations?: LoadedAnnotations | null;
  annotationStatus?: AnnotationStatus;
  skillsClassification?: LoadedSkillsClassification | null;
  skillsStatus?: SkillsClassificationStatus;
  starsSha256?: string;
  initialNow?: Date;
}) {
  const [sessionNow] = useState(() => initialNow ?? new Date());
  // Coherent-ready gates — status `ready` AND data present (F4 parity). Neither
  // half alone activates; the join map is passed only when ready, so a not-ready
  // layer STRUCTURALLY cannot contribute to an insight.
  const aiReady = annotationStatus === 'ready' && annotations != null;
  const skillsReady = skillsStatus === 'ready' && skillsClassification != null;

  const derived = useMemo(
    () =>
      deriveAll(
        repos,
        sessionNow,
        aiReady ? annotations?.byNodeId : undefined,
        skillsReady ? skillsClassification?.byNodeId : undefined,
      ),
    [repos, sessionNow, aiReady, annotations, skillsReady, skillsClassification],
  );

  const category = useMemo(
    () => computeCategoryDistribution(derived, aiReady ? annotations?.generatedAt : undefined),
    [derived, aiReady, annotations],
  );
  const activity = useMemo(() => computeStarringActivity(derived), [derived]);
  const stale = useMemo(() => computeStaleStars(derived), [derived]);
  const classification = useMemo(
    () =>
      computeClassificationCoverage(
        derived,
        skillsReady ? skillsClassification! : null,
        starsSha256,
      ),
    [derived, skillsReady, skillsClassification, starsSha256],
  );

  const maxCategory = category.rows.reduce((m, r) => Math.max(m, r.count), 0);
  const maxMonth = activity.buckets.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <main className="insights">
      <header className="insights-head">
        <h1>Insights</h1>
        <p>
          Deterministic summaries of your {repos.length} starred{' '}
          {repos.length === 1 ? 'repository' : 'repositories'}. Every number is computed from the
          current snapshot — no trends over time (repos you have unstarred are not in the data).
        </p>
      </header>

      <ul className="insight-cards">
        {/* PC — primary-category distribution (AI layer, coherent-ready gated) */}
        <InsightCard
          title="Stars by AI category"
          provenance={category.provenance}
          coverage={category.coverage}
        >
          {aiReady ? (
            category.rows.length > 0 ? (
              <DistributionTable
                caption="Your stars grouped by AI category"
                unitHeader="Category"
                rows={category.rows.map((r) => ({ label: r.category, count: r.count }))}
                max={maxCategory}
              />
            ) : (
              <p className="insight-empty">No AI categories to show.</p>
            )
          ) : (
            <LayerDegraded
              layer="AI classification"
              status={annotationStatus}
              purpose="the category breakdown"
            />
          )}
        </InsightCard>

        {/* SA — starring activity by UTC month (canonical, always renders) */}
        <InsightCard
          title="When you starred them"
          provenance={activity.provenance}
          coverage={activity.coverage}
        >
          <p className="insight-note">
            Repos you currently hold, counted by the UTC month you starred them. This is not a
            trend: repos you have since unstarred are not in the data.
          </p>
          {activity.buckets.length > 0 ? (
            <DistributionTable
              caption="Repos starred per UTC month (currently held)"
              unitHeader="Month"
              rows={activity.buckets.map((b) => ({ label: b.month, count: b.count }))}
              max={maxMonth}
            />
          ) : (
            <p className="insight-empty">No dated stars to show.</p>
          )}
        </InsightCard>

        {/* ST — stale / forgotten stars (canonical, always renders) */}
        <InsightCard
          title="Forgotten stars"
          provenance={stale.provenance}
          coverage={stale.coverage}
        >
          <p className="insight-stat">
            <strong>{stale.staleCount}</strong> of {repos.length}{' '}
            {repos.length === 1 ? 'star' : 'stars'} {stale.staleCount === 1 ? 'is' : 'are'} stale —
            upstream has not pushed in over {stale.thresholdMonths} months.
          </p>
          {stale.unknownPushCount > 0 ? (
            <p className="insight-note">
              {stale.unknownPushCount}{' '}
              {stale.unknownPushCount === 1 ? 'repository has' : 'repositories have'} an unknown
              push date and {stale.unknownPushCount === 1 ? 'is' : 'are'} not counted as stale.
            </p>
          ) : null}
        </InsightCard>

        {/* CC — skills classification coverage (skills layer, coherent-ready gated) */}
        <InsightCard
          title="Skills classification coverage"
          provenance={classification.provenance}
          coverage={classification.coverage}
        >
          {skillsReady ? (
            <>
              <p className="insight-stat">
                <strong>{classification.matched}</strong> of {repos.length}{' '}
                {repos.length === 1 ? 'star is' : 'stars are'} in the curated skills-ecosystem
                classification.
              </p>
              <p className="insight-note">
                This is a curated subset — the other {repos.length - classification.matched} are
                outside it, not classification failures.
                {classification.stale
                  ? ' It was generated against an earlier stars snapshot, so this coverage may lag the current dataset.'
                  : ''}
                {classification.unresolved > 0 ? (
                  <>
                    {' '}
                    {classification.unresolved} source{' '}
                    {classification.unresolved === 1 ? 'entry was' : 'entries were'} unresolved at
                    generation time (never matched to a repository when the classification was
                    generated).
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <LayerDegraded
              layer="Skills classification"
              status={skillsStatus}
              purpose="classification coverage"
            />
          )}
        </InsightCard>
      </ul>
    </main>
  );
}

/** One insight card: heading, body, and the always-present provenance footer. */
function InsightCard({
  title,
  provenance,
  coverage,
  children,
}: {
  title: string;
  provenance: Provenance;
  coverage: Coverage;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <li>
      <section className="insight-card" aria-labelledby={headingId}>
        <h2 id={headingId} className="insight-card-title">
          {title}
        </h2>
        {children}
        <p className="insight-provenance">
          {provenance.method}. Source: {provenance.sourceFields.join(', ')}. Formula:{' '}
          {provenance.formula}. Coverage: {coverage.n} of {coverage.of} ({coverage.layer})
          {coverage.generatedAt ? `, generated ${coverage.generatedAt.slice(0, 10)}` : ''}.
        </p>
      </section>
    </li>
  );
}

/**
 * An accessible distribution as a table — the table IS the text equivalent, so no
 * separate alt text is needed. The bar is a decorative, aria-hidden width cue; the
 * count cell carries the real value.
 */
function DistributionTable({
  caption,
  unitHeader,
  rows,
  max,
}: {
  caption: string;
  unitHeader: string;
  rows: { label: string; count: number }[];
  max: number;
}) {
  return (
    <table className="insight-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{unitHeader}</th>
          <th scope="col">Repos</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>
              <span
                className="insight-bar"
                aria-hidden="true"
                style={{ inlineSize: max > 0 ? `${(row.count / max) * 100}%` : '0%' }}
              />
              <span className="insight-count">{row.count}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Per-card degraded notice when an optional layer is not coherent-ready. */
function LayerDegraded({
  layer,
  status,
  purpose,
}: {
  layer: string;
  status: AnnotationStatus | SkillsClassificationStatus | undefined;
  purpose: string;
}) {
  return (
    <p className="insight-degraded" role="status">
      {status === 'loading'
        ? `${layer} is still loading — ${purpose} will appear once it’s ready.`
        : `${layer} is unavailable, so ${purpose} isn’t shown.`}
    </p>
  );
}
