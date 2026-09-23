// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedDiscovery } from '../data/load-discovery';
import { DataLoadError } from '../data/load-stars';
import { createHash, webcrypto } from 'node:crypto';
import { serializeSkillsClassificationMeta } from '@starred/skills-schema/contracts';
import { makeDataset, makeRepo, makeStarsFile } from '../test-utils';
import { App } from './App';

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

const discoverySource = {
  kind: 'manual',
  source_id: 'owner/repo',
  source_url: 'https://github.com/owner/repo',
  observed_at: '2026-01-01T00:00:00.000Z',
};
const discoveryFixture: LoadedDiscovery = {
  candidates: [
    {
      node_id: 'R_disc',
      owner: 'owner',
      name: 'repo',
      full_name: 'owner/repo',
      html_url: 'https://github.com/owner/repo',
      description: 'A discovery candidate',
      homepage_url: null,
      primary_language: 'TypeScript',
      stargazer_count: 100,
      archived: false,
      disabled: false,
      fork: false,
      pushed_at: '2026-01-01T00:00:00.000Z',
      discovered_at: '2026-01-15T00:00:00.000Z',
      first_seen_source: discoverySource,
      sources: [discoverySource],
      status: 'candidate',
    },
  ] as LoadedDiscovery['candidates'],
  generatedAt: '2026-01-15T00:00:00.000Z',
  candidateCount: 1,
  sourceCount: 1,
};

