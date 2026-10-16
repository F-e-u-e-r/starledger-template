// @vitest-environment jsdom
/**
 * M2.5 integrated closure suite (P7 §4.13). Proves that M2.1–M2.4, as ONE
 * layer, actually closes — the cross-feature compositions and the fail-soft
 * conjunction, NOT a re-run of the per-slice unit pins (those live in
 * `skills-projection.test.tsx`, `use-skills-classification.test.tsx`,
 * `load-skills-classification.test.ts`, `integrity-bytes.test.ts`, … and are
 * CITED here rather than duplicated). Production delta = 0: this file only
 * observes the shipped M2.1–M2.4 behavior at integration scope.
 *
 * Oracle discipline (pre-commit R1, 2026-09-24 — grok-4.7 + sol@max + luna@max
 * converged that several first-cut oracles could not fail): every load-bearing
 * pin here is built so a broken implementation reddens it — the discriminating
 * fixtures (M25-J's filter∩search, M25-RECON's ≥2-page reconciliation, E2E-2's
 * matching-digest control) exist precisely so the claim can be falsified.
 */
import { createHash, webcrypto } from 'node:crypto';
import {
  serializeSkillsClassification,
  serializeSkillsClassificationMeta,
} from '@starred/skills-schema/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoadedSkillsClassification } from '../data/load-skills-classification';
import { loadSkillsClassification } from '../data/load-skills-classification';
import { useSkillsClassification } from '../data/use-skills-classification';
import { useDashboardState } from '../state/use-dashboard-state';
import { makeRepo, makeSkillsClassification, makeSkillsRecord } from '../test-utils';
import { RepositoryView } from './repositories/RepositoryView';

const NOW = new Date('2026-06-19T00:00:00Z');
/** Equals the fixture default `generatedAgainstStarsSha256` ⇒ no §2.1 note. */
const LIVE_STARS_SHA = '0'.repeat(64);

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

/** RepositoryView with the App-owned canonical-state controls (the §6.4 owner). */
function Harness(props: Omit<ComponentProps<typeof RepositoryView>, 'controls'>) {
  const controls = useDashboardState();
  return <RepositoryView {...props} controls={controls} />;
}

function renderView(
  repos = skillsRepos(),
  extra: Partial<Omit<ComponentProps<typeof RepositoryView>, 'controls' | 'repos'>> = {},
) {
  return render(
    <Harness repos={repos} datasetGeneratedAt="2026-06-18T00:00:00Z" initialNow={NOW} {...extra} />,
  );
}

/** One primary-classified, one primary+secondary-classified, one unclassified. */
function skillsRepos() {
  return [
    makeRepo({
      node_id: 'R_cls',
      name_with_owner: 'acme/classified',
      url: 'https://github.com/acme/classified',
      description: 'A test harness',
      primary_language: 'TypeScript',
      stargazer_count: 10,
    }),
    makeRepo({
      node_id: 'R_sec',
      name_with_owner: 'acme/secondary',
      url: 'https://github.com/acme/secondary',
      primary_language: 'Go',
      stargazer_count: 20,
    }),
    makeRepo({
      node_id: 'R_plain',
      name_with_owner: 'acme/plain',
      url: 'https://github.com/acme/plain',
      primary_language: 'Go',
      stargazer_count: 5,
    }),
  ];
}

/** Distinct per-repo summaries so search enrichment can be shown to NARROW. */
const classification = () =>
  makeSkillsClassification({
    R_cls: makeSkillsRecord({ primaryCategoryId: 'verification-qa', summary: 'alpha-marker' }),
    R_sec: makeSkillsRecord({
      primaryCategoryId: 'design-ui',
      secondaryCategoryIds: ['verification-qa'],
      summary: 'omega-marker',
    }),
  });

const readyProps = (overrides: Partial<ComponentProps<typeof RepositoryView>> = {}) => ({
  skillsClassification: classification(),
  skillsStatus: 'ready' as const,
  starsSha256: LIVE_STARS_SHA,
  ...overrides,
});

