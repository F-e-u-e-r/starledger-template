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

  // `page` is meaningful only on a populated stars list. When the effective view
  // is discovery, or the stars dataset is empty, RepositoryView is not mounted to
  // reconcile the URL (§6.2), so canonicalize a stale page to 1 here. Guarded, so
  // it is a no-op once the URL is already canonical.
  useEffect(() => {
    if (state.status !== 'loaded') return;
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
  const effectiveView =
    controls.state.view === 'discovery' && discoveryAvailable ? 'discovery' : 'stars';
  const starsEmpty = state.data.stars.repos.length === 0;

  // Full-screen empty state ONLY when there is genuinely nothing to show. When
  // discovery is available it stays reachable via the tabs even with zero stars
  // (the empty state then renders inside the stars pane), so a bookmarked
  // `?view=discovery` never dead-ends on EmptyState. The early return therefore
  // runs AFTER view resolution, not before (§6.4).
  if (starsEmpty && !discoveryAvailable) return <EmptyState />;

  return (
    <>
      {discovery && discovery.candidates.length > 0 ? (
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
            className={`view-tab${effectiveView === 'discovery' ? ' view-tab--active' : ''}`}
            onClick={() => controls.update({ view: 'discovery' })}
            aria-current={effectiveView === 'discovery' ? 'page' : undefined}
          >
            Discovery Inbox
            <span className="view-tab-count">{discovery.candidateCount}</span>
          </button>
        </nav>
      ) : null}

      {effectiveView === 'discovery' && discovery ? (
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