describe('App state machine', () => {
  it('DATA-1: renders verified repositories', async () => {
    render(
      <App
        loader={async () => makeDataset([makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' })])}
      />,
    );
    await waitFor(() => expect(screen.getByText('a/one')).toBeTruthy());
    expect(screen.getByText('1 of 1 repositories')).toBeTruthy();
  });

  it('EMPTY-1: shows an empty state for zero repos (not an error)', async () => {
    render(<App loader={async () => makeDataset([])} />);
    await waitFor(() => expect(screen.getByText('No starred repositories yet.')).toBeTruthy());
  });

  it('DATA-3: an integrity failure renders an error and no repositories', async () => {
    render(
      <App
        loader={async () => {
          throw new DataLoadError('sha mismatch', 'integrity');
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText('Data integrity check failed')).toBeTruthy());
    expect(screen.queryByText('repositories')).toBeNull();
  });

  it('VIEW-1: bookmarked view=discovery falls back to stars when discovery is unavailable, retaining the URL (§6.4)', async () => {
    window.history.replaceState(null, '', '/?view=discovery');
    render(
      <App
        loader={async () => makeDataset([makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' })])}
        discoveryLoader={async () => null}
      />,
    );
    // effective view falls back to stars (the substrate is unavailable)
    await waitFor(() => expect(screen.getByText('a/one')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Dashboard views' })).toBeNull();
    // the requested value is retained in the URL for recovery (not rewritten)
    expect(window.location.search).toBe('?view=discovery');
  });

  it('VIEW-2 (F2): empty stars + available discovery + view=discovery renders the inbox, not a dead-end EmptyState', async () => {
    window.history.replaceState(null, '', '/?view=discovery');
    render(
      <App loader={async () => makeDataset([])} discoveryLoader={async () => discoveryFixture} />,
    );
    // discovery stays reachable even with zero stars (the early return no longer wins)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Discovery Inbox' })).toBeTruthy(),
    );
    expect(screen.queryByText('No starred repositories yet.')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Dashboard views' })).toBeTruthy();
  });

  it('VIEW-3 (F2): empty stars + available discovery keeps the tabs so discovery is reachable from the default stars view', async () => {
    render(
      <App loader={async () => makeDataset([])} discoveryLoader={async () => discoveryFixture} />,
    );
    // default view is stars → empty pane, but tabs remain (not a full-screen dead-end)
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Dashboard views' })).toBeTruthy(),
    );
    expect(screen.getByText('No starred repositories yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Discovery Inbox/ })).toBeTruthy();
  });

  it('PAGE-reconcile (F2b): a stale ?page with an empty stars dataset canonicalizes to page 1 (App-level)', async () => {
    window.history.replaceState(null, '', '/?page=5');
    render(<App loader={async () => makeDataset([])} discoveryLoader={async () => null} />);
    await waitFor(() => expect(screen.getByText('No starred repositories yet.')).toBeTruthy());
    // RepositoryView never mounts, so App canonicalizes the inert page away
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('PAGE-reconcile (F2b): a stale ?page on the discovery view canonicalizes to 1, keeping view', async () => {
    window.history.replaceState(null, '', '/?view=discovery&page=5');
    render(
      <App
        loader={async () => makeDataset([makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' })])}
        discoveryLoader={async () => discoveryFixture}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Discovery Inbox' })).toBeTruthy(),
    );
    await waitFor(() => expect(window.location.search).toBe('?view=discovery'));
  });
});

/**
 * M2.4 (P7 §4.11) SUPERSEDES the M2.3 delta-0 pins: `ready` now PROJECTS into
 * the Starred view (scope + facet + badges), so ready-vs-baseline DOM equality
 * is no longer the contract — while a NOT-ready layer must still render
 * byte-identically to a layer-absent baseline (the base browser is never
 * affected by loading/unavailable/rejecting states).
 */
describe('M2.4 skills-classification projection (P7 §4.11)', () => {
  const skillsReady = async () => ({
    byNodeId: new Map([
      [
        'R_1',
        { primaryCategoryId: 'verification-qa', secondaryCategoryIds: [], summary: 'Fixture.' },
      ],
    ]),
    categories: [
      {
        id: 'verification-qa',
        label: 'Verification & QA',
        kind: 'domain' as const,
        definition: 'Fixture definition.',
        order: 0,
        target_pack: null,
      },
    ],
    scope: { id: 'coding-agent-skills-ecosystem', label: 'x', description: 'y' },
    taxonomyVersion: 'skills-1',
    generatedAt: '2026-08-14T00:00:00Z',
    generatedAgainstStarsSha256: 'c'.repeat(64),
    coverage: { matched: 1, unclassified: 0, unresolved: 0 },
  });

  async function renderWithSkills(
    skillsLoader: NonNullable<Parameters<typeof App>[0]>['skillsClassificationLoader'],
  ): Promise<{ html: string; cardList: string }> {
    const view = render(
      <App
        loader={async () => makeDataset([makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' })])}
        annotationsLoader={async () => null}
        discoveryLoader={async () => null}
        skillsClassificationLoader={skillsLoader}
      />,
    );
    await waitFor(() => expect(screen.getByText('a/one')).toBeTruthy());
    // Let the optional layer settle so the captured DOM is the steady state.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // React's useId counter is process-global, so auto-generated aria ids
    // (:r1f: etc.) differ between renders; normalize them — everything ELSE
    // must be byte-identical for the equality pins.
    const normalize = (s: string) => s.replace(/:r[0-9a-z]+:/g, ':rID:');
    const html = normalize(view.container.innerHTML);
    // The card subtree alone, for pins that must hold while the sidebar
    // legitimately differs (a ready layer projects its facet section).
    const cardList = normalize(view.container.querySelector('.card-list')?.outerHTML ?? '');
    view.unmount();
    return { html, cardList };
  }

  it('SKILLS-1: the loader IS invoked (wiring pin) and a rejection never affects the base browser', async () => {
    let invoked = 0;
    const rejecting = () => {
      invoked += 1;
      return Promise.reject(new Error('classification exploded'));
    };
    await renderWithSkills(rejecting);
    // Deleting App's useSkillsClassification call makes this fail.
    expect(invoked).toBeGreaterThan(0);
  });

  it('SKILLS-3 (matrix row 10): a READY layer whose map lacks the base repo renders that repo CARD byte-identically to a layer-absent render — no badge, no synthetic classification treatment', async () => {
    const readyWithoutThisRepo = async () => ({
      ...(await skillsReady()),
      byNodeId: new Map([
        [
          'R_other',
          { primaryCategoryId: 'verification-qa', secondaryCategoryIds: [], summary: 'Other.' },
        ],
      ]),
    });
    const baseline = await renderWithSkills(async () => null);
    const unclassified = await renderWithSkills(readyWithoutThisRepo);
    // "Absence is not a classification" pinned at DOM level again (max-review
    // round-2 finding 1 restored the superseded M2.3 oracle's discriminating
    // power at CARD scope): ANY readiness-keyed synthetic treatment of an
    // unclassified repo — an "Unclassified" pill, an empty enrichment block —
    // breaks this equality, whatever class name it uses.
    expect(unclassified.cardList).toBe(baseline.cardList);
    expect(unclassified.cardList).toContain('a/one');
    // Scoped to the card subtree deliberately: the ready layer legitimately
    // projects its facet section into the sidebar.
    expect(unclassified.html).toContain('Skills ecosystem');
  });

  it('SKILLS-2 (M2.4): NOT-ready layers render byte-identical base DOM to a layer-absent baseline; a READY layer projects (badge + facet section)', async () => {
    const baseline = await renderWithSkills(async () => null);
    // The pending promise must SETTLE after the capture, or it dangles on the
    // event loop and stalls the worker's teardown.
    let releasePending: (value: null) => void = () => {};
    const pending = await renderWithSkills(
      () =>
        new Promise<Awaited<ReturnType<typeof skillsReady>> | null>((resolve) => {
          releasePending = resolve;
        }),
    );
    releasePending(null);
    const rejecting = await renderWithSkills(() => Promise.reject(new Error('boom')));
    expect(pending.html).toBe(baseline.html);
    expect(rejecting.html).toBe(baseline.html);
    expect(baseline.html).toContain('a/one');
    // A not-ready layer leaves no trace of the projection in the base DOM.
    expect(baseline.html).not.toContain('badge-skill');
    expect(baseline.html).not.toContain('Skills ecosystem');
    // Ready now DIFFERS by design (§4.11 supersession): the classified repo's
    // card carries its taxonomy-labeled badge and the facet section exists.
    const ready = await renderWithSkills(skillsReady);
    expect(ready.html).not.toBe(baseline.html);
    expect(ready.html).toContain('badge-skill');
    expect(ready.html).toContain('Verification &amp; QA');
    expect(ready.html).toContain('Skills ecosystem');
  });
});

/**
 * PRODUCTION DEFAULT PATH (Charter E; round-9 finding, luna@ultra). Every other
 * App test injects `loader`, and the direct loader tests inject `fetchImpl`, so
 * the wiring `loadStars({ base: import.meta.env.BASE_URL })` — the only path
 * production ever takes for the CANONICAL dataset — was exercised by nothing: a
 * broken default (wrong base, dropped result, a digest input the runtime
 * rejects) would have passed the entire suite. Same contract as the skills
 * DEFAULT-PATH pin: the real loader's RESULT must reach the rendered state.
 */
describe('App production default path', () => {
  it('DEFAULT-PATH: with no loaders injected, the real canonical loader result renders', async () => {
    // Round-10 finding (sol + luna@ultra, convergent): under vitest the real
    // BASE_URL is '/', so asserting '/'-prefixed URLs cannot discriminate a
    // default that DROPPED BASE_URL and hardcoded '/' — the faithful Pages
    // regression, where production serves from '/<repo>/'. Stub a non-root
    // base: only a default that genuinely reads import.meta.env.BASE_URL
    // requests these exact URLs.
    const BASE = '/r10-pages-base/';
    vi.stubEnv('BASE_URL', BASE);
    const starsText = JSON.stringify(
      makeStarsFile([makeRepo({ node_id: 'R_dp1', name_with_owner: 'default/path-one' })]),
    );
    const digest = createHash('sha256').update(starsText, 'utf8').digest('hex');
    const metaText = JSON.stringify({
      schema_version: '1.0',
      dataset_generated_at: '2026-01-01T00:00:00Z',
      stars_sha256: digest,
      repo_count: 1,
    });

    // jsdom's `crypto` has no `subtle`, so the real loader's digest step would
    // fail-soft and this test would assert nothing about the default path.
    const originalCrypto = globalThis.crypto;
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    }
    // Round-12 finding (sol + luna@max): serving 404 for the optional layers
    // meant each loader fetched only its META and never its ARTIFACT, so a
    // default that dropped BASE_URL on the artifact fetch (`${base}...` → `/...`)
    // passed. Serve schema-valid optional METAs so each loader PROCEEDS to
    // request its artifact (with `?sha=`); the artifact fetch may 404 and fail
    // soft, but the request is recorded and its base is asserted.
    const AI_SHA = 'a'.repeat(64);
    const DISC_SHA = 'c'.repeat(64);
    const SKILLS_SHA = 'e'.repeat(64);
    const aiMeta = JSON.stringify({
      schema_version: '1.0',
      annotations_sha256: AI_SHA,
      annotation_count: 0,
      taxonomy_version: '1',
      dataset_sha256: 'b'.repeat(64),
      generated_at: '2026-06-20T00:00:00Z',
    });
    const discMeta = JSON.stringify({
      schema_version: 1,
      generated_at: '2026-01-15T00:00:00.000Z',
      dataset_sha: DISC_SHA,
      candidate_count: 1,
      source_count: 1,
      generator_version: '0.1.0',
    });
    const skillsMeta = serializeSkillsClassificationMeta({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: SKILLS_SHA,
      source_sha256: 'b'.repeat(64),
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256: 'c'.repeat(64),
      generated_at: '2026-08-14T00:00:00Z',
      category_count: 1,
      source_entry_count: 1,
      resolved_entry_count: 1,
      present_repo_count: 1,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 699,
    });
    const requested: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes('dataset-meta.json')) return new Response(metaText, { status: 200 });
      if (url.includes('stars.json')) return new Response(starsText, { status: 200 });
      if (url.includes('ai-annotations-meta.json')) return new Response(aiMeta, { status: 200 });
      if (url.includes('discovery-candidates-meta.json'))
        return new Response(discMeta, { status: 200 });
      if (url.includes('skills-classification-meta.json'))
        return new Response(skillsMeta, { status: 200 });
      // Optional ARTIFACT bodies 404: the layers fail soft (the digest never
      // matches), the UI is unchanged — but the loader already REQUESTED the
      // artifact URL, which is what this pin asserts.
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByText('default/path-one')).toBeTruthy());
      expect(screen.getByText('1 of 1 repositories')).toBeTruthy();
      // The optional artifact requests fire AFTER the canonical render settles.
      await waitFor(() =>
        expect(requested.some((url) => url.includes('skills-classification.json?sha='))).toBe(true),
      );
    } finally {
      globalThis.fetch = original;
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
      vi.unstubAllEnvs();
    }
    // Exact equality against the STUBBED base — never substrings, and never
    // '/' (round-9 lesson, hardened in round 10).
    expect(requested).toContain(`${BASE}dataset-meta.json`);
    expect(requested).toContain(`${BASE}stars.json?sha=${digest}`);
    // Every optional layer's META **and ARTIFACT** default must carry the base
    // — a wrong base on the artifact fetch silently kills the layer in
    // production while the layer's own meta request looks correct (round-12).
    expect(requested).toContain(`${BASE}ai-annotations-meta.json`);
    expect(requested).toContain(`${BASE}ai-annotations.json?sha=${AI_SHA}`);
    expect(requested).toContain(`${BASE}discovery-candidates-meta.json`);
    expect(requested).toContain(`${BASE}discovery-candidates.json?sha=${DISC_SHA}`);
    expect(requested).toContain(`${BASE}skills-classification-meta.json`);
    expect(requested).toContain(`${BASE}skills-classification.json?sha=${SKILLS_SHA}`);
  });
});
