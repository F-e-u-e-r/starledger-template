// @vitest-environment jsdom
/**
 * F4 — AI readiness-coherence parity (P7 §4.11, M4.2).
 *
 * The AI layer is EFFECTIVE-READY only under a COHERENT shape: status `ready`
 * AND data present — symmetric with the skills layer (M24-STS-1 / M24-STS-4).
 * These pins close the whole coherent-readiness family the F4 fix addressed, so
 * a later change cannot silently reopen either fail-open mirror:
 *   • coherent ready (ready + data)     → the requested AI filter activates
 *   • ready + NO data (F4-P1)           → NOT ready: filter neutralized, results
 *                                         never zeroed, degraded notice, URL kept
 *   • omitted status + data (F4-P2)     → NOT ready: data presence alone never
 *                                         activates (the former M0 fallback, closed)
 *   • real App wiring (F4-P3)           → App sets (status, data) atomically, so
 *                                         coherent-ready and M0 fail-soft stay intact
 *
 * The first three deliberately construct the incoherent shapes App NEVER produces
 * (ready+null, omitted+data) to prove the gate directly; the last proves that the
 * only producer keeps the pair coherent. Scope is the readiness GATE only — the
 * badge/enriched-count/data-join path is not an AI-readiness concern (it stays
 * driven by data presence) and is covered by ai-enrichment; the `dashboardToView`
 * fail-closed default is pinned by M42-F4-DEFAULT in select.test.ts.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app/App';
import { useDashboardState } from '../state/use-dashboard-state';
import { makeAnnotation, makeAnnotations, makeDataset, makeRepo } from '../test-utils';
import { RepositoryView } from './repositories/RepositoryView';

const NOW = new Date('2026-06-19T00:00:00Z');
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

function Harness(props: Omit<ComponentProps<typeof RepositoryView>, 'controls'>) {
  const controls = useDashboardState();
  return <RepositoryView {...props} controls={controls} />;
}

const repos = () => [
  makeRepo({ node_id: 'R_ts', name_with_owner: 'acme/ts-tool', primary_language: 'TypeScript' }),
  makeRepo({ node_id: 'R_go', name_with_owner: 'acme/go-tool', primary_language: 'Go' }),
];
const securityAnnotations = () =>
  makeAnnotations({ R_ts: makeAnnotation({ category: 'security' }) });
const AI_UNAVAILABLE = /AI classification is unavailable/;

describe('F4 — AI readiness-coherence (component contract, P7 §4.11)', () => {
  it('M42-F4-COHERENT: status `ready` AND data ⇒ the requested AI filter activates and is counted', () => {
    window.history.replaceState(null, '', '/?category=security');
    render(
      <Harness
        repos={repos()}
        initialNow={NOW}
        annotations={securityAnnotations()}
        annotationStatus="ready"
      />,
    );
    expect(screen.getByText('1 of 2 · filtered')).toBeTruthy(); // narrowed to the annotated repo
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy(); // counted as effective
    expect(screen.queryByText(AI_UNAVAILABLE)).toBeNull(); // no degraded surface when coherent
  });

  it('M42-F4-READY-NO-DATA (F4-P1): status `ready` but NO data ⇒ NOT effective-ready — the filter is neutralized (results NEVER zeroed), the requested value is retained in the URL, and the degraded notice is shown', () => {
    window.history.replaceState(null, '', '/?category=security');
    render(
      <Harness repos={repos()} initialNow={NOW} annotations={null} annotationStatus="ready" />,
    );
    // The fail-open mirror is closed: the optional layer can no longer zero base repos.
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
    expect(screen.queryByText('0 of 2 · filtered')).toBeNull();
    // The requested AI filter is not counted as effective, and is surfaced as degraded.
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Filters \d/ })).toBeNull();
    expect(screen.getByText(AI_UNAVAILABLE)).toBeTruthy();
    // Only EFFECTIVE filtering is neutralized: the requested value stays in the link.
    expect(window.location.search).toBe('?category=security');
  });

  it('M42-F4-DATA-ONLY (F4-P2): data present but status OMITTED ⇒ NOT ready — data presence alone never activates the layer (the former M0 fallback is closed)', () => {
    window.history.replaceState(null, '', '/?category=security');
    render(<Harness repos={repos()} initialNow={NOW} annotations={securityAnnotations()} />);
    // The category filter is neutralized: the base set is preserved, not narrowed to 1.
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
    expect(screen.queryByText('1 of 2 · filtered')).toBeNull();
    expect(screen.queryByRole('button', { name: /Filters \d/ })).toBeNull();
    // Requested value retained (this incoherent shape is App-unreachable; the notice
    // reads "unavailable" because the status is not `loading`).
    expect(screen.getByText(AI_UNAVAILABLE)).toBeTruthy();
    expect(window.location.search).toBe('?category=security');
  });
});

describe('F4 — real App wiring / M0 fail-soft preservation (F4-P3, P7 §2.2)', () => {
  it('M42-F4-APP-NULL: annotations resolve to null ⇒ App sets (unavailable, null) — the base browser stays intact with the degraded notice, results are never zeroed', async () => {
    window.history.replaceState(null, '', '/?category=security');
    render(
      <App
        loader={async () => makeDataset(repos())}
        annotationsLoader={async () => null}
        discoveryLoader={async () => null}
        skillsClassificationLoader={async () => null}
      />,
    );
    await waitFor(() => expect(screen.getByText(AI_UNAVAILABLE)).toBeTruthy());
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
    expect(screen.queryByText('0 of 2 · filtered')).toBeNull();
  });

  it('M42-F4-APP-DATA: annotations resolve with data ⇒ App sets (ready, data) — the requested filter activates and the degraded notice clears', async () => {
    window.history.replaceState(null, '', '/?category=security');
    render(
      <App
        loader={async () => makeDataset(repos())}
        annotationsLoader={async () => securityAnnotations()}
        discoveryLoader={async () => null}
        skillsClassificationLoader={async () => null}
      />,
    );
    await waitFor(() => expect(screen.getByText('1 of 2 · filtered')).toBeTruthy());
    expect(screen.queryByText(AI_UNAVAILABLE)).toBeNull();
  });
});