/** Result-list card titles (scoped to `.card-list`, so sidebar links never leak). */
const titles = () => {
  const list = document.querySelector('.card-list');
  return list
    ? within(list as HTMLElement)
        .getAllByRole('link')
        .map((a) => a.textContent)
    : [];
};

const cardOf = (name: string) =>
  screen.getByRole('link', { name }).closest('li.card') as HTMLElement;

const sidebar = () => screen.getByRole('complementary', { name: 'Filters' });

const search = () => screen.getByRole('searchbox', { name: 'Search repositories' });

// ---------------------------------------------------------------------------
describe('M2.5 integrated acceptance (§4.13 — cross-feature, not per-slice re-runs)', () => {
  it('M25-A: the layer joins by node_id — a classified repo carries its OWN taxonomy badges + curated summary, an unclassified repo carries NO skill chrome at all, and a classification whose node_id has no live repo is a non-event that never enters the render OR the search corpus (§4.5 orphan row)', () => {
    // A ghost record (no live repo carries R_ghost): a join miss must not throw,
    // must not surface, and must not knock the layer off `ready`.
    const withGhost = makeSkillsClassification({
      R_cls: makeSkillsRecord({ primaryCategoryId: 'verification-qa', summary: 'alpha-marker' }),
      R_sec: makeSkillsRecord({
        primaryCategoryId: 'design-ui',
        secondaryCategoryIds: ['verification-qa'],
        summary: 'omega-marker',
      }),
      R_ghost: makeSkillsRecord({ primaryCategoryId: 'verification-qa', summary: 'ghost-marker' }),
    });
    renderView(skillsRepos(), readyProps({ skillsClassification: withGhost }));

    // classified → its OWN categories' badges + its OWN summary (no cross-repo bleed)
    expect(within(cardOf('acme/classified')).getByText('Verification & QA')).toBeTruthy();
    expect(within(cardOf('acme/classified')).getByText('alpha-marker')).toBeTruthy();
    expect(within(cardOf('acme/classified')).queryByText('Design & UI')).toBeNull();
    expect(within(cardOf('acme/secondary')).getByText('Design & UI')).toBeTruthy();
    expect(within(cardOf('acme/secondary')).getByText('Verification & QA')).toBeTruthy();
    expect(within(cardOf('acme/secondary')).getByText('omega-marker')).toBeTruthy();

    // unclassified → NO skill chrome at all: not merely a missing "Verification &
    // QA" text but zero `.badge-skill` and no summary line. (The stronger
    // whole-card byte-equality against a layer-absent render is SKILLS-3 in
    // App.test.tsx / skills-projection.test.tsx; this integration pin asserts the
    // structural absence the composed render must uphold.)
    const plain = cardOf('acme/plain');
    expect(plain.querySelectorAll('.badge-skill').length).toBe(0);
    expect(plain.querySelector('.card-skill-summary')).toBeNull();

    // the ghost record surfaces nowhere in the render …
    expect(screen.queryByText('ghost-marker')).toBeNull();
    // … and never leaks into the SEARCH corpus: a ghost-only term matches nothing
    // (an orphan classification could contaminate `searchText` without rendering).
    fireEvent.change(search(), { target: { value: 'ghost-marker' } });
    expect(titles()).toEqual([]);
    fireEvent.change(search(), { target: { value: '' } });

    // layer is still coherent-ready: the facet section is present …
    expect(within(sidebar()).getByText('Skills ecosystem')).toBeTruthy();
    // … and the READY positive control for the structural download oracle: the
    // `.md` link EXISTS here (the fail-soft tests assert this SAME selector is
    // absent — together they pin "download chrome appears/disappears WITH
    // readiness"; deploy hash-correspondence is DEPLOY-MD + browser smoke).
    expect(document.querySelector('a[href$="skills-classified.md"]')).not.toBeNull();
  });

  it('M25-B: a requested scope/skill bookmarked while the layer is NOT ready re-applies itself once the layer settles to ready — the retained URL value activates, nothing was lost', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    // First render: data present but status loading ⇒ NOT ready (coherent gate).
    const { rerender } = renderView(skillsRepos(), {
      skillsClassification: classification(),
      skillsStatus: 'loading',
    });
    // requested state retained, not applied — base preserved, none filtered
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(window.location.search).toBe('?scope=skills&skill=verification-qa');

    // The layer settles to ready with the SAME controls/URL still in place.
    rerender(
      <Harness
        repos={skillsRepos()}
        datasetGeneratedAt="2026-06-18T00:00:00Z"
        initialNow={NOW}
        {...readyProps()}
      />,
    );
    // the retained scope+skill now apply: narrowed to the verification-qa repos
    expect(titles().sort()).toEqual(['acme/classified', 'acme/secondary']);
    expect(window.location.search).toBe('?scope=skills&skill=verification-qa');
  });

  it('M25-J (flagship): ONE transition proves the skill facet AND classification-enriched search compose as an INTERSECTION (each is load-bearing), with the winner’s badges + curated summary and density surviving the keystroke (§4.13 C/D/E/F)', () => {
    // Discriminating fixture: scope=skills ∩ skill=verification-qa ∩ q=jkeep
    //   scope=skills → {j-cls, j-sec, j-x};  skill=verification-qa → {j-cls, j-sec};
    //   q=jkeep (summary enrichment) → {j-cls, j-x}.  Intersection = {j-cls}.
    // Dropping the skill filter ⇒ {j-cls, j-x} (RED: j-x re-enters); dropping the
    // enriched search ⇒ {j-cls, j-sec} (RED: j-sec re-enters). So the single
    // asserted result set falsifies a collapse of EITHER dimension.
    const jRepos = [
      makeRepo({ node_id: 'R_j_cls', name_with_owner: 'acme/j-cls', stargazer_count: 3 }),
      makeRepo({ node_id: 'R_j_sec', name_with_owner: 'acme/j-sec', stargazer_count: 2 }),
      makeRepo({ node_id: 'R_j_x', name_with_owner: 'acme/j-x', stargazer_count: 1 }),
      makeRepo({ node_id: 'R_j_plain', name_with_owner: 'acme/j-plain', stargazer_count: 0 }),
    ];
    const jClassification = makeSkillsClassification({
      R_j_cls: makeSkillsRecord({ primaryCategoryId: 'verification-qa', summary: 'jkeep marker' }),
      R_j_sec: makeSkillsRecord({ primaryCategoryId: 'verification-qa', summary: 'jdrop marker' }),
      R_j_x: makeSkillsRecord({ primaryCategoryId: 'design-ui', summary: 'jkeep marker' }),
    });
    window.history.replaceState(
      null,
      '',
      '/?scope=skills&skill=verification-qa&density=comfortable',
    );
    renderView(jRepos, readyProps({ skillsClassification: jClassification }));

    // sanity: before the keystroke the skill filter alone gives {j-cls, j-sec}
    expect(titles().sort()).toEqual(['acme/j-cls', 'acme/j-sec']);

    // the enriched search keys on the summary corpus (jkeep is not in any name)
    fireEvent.change(search(), { target: { value: 'jkeep' } });

    // INTERSECTION result — only j-cls satisfies scope ∩ skill ∩ search
    expect(titles()).toEqual(['acme/j-cls']);
    // the winner's badge (E) and curated summary (F)
    expect(within(cardOf('acme/j-cls')).getByText('Verification & QA')).toBeTruthy();
    expect(within(cardOf('acme/j-cls')).getByText('jkeep marker')).toBeTruthy();
    // canonical URL (§4.11 emit order: scope, skill, q, …, density)
    expect(window.location.search).toBe(
      '?scope=skills&skill=verification-qa&q=jkeep&density=comfortable',
    );
    // density survives the transition (I) — value AND applied class
    expect((screen.getByRole('combobox', { name: 'Density' }) as HTMLSelectElement).value).toBe(
      'comfortable',
    );
    expect(document.querySelector('.dashboard')?.classList.contains('density-comfortable')).toBe(
      true,
    );
  });

  it('M25-RECON (§6.2 composed): a bookmarked out-of-range `page` reconciles to the effective last page and the canonical URL is REWRITTEN to it via `replace` (no history entry added) — a filtered ≥2-page result set makes both the clamp and the replace-vs-push distinction observable', () => {
    // The clamp must key on the FILTERED result count, not the raw repo count.
    // 49 classified + 48 unclassified = 97 repos ⇒ scope=skills yields 49 results
    // ⇒ effective lastPage = 2 (48/pg); repos.length would give lastPage 3. So a
    // `results.length → repos.length` regression at the clamp reddens this pin (it
    // would render "Page 3 of 3" and rewrite to page=3). This is the ONLY pin for
    // "reconciliation keys on the active filter" — the unit PAGE-3 is unfiltered.
    const nClassified = 49;
    const nUnclassified = 48; // excluded by scope=skills ⇒ results stays 49, repos = 97
    const manyRepos = [
      ...Array.from({ length: nClassified }, (_, i) =>
        makeRepo({
          node_id: `R_m${i}`,
          name_with_owner: `acme/m-${String(i).padStart(2, '0')}`,
          url: `https://github.com/acme/m-${i}`,
        }),
      ),
      ...Array.from({ length: nUnclassified }, (_, i) =>
        makeRepo({
          node_id: `R_p${i}`,
          name_with_owner: `acme/p-${String(i).padStart(2, '0')}`,
          url: `https://github.com/acme/p-${i}`,
        }),
      ),
    ];
    const manyClassification = makeSkillsClassification(
      Object.fromEntries(
        Array.from({ length: nClassified }, (_, i) => [
          `R_m${i}`,
          makeSkillsRecord({ primaryCategoryId: 'verification-qa', summary: `m${i}` }),
        ]),
      ),
    );
    window.history.replaceState(null, '', '/?scope=skills&page=999');
    const historyLenBefore = window.history.length;
    renderView(manyRepos, readyProps({ skillsClassification: manyClassification }));

    // effective page clamps to the last page (2 of 2) and is what renders
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    // the canonical URL is REWRITTEN from the stale 999 to the effective 2 …
    expect(window.location.search).toBe('?scope=skills&page=2');
    // … via `replace` — no new history entry (a `push` would grow the stack)
    expect(window.history.length).toBe(historyLenBefore);
  });

  it('M25-I: clear-all clears the scope + skill query axis while PRESERVING the display-preference density (§4.11 clear-all contract, composed at integration scope; per-field codec round-trip + page-reset stay the URL-1 / RST-1 unit pins)', () => {
    window.history.replaceState(
      null,
      '',
      '/?scope=skills&skill=verification-qa&density=comfortable',
    );
    renderView(skillsRepos(), readyProps());
    // active skill filters ⇒ a Clear all control is present
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    // query-axis (scope + skill) cleared; density (a display preference) preserved.
    // Two-sided: an over-clear that drops density ⇒ '' reds; an under-clear that
    // keeps scope ⇒ '?scope=…' reds.
    expect(window.location.search).toBe('?density=comfortable');
  });

  it('M25-G: coverage.matched=0 keeps the layer READY — the section renders with the explicit zero-coverage sentence and no degraded notice, and the NON-EMPTY join map still drives BOTH scope filtering and taxonomy-LABEL search enrichment (F2 re-entry pin: filtering keys on the map, never on the statistic)', () => {
    const zeroCoverage = makeSkillsClassification(
      {
        R_cls: makeSkillsRecord({ primaryCategoryId: 'verification-qa', summary: 'alpha-marker' }),
        R_sec: makeSkillsRecord({
          primaryCategoryId: 'design-ui',
          secondaryCategoryIds: ['verification-qa'],
          summary: 'omega-marker',
        }),
      },
      { coverage: { matched: 0, unclassified: 3, unresolved: 2 } },
    );
    window.history.replaceState(null, '', '/?scope=skills');
    renderView(skillsRepos(), readyProps({ skillsClassification: zeroCoverage }));

    // READY preserved: section + coverage line + explicit zero sentence, no notice
    expect(within(sidebar()).getByText('Skills ecosystem')).toBeTruthy();
    expect(
      within(sidebar()).getByText(
        'Coverage at generation: 0 matched · 3 unclassified · 2 unresolved source entries',
      ),
    ).toBeTruthy();
    expect(
      within(sidebar()).getByText(/matched none of the starred repositories at generation time/),
    ).toBeTruthy();
    expect(screen.queryByText(/Skills classification is unavailable/)).toBeNull();

    // matched=0 must NOT gate filtering: scope still narrows via the join map …
    expect(titles().sort()).toEqual(['acme/classified', 'acme/secondary']);
    // … and a TAXONOMY-LABEL search (distinct from the summary path) still narrows:
    // "Design & UI" is R_sec's primary label, present in the corpus only via the
    // label map — so this reddens a regression that stops labels reaching the corpus.
    fireEvent.change(search(), { target: { value: 'design & ui' } });
    expect(titles()).toEqual(['acme/secondary']);
    // (base sort/pagination while READY are M24-* unit concerns; the F2-critical
    // claim here is READY-preserved + map-driven filter/label-search at matched=0.)
  });
});

