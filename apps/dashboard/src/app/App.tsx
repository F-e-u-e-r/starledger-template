import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, Loading } from '../components/states';
import {
  type AnnotationStatus,
  type LoadedAnnotations,
  loadAnnotations,
} from '../data/load-annotations';
import { type LoadedDiscovery, loadDiscovery } from '../data/load-discovery';
import { type LoadedSkillsClassification } from '../data/load-skills-classification';
import { useSkillsClassification } from '../data/use-skills-classification';
import {
  type DataLoadKind,
  DataLoadError,
  type LoadedDataset,
  loadStars,
} from '../data/load-stars';
import { DiscoveryInbox } from '../features/discovery/DiscoveryInbox';
import { InsightsView } from '../features/insights/InsightsView';
import { RepositoryView } from '../features/repositories/RepositoryView';
import { useDashboardState } from '../state/use-dashboard-state';

type State =
  | { status: 'loading' }
  | { status: 'error'; kind: DataLoadKind | 'unknown'; message: string }
  | { status: 'loaded'; data: LoadedDataset };

export interface AppProps {
  /** Injectable for tests; defaults to loading from the Pages base path. */
  loader?: () => Promise<LoadedDataset>;
  /** Injectable for tests; the optional, fail-soft AI enrichment loader. */
  annotationsLoader?: () => Promise<LoadedAnnotations | null>;
  /** Injectable for tests; the optional, fail-soft discovery inbox loader. */
  discoveryLoader?: () => Promise<LoadedDiscovery | null>;
  /** Injectable for tests; the optional, fail-soft skills-classification loader (M2.3). */
  skillsClassificationLoader?: () => Promise<LoadedSkillsClassification | null>;
}