// ---------------------------------------------------------------------------
describe('M2.5 fail-soft closure (§4.13 — the projection conjunction + real-chain E2E)', () => {
  /** The full fail-soft conjunction for a not-ready layer with a bookmarked
   *  `?scope=skills&skill=verification-qa`. */
  function expectFailSoftConjunction() {
    // base Starred repos fully preserved — never zeroed, never narrowed
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(screen.getByText('3 of 3 repositories')).toBeTruthy(); // no "· filtered"
    // every classification-dependent surface is neutralized
    expect(screen.queryByText('Skills ecosystem')).toBeNull(); // facet section hidden
    expect(screen.queryByText(/Coverage at generation/)).toBeNull(); // coverage gone
    expect(document.querySelector('.card-skill-summary')).toBeNull(); // summaries gone
    expect(document.querySelector('.badge-skill')).toBeNull(); // badges gone
    // download link gone — the SAME structural href oracle the READY positive
    // control (M25-A) asserts PRESENT (so it cannot false-pass by failing to match
    // an accessible name — the browser smoke found the name is "Download the
    // classification source (.md)", not its href).
    expect(document.querySelector('a[href$="skills-classified.md"]')).toBeNull();
    // requested recoverable state retained — the CHIPS (removable, for recovery),
    // by id slug while degraded, AND the URL
    expect(screen.getByRole('button', { name: /Scope: Skills ecosystem/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Skill: verification-qa/ })).toBeTruthy();
    expect(window.location.search).toBe('?scope=skills&skill=verification-qa');
  }

  it('M25-FS-proj (unavailable): layer unavailable + bookmarked scope/skill ⇒ base browser fully usable, everything classification-dependent inert, degraded notice, chips + URL retained — AND base SEARCH, SORT and DENSITY still function while an enrichment-only query honestly yields 0 (never "show all"); base PAGINATION-while-unavailable is M24-FS-5b', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(); // no skills props ⇒ unavailable
    expectFailSoftConjunction();
    expect(screen.getByText(/Skills classification is unavailable/)).toBeTruthy();

    // base SEARCH still narrows on a base field
    fireEvent.change(search(), { target: { value: 'classified' } });
    expect(titles()).toEqual(['acme/classified']);
    // an ENRICHMENT-ONLY term honestly yields 0 — corpus is base-only (§7)
    fireEvent.change(search(), { target: { value: 'omega-marker' } });
    expect(titles()).toEqual([]);
    expect(screen.getByText('0 results for "omega-marker"')).toBeTruthy();
    fireEvent.change(search(), { target: { value: '' } });

    // base SORT still functions: by stars desc, acme/secondary (20) leads
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'stargazer_count' },
    });
    expect(titles()[0]).toBe('acme/secondary');

    // density still operates (value AND applied class)
    fireEvent.change(screen.getByRole('combobox', { name: 'Density' }), {
      target: { value: 'comfortable' },
    });
    expect((screen.getByRole('combobox', { name: 'Density' }) as HTMLSelectElement).value).toBe(
      'comfortable',
    );
    expect(document.querySelector('.dashboard')?.classList.contains('density-comfortable')).toBe(
      true,
    );
  });

  it('M25-FS-proj (loading): the SAME conjunction holds while loading, with loading-specific wording (never "unavailable"), even though the data is already present (coherent-ready gate — status, not data, decides), and base search still functions', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), { skillsClassification: classification(), skillsStatus: 'loading' });
    expectFailSoftConjunction();
    expect(screen.getByText(/Skills classification is still loading/)).toBeTruthy();
    expect(screen.queryByText(/Skills classification is unavailable/)).toBeNull();
    // base UI functions while loading too (a base-field search narrows)
    fireEvent.change(search(), { target: { value: 'classified' } });
    expect(titles()).toEqual(['acme/classified']);
  });

  it('M25-FS-7: the coherent-ready gate rejects ALL THREE incoherent states at projection scope — status=ready+data=null does NOT become a match-nothing filter, and neither status=loading+data NOR status=unavailable+data activates any projection', () => {
    // ready + no data: must NOT zero the results as a match-nothing filter
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), { skillsClassification: null, skillsStatus: 'ready' });
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(screen.getByText('3 of 3 repositories')).toBeTruthy();
    expect(screen.queryByText('Skills ecosystem')).toBeNull();

    // data present + loading: must NOT activate on data alone
    cleanup();
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), { skillsClassification: classification(), skillsStatus: 'loading' });
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(document.querySelector('.badge-skill')).toBeNull();

    // data present + unavailable: same boolean, but pinned here so a
    // `status !== 'loading' && data` gate (which would leak on unavailable) reds
    cleanup();
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), {
      skillsClassification: classification(),
      skillsStatus: 'unavailable',
    });
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(document.querySelector('.badge-skill')).toBeNull();
  });

  // -- Real loader → real projection E2E chains (composition boundary) --------

  /** RepositoryView driven by the REAL hook + REAL loader (App's own wiring). */
  function E2EHarness({ loader }: { loader: () => Promise<LoadedSkillsClassification | null> }) {
    const controls = useDashboardState();
    const skills = useSkillsClassification(loader);
    return (
      <RepositoryView
        repos={skillsRepos()}
        controls={controls}
        datasetGeneratedAt="2026-06-18T00:00:00Z"
        initialNow={NOW}
        skillsClassification={skills.data}
        skillsStatus={skills.status}
        starsSha256={LIVE_STARS_SHA}
      />
    );
  }

  /**
   * jsdom lacks `crypto.subtle`; the real loader's byte-integrity step needs it.
   * MUST await `fn()` inside the try: `return fn()` (no await) runs `finally` and
   * restores jsdom's crypto BEFORE the async load's digest step runs, which would
   * make every E2E-2 arm settle `unavailable` via missing-crypto rather than the
   * digest comparison (pre-commit R1 finding, sol + luna + grok convergent).
   */
  async function withWebCrypto<T>(fn: () => Promise<T>): Promise<T> {
    const original = globalThis.crypto;
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    }
    try {
      return await fn();
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  }

  /** A schema-valid, count-consistent pair; the declared digest is overridable. */
  function validPair(classificationSha256Override?: string) {
    const artifactText = serializeSkillsClassification({
      scope: { id: 'coding-agent-skills-ecosystem', label: 'x', description: 'y' },
      categories: [
        {
          id: 'verification-qa',
          label: 'V',
          kind: 'domain',
          definition: 'd',
          order: 0,
          target_pack: 'opus-pack',
        },
      ],
      entries: [
        {
          source_name_with_owner: 'alpha/one',
          node_id: 'R_kgDOe2e00001',
          resolution: 'resolved',
          primary_category_id: 'verification-qa',
          secondary_category_ids: [],
          summary: 'E2E fixture entry.',
        },
      ],
    });
    const realDigest = createHash('sha256').update(artifactText, 'utf8').digest('hex');
    const metaText = serializeSkillsClassificationMeta({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: classificationSha256Override ?? realDigest,
      source_sha256: 'b'.repeat(64),
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256: LIVE_STARS_SHA,
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
    return { artifactText, metaText, realDigest };
  }

  /** A fetch stub serving a specific meta/artifact status pair. */
  function stubFetch(opts: {
    metaBody: string | null;
    metaStatus: number;
    artifactBody: string | null;
    artifactStatus: number;
  }): typeof fetch {
    return (async (input: RequestInfo | URL) =>
      String(input).includes('skills-classification-meta.json')
        ? new Response(opts.metaBody, { status: opts.metaStatus })
        : new Response(opts.artifactBody, { status: opts.artifactStatus })) as typeof fetch;
  }

  it('M25-FS-E2E-1 (artifact missing): a VALID meta but a 404 on the ARTIFACT fetch → the REAL loader/hook reaches its artifact-missing branch → `unavailable` → the REAL projection fail-soft conjunction (the meta-first 404 path is MATRIX-3; this exercises the distinct artifact-absence branch end to end)', async () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    const { metaText } = validPair();
    const loader = () =>
      loadSkillsClassification({
        fetchImpl: stubFetch({
          metaBody: metaText,
          metaStatus: 200,
          artifactBody: null,
          artifactStatus: 404,
        }),
      });
    render(<E2EHarness loader={loader} />);
    await waitFor(() =>
      expect(screen.getByText(/Skills classification is unavailable/)).toBeTruthy(),
    );
    expectFailSoftConjunction();
  });

  it('M25-FS-E2E-2 (integrity failure): with crypto held across the async load, a MISMATCHING declared classification_sha256 → the REAL loader rejects the received bytes → `unavailable`; a byte-identical body with the MATCHING digest → `ready` — the paired control proves the DIGEST (not missing crypto) is what degraded the layer (byte-before-decode ORDER is pinned in integrity-bytes.test.ts)', async () => {
    await withWebCrypto(async () => {
      const { artifactText, metaText, realDigest } = validPair('0'.repeat(64));
      // MISMATCH arm → unavailable
      window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
      render(
        <E2EHarness
          loader={() =>
            loadSkillsClassification({
              fetchImpl: stubFetch({
                metaBody: metaText,
                metaStatus: 200,
                artifactBody: artifactText,
                artifactStatus: 200,
              }),
            })
          }
        />,
      );
      await waitFor(() =>
        expect(screen.getByText(/Skills classification is unavailable/)).toBeTruthy(),
      );
      expectFailSoftConjunction();

      // CONTROL: same bytes, CORRECT digest → the layer reaches READY (the facet
      // section renders). If the digest were not compared, the mismatch arm would
      // have behaved identically — so this control is what makes the mismatch
      // load-bearing rather than a crypto-availability artifact.
      cleanup();
      const good = validPair(realDigest); // == validPair() ; digest matches its bytes
      window.history.replaceState(null, '', '/');
      render(
        <E2EHarness
          loader={() =>
            loadSkillsClassification({
              fetchImpl: stubFetch({
                metaBody: good.metaText,
                metaStatus: 200,
                artifactBody: good.artifactText,
                artifactStatus: 200,
              }),
            })
          }
        />,
      );
      await waitFor(() => expect(within(sidebar()).getByText('Skills ecosystem')).toBeTruthy());
      expect(screen.queryByText(/Skills classification is unavailable/)).toBeNull();
    });
  });
});