export function App({
  loader,
  annotationsLoader,
  discoveryLoader,
  skillsClassificationLoader,
}: AppProps = {}) {
  const controls = useDashboardState();
  // The optional skills-classification layer (fail-soft, §4.10). M2.4 projects
  // it into the Starred view: scope + facet + badges (§4.11). Any failure or
  // in-flight state only neutralizes the skills-dependent controls — the base
  // browser is never affected.
  const skills = useSkillsClassification(skillsClassificationLoader);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [annotations, setAnnotations] = useState<LoadedAnnotations | null>(null);
  const [annotationStatus, setAnnotationStatus] = useState<AnnotationStatus>('loading');
  const [discovery, setDiscovery] = useState<LoadedDiscovery | null>(null);

  useEffect(() => {
    const load = loader ?? (() => loadStars({ base: import.meta.env.BASE_URL }));
    const loadAnn =
      annotationsLoader ?? (() => loadAnnotations({ base: import.meta.env.BASE_URL }));
    const loadDisc = discoveryLoader ?? (() => loadDiscovery({ base: import.meta.env.BASE_URL }));
    let active = true;
    load().then(
      (data) => {
        if (!active) return;
        setState({ status: 'loaded', data });
        // Optional AI enrichment loads AFTER canonical success and is fail-soft:
        // any problem resolves to `null` and never blocks or errors the dashboard.
        loadAnn().then(
          (ann) => {
            if (active) {
              setAnnotations(ann);
              setAnnotationStatus(ann ? 'ready' : 'unavailable');
            }
          },
          () => {
            if (active) {
              setAnnotations(null);
              setAnnotationStatus('unavailable');
            }
          },
        );
        // Optional discovery inbox — same fail-soft pattern as AI enrichment.
        loadDisc().then(
          (disc) => {
            if (active) setDiscovery(disc);
          },
          () => {
            if (active) setDiscovery(null);
          },
        );
      },
      (err: unknown) => {
        if (!active) return;
        const kind = err instanceof DataLoadError ? err.kind : 'unknown';
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', kind, message });
      },
    );
    return () => {
      active = false;
    };
  }, [loader, annotationsLoader, discoveryLoader]);

  // `page` is meaningful only on a populated stars list. When the effective view is
  // discovery, or the stars dataset is empty, RepositoryView is not mounted to
  // reconcile the URL (§6.2), so canonicalize a stale page to 1 here. The `insights`
  // view (§17) PARKS the repo browse state (page included) preserved-but-inactive —
  // even with zero stars — so it is excluded ENTIRELY: a bookmarked
  // `?view=insights&page=5` keeps `page=5` in the URL WHILE Insights is active (it is
  // never canonicalized here). Switching back to Starred is a `view` change, which
  // resets `page → 1` under §6.3 — the parking keeps the value stable only while
  // Insights is the active view. Guarded, so it is a no-op once the URL is canonical.
  useEffect(() => {
    if (state.status !== 'loaded') return;
    if (controls.state.view === 'insights') return; // park: never canonicalize page in Insights
    const available = discovery != null && discovery.candidates.length > 0;
    const hasStarsSurface =
      !(controls.state.view === 'discovery' && available) && state.data.stars.repos.length > 0;
    if (!hasStarsSurface && controls.state.page !== 1) {
      controls.update({ page: 1 }, 'replace');
    }
  }, [state, discovery, controls]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <ErrorState kind={state.kind} message={state.message} />;
  // `view` is fail-soft (§6.4): honor `discovery` only when it is actually
  // available; otherwise fall back to `stars` while the requested value stays in
  // the URL (it re-applies once discovery loads). Unlike `page`, it is not
  // rewritten — an unavailable substrate may become valid later.
  const discoveryAvailable = discovery != null && discovery.candidates.length > 0;
  // `insights` (§17, M4.3a) is always available once stars load — it is a
  // deterministic view of the SAME dataset, so it never falls back. `discovery`
  // stays fail-soft (honored only when available). Neither is rewritten in the URL.
  const effectiveView =
    controls.state.view === 'insights'
      ? 'insights'
      : controls.state.view === 'discovery' && discoveryAvailable
        ? 'discovery'
        : 'stars';
  const starsEmpty = state.data.stars.repos.length === 0;
  // `← Portfolio` return link (WS4-SL-B): opt-in via a build-time variable so the
  // maintainer's portfolio URL NEVER ships into the generated starledger-template
  // (the builder copies apps/** verbatim). The owner's Pages build passes
  // VITE_PORTFOLIO_URL from an Actions repo variable; template-derived repos build
  // without it and render no link. Absent/empty -> nothing renders.
  const portfolioUrl =
    (import.meta.env.VITE_PORTFOLIO_URL as string | undefined)?.trim() || undefined;

  // The view-tabs nav is ALWAYS present once stars load (§6.4/§17.2 — Insights is a
  // deterministic view that never falls back), so there is NO full-screen empty
  // dead-end: an empty stars dataset renders `EmptyState` INSIDE the Starred pane
  // below the tabs (as a bookmarked available-discovery view already does, F2),
  // keeping Insights reachable by clicking. `Loading`/`ErrorState` above are the only
  // full-screen returns.
  return (
    <>
      {/* View tabs are ALWAYS present: `Starred` and `Insights` (§17 — insights is
          a deterministic view of the same dataset, always available), plus
          `Discovery Inbox` only when discovery is available (fail-soft, §6.4). */}
      <nav className="view-tabs" aria-label="Dashboard views">
        <button
          type="button"
          className={`view-tab${effectiveView === 'stars' ? ' view-tab--active' : ''}`}
          onClick={() => controls.update({ view: 'stars' })}
          aria-current={effectiveView === 'stars' ? 'page' : undefined}
        >
          Starred
        </button>
        <button
          type="button"
          className={`view-tab${effectiveView === 'insights' ? ' view-tab--active' : ''}`}
          onClick={() => controls.update({ view: 'insights' })}
          aria-current={effectiveView === 'insights' ? 'page' : undefined}
        >
          Insights
        </button>
        {discovery && discovery.candidates.length > 0 ? (
          <button
            type="button"
            className={`view-tab${effectiveView === 'discovery' ? ' view-tab--active' : ''}`}
            onClick={() => controls.update({ view: 'discovery' })}
            aria-current={effectiveView === 'discovery' ? 'page' : undefined}
          >
            Discovery Inbox
            <span className="view-tab-count">{discovery.candidateCount}</span>
          </button>
        ) : null}
        {portfolioUrl ? (
          <a
            className="portfolio-link"
            href={portfolioUrl}
            rel="noopener noreferrer"
            aria-label="Return to Portfolio"
          >
            ← Portfolio
          </a>
        ) : null}
      </nav>

      {effectiveView === 'insights' ? (
        <InsightsView
          repos={state.data.stars.repos}
          annotations={annotations}
          annotationStatus={annotationStatus}
          skillsClassification={skills.data}
          skillsStatus={skills.status}
          starsSha256={state.data.meta.stars_sha256}
        />
      ) : effectiveView === 'discovery' && discovery ? (
        <DiscoveryInbox discovery={discovery} />
      ) : starsEmpty ? (
        <EmptyState />
      ) : (
        <RepositoryView
          repos={state.data.stars.repos}
          controls={controls}
          datasetGeneratedAt={state.data.meta.dataset_generated_at}
          annotations={annotations}
          annotationStatus={annotationStatus}
          skillsClassification={skills.data}
          skillsStatus={skills.status}
          starsSha256={state.data.meta.stars_sha256}
        />
      )}
    </>
  );
}
