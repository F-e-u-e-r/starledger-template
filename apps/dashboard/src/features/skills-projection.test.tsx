// @vitest-environment jsdom
/**
 * M2.4 acceptance suite (P7 §4.11 + §4.12): Skills-ecosystem scope +
 * Skill-category facet + card badges + requested/effective semantics across
 * `loading | ready | unavailable` (first sub-slice), plus search enrichment,
 * the curated-summary card line, the `.md` download link and the 3-number
 * coverage line (second sub-slice — SEQ-1/SEQ-2 flipped from absence pins to
 * presence contracts). Mirrors the M0 ai-enrichment acceptance shape. The
 * headline gate: classification unavailability must leave the base Starred
 * browser fully functional — requested skills state stays in the URL, and
 * results are NEVER zeroed by the optional layer's absence.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveRepo } from '../data/derive-fields';
import {
  DEFAULT_DASHBOARD_STATE,
  parseDashboardState,
  serializeDashboardState,
} from '../state/dashboard-state';
import { useDashboardState } from '../state/use-dashboard-state';
import { makeRepo, makeSkillsClassification, makeSkillsRecord } from '../test-utils';
import { EMPTY_FILTERS, applyFilters } from './filters/filters';
import { RepositoryCard } from './repositories/RepositoryCard';
import { RepositoryView } from './repositories/RepositoryView';
import { dashboardToView, prepareRepositories } from './repositories/select';
import { matchesSearchText } from './search/search';

const NOW = new Date('2026-06-19T00:00:00Z');
/** Equals the fixture default `generatedAgainstStarsSha256` — no §2.1 note. */
const LIVE_STARS_SHA = '0'.repeat(64);

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

/** Provides the App-owned canonical-state controls (see RepositoryView.test). */
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

/** One primary-classified, one secondary-classified, one unclassified repo. */
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

const classification = () =>
  makeSkillsClassification({
    R_cls: makeSkillsRecord({ primaryCategoryId: 'verification-qa' }),
    R_sec: makeSkillsRecord({
      primaryCategoryId: 'design-ui',
      secondaryCategoryIds: ['verification-qa'],
    }),
  });

const readyProps = () => ({
  skillsClassification: classification(),
  skillsStatus: 'ready' as const,
  starsSha256: LIVE_STARS_SHA,
});

/** Card title links only — scoped to the results list so sidebar links (the
 *  §4.12 `.md` download link) never leak into result assertions; `[]` when the
 *  view renders NoResults instead of a card list. */
const titles = () => {
  const list = document.querySelector('.card-list');
  return list
    ? within(list as HTMLElement)
        .getAllByRole('link')
        .map((a) => a.textContent)
    : [];
};

describe('M2.4 neutralization + filter mapping (§4.11)', () => {
  it('M24-FS-1: dashboardToView(state, aiReady, skillsReady=false) neutralizes scope+skillCategories, preserves every other filter', () => {
    const state = {
      ...DEFAULT_DASHBOARD_STATE,
      scope: 'skills' as const,
      skillCategories: ['verification-qa'],
      languages: ['Go'],
      categories: ['ai-ml'],
    };
    const degraded = dashboardToView(state, true, false);
    expect(degraded.filters.skillsScope).toBe(false);
    expect(degraded.filters.skillCategories).toEqual([]);
    expect(degraded.filters.languages).toEqual(['Go']); // canonical facet untouched
    expect(degraded.filters.categories).toEqual(['ai-ml']); // AI gate independent
    const ready = dashboardToView(state, true, true);
    expect(ready.filters.skillsScope).toBe(true);
    expect(ready.filters.skillCategories).toEqual(['verification-qa']);
  });

  it('SKILL-FILTER-1: the scope narrows to classified repos; unclassified is an ordinary non-match', () => {
    const prepared = prepareRepositories(skillsRepos(), NOW, undefined, classification().byNodeId);
    const out = applyFilters(prepared, { ...EMPTY_FILTERS, skillsScope: true });
    expect(out.map((r) => r.node_id).sort()).toEqual(['R_cls', 'R_sec']);
  });

  it('SKILL-FILTER-2: the skill facet matches primary OR secondary; OR within the facet', () => {
    const prepared = prepareRepositories(skillsRepos(), NOW, undefined, classification().byNodeId);
    // verification-qa is R_cls's primary AND R_sec's secondary — both match.
    expect(
      applyFilters(prepared, { ...EMPTY_FILTERS, skillCategories: ['verification-qa'] })
        .map((r) => r.node_id)
        .sort(),
    ).toEqual(['R_cls', 'R_sec']);
    expect(
      applyFilters(prepared, { ...EMPTY_FILTERS, skillCategories: ['design-ui'] }).map(
        (r) => r.node_id,
      ),
    ).toEqual(['R_sec']);
    // OR within the facet: either category admits its repos.
    expect(
      applyFilters(prepared, {
        ...EMPTY_FILTERS,
        skillCategories: ['design-ui', 'infra-runtime'],
      }).map((r) => r.node_id),
    ).toEqual(['R_sec']);
  });

  it('SEQ-2: ready + classified ⇒ the card renders the curated summary; unclassified and not-ready cards do NOT (§4.12 — flipped from the ss1 absence pin)', () => {
    renderView(skillsRepos(), readyProps());
    const cardOf = (name: string) =>
      screen.getByRole('link', { name }).closest('li.card') as HTMLElement;
    expect(within(cardOf('acme/classified')).getByText('Curated one-liner.')).toBeTruthy();
    expect(within(cardOf('acme/secondary')).getByText('Curated one-liner.')).toBeTruthy();
    // Absence is not a classification: the unclassified card carries no summary
    // line and no empty summary container (SKILLS-3's byte-equality companion).
    expect(within(cardOf('acme/plain')).queryByText('Curated one-liner.')).toBeNull();
    expect(cardOf('acme/plain').querySelector('.card-skill-summary')).toBeNull();

    cleanup();
    // Data present, status loading: rendering keys on readiness, never on data
    // presence alone (the M24-BDG-1 discrimination, extended to the summary).
    renderView(skillsRepos(), { skillsClassification: classification(), skillsStatus: 'loading' });
    expect(screen.queryByText('Curated one-liner.')).toBeNull();
  });

  it('SEQ-1: taxonomy labels + curated summary ARE searchable under a ready join; id slugs are NOT; the degraded corpus is base-only (§4.12/§7 — flipped from the ss1 absence pin)', () => {
    const ready = classification();
    const labels = new Map(ready.categories.map((c) => [c.id, c.label] as const));
    const prepared = prepareRepositories(skillsRepos(), NOW, undefined, ready.byNodeId, labels);
    const classified = prepared.find((r) => r.node_id === 'R_cls')!;
    expect(classified.skills).not.toBeNull();
    // the primary taxonomy LABEL matches
    expect(matchesSearchText(classified.searchText, 'verification & qa')).toBe(true);
    // the curated summary matches
    expect(matchesSearchText(classified.searchText, 'curated one-liner')).toBe(true);
    // id SLUGS stay out of the corpus — URL-canonical machine tokens, not
    // search vocabulary (the ss1 id-exclusion arm survives the flip)
    expect(matchesSearchText(classified.searchText, 'verification-qa')).toBe(false);
    // base fields still searchable
    expect(matchesSearchText(classified.searchText, 'harness')).toBe(true);
    // secondary labels enter the corpus too
    const secondary = prepared.find((r) => r.node_id === 'R_sec')!;
    expect(matchesSearchText(secondary.searchText, 'design & ui')).toBe(true);
    expect(matchesSearchText(secondary.searchText, 'verification & qa')).toBe(true);
    // an unclassified repo gains nothing
    const plain = prepared.find((r) => r.node_id === 'R_plain')!;
    expect(matchesSearchText(plain.searchText, 'curated one-liner')).toBe(false);
    // degraded corpus (§7): no layer ⇒ base fields only — an enrichment-only
    // term legitimately matches nothing (the end-to-end half is M24-SRCH-1)
    const degraded = prepareRepositories(skillsRepos(), NOW);
    const degradedCls = degraded.find((r) => r.node_id === 'R_cls')!;
    expect(matchesSearchText(degradedCls.searchText, 'verification & qa')).toBe(false);
    expect(matchesSearchText(degradedCls.searchText, 'curated one-liner')).toBe(false);
  });
});

describe('M2.4 requested/effective semantics (§2.2 wired — the acceptance gate)', () => {
  it('M24-FS-2: bookmarked scope+skill with the layer UNAVAILABLE → base preserved, nothing counted, degraded surfaced, URL retained', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(); // no skills props → layer unavailable
    // base entities preserved — never blanked to zero, never narrowed
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    // not counted as effective filters (no "· filtered")
    expect(screen.getByText('3 of 3 repositories')).toBeTruthy();
    // degraded state explicitly surfaced with unavailable wording
    expect(screen.getByText(/Skills classification is unavailable/)).toBeTruthy();
    // requested values retained for recoverability
    expect(window.location.search).toBe('?scope=skills&skill=verification-qa');
  });

  it('M24-FS-3: while the layer is LOADING, the same holds with loading-specific wording (never "unavailable")', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    // Data deliberately PRESENT while status says loading: the status, not data
    // presence, must gate application (discriminates a dropped ready-gate).
    renderView(skillsRepos(), { skillsClassification: classification(), skillsStatus: 'loading' });
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(screen.getByText(/Skills classification is still loading/)).toBeTruthy();
    expect(screen.queryByText(/Skills classification is unavailable/)).toBeNull();
    expect(window.location.search).toBe('?scope=skills&skill=verification-qa');
  });

  it('M24-STS-1: classification DATA with NO status must not activate anything — status `ready` is the sole activation condition (charter #2, pre-commit R1 F-A)', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), { skillsClassification: classification() }); // data present, status omitted
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(screen.getByText('3 of 3 repositories')).toBeTruthy();
    expect(screen.queryByText('Skills ecosystem')).toBeNull(); // no facet section
    expect(document.querySelector('.badge-skill')).toBeNull(); // no badges
    expect(screen.getByText(/Skills classification is unavailable/)).toBeTruthy();
  });

  it('M24-STS-2: data + explicit `unavailable` status stays fully neutral with unavailable wording (oracle for a status≠loading-activates mutant — pre-commit R1 F-C)', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), {
      skillsClassification: classification(),
      skillsStatus: 'unavailable',
    });
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(screen.getByText(/Skills classification is unavailable/)).toBeTruthy();
    expect(screen.queryByText('Skills ecosystem')).toBeNull();
    expect(document.querySelector('.badge-skill')).toBeNull();
  });

  it('M24-STS-4: `ready` STATUS with NO data must not activate either — an incoherent assembly degrades, it never zeroes results (pre-commit R2, sol)', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), { skillsStatus: 'ready' }); // status claims ready, data absent
    expect(titles().sort()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']);
    expect(screen.getByText('3 of 3 repositories')).toBeTruthy(); // never 0 results
    expect(screen.getByText(/Skills classification is unavailable/)).toBeTruthy();
    expect(screen.queryByText('Skills ecosystem')).toBeNull();
    expect(document.querySelector('.badge-skill')).toBeNull();
  });

  it('M24-STS-3: dashboardToView with skillsReady unspecified is FAIL-CLOSED — no caller may activate skills filtering by default (pre-commit R1 F-A)', () => {
    const state = {
      ...DEFAULT_DASHBOARD_STATE,
      scope: 'skills' as const,
      skillCategories: ['verification-qa'],
    };
    const view = dashboardToView(state, true); // skillsReady omitted
    expect(view.filters.skillsScope).toBe(false);
    expect(view.filters.skillCategories).toEqual([]);
  });

  it('M24-FS-4: with the layer READY, scope and facet genuinely narrow — unclassified repos are correctly excluded', () => {
    window.history.replaceState(null, '', '/?scope=skills');
    renderView(skillsRepos(), readyProps());
    expect(titles().sort()).toEqual(['acme/classified', 'acme/secondary']);
    expect(screen.getByText('2 of 3 · filtered')).toBeTruthy();
    expect(screen.queryByText(/Skills classification/)).toBeNull(); // no degraded notice

    cleanup();
    window.history.replaceState(null, '', '/?skill=design-ui');
    renderView(skillsRepos(), readyProps());
    expect(titles()).toEqual(['acme/secondary']); // secondary's primary category
    expect(screen.getByText('1 of 3 · filtered')).toBeTruthy();
  });

  it('M24-FS-5a: with the layer unavailable + requested skills state, search / sort / density all operate normally', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView();
    // search narrows on base fields
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search repositories' }), {
      target: { value: 'harness' },
    });
    expect(titles()).toEqual(['acme/classified']);
    expect(screen.getByText('1 result for "harness"')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    // sort operates
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'name_with_owner' },
    });
    expect(titles()).toEqual(['acme/classified', 'acme/plain', 'acme/secondary']); // A→Z
    // density operates
    fireEvent.change(screen.getByRole('combobox', { name: 'Density' }), {
      target: { value: 'comfortable' },
    });
    // requested skills state survives every interaction
    expect(window.location.search).toBe(
      '?scope=skills&skill=verification-qa&sort=name_with_owner&density=comfortable',
    );
  });

  it('M24-FS-5b: with the layer unavailable + requested scope, pagination operates on the un-narrowed base set', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      makeRepo({
        node_id: `R_${i}`,
        name_with_owner: `acme/repo-${String(i).padStart(2, '0')}`,
        url: `https://github.com/acme/repo-${i}`,
      }),
    );
    window.history.replaceState(null, '', '/?scope=skills');
    renderView(many);
    expect(screen.getByText('50 of 50 repositories')).toBeTruthy(); // not zeroed, not narrowed
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(window.location.search).toBe('?scope=skills&page=2'); // scope retained, §4.11 emit order
  });

  it('M24-SRCH-1: a label-only query narrows to exactly the classified repos when ready; the SAME query with the layer unavailable yields 0 results — never "show all" (§4.12/§7, both directions)', () => {
    renderView(skillsRepos(), readyProps());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search repositories' }), {
      target: { value: 'verification & qa' },
    });
    // R_cls (primary label) + R_sec (secondary label); R_plain matches nothing
    expect(titles().sort()).toEqual(['acme/classified', 'acme/secondary']);
    expect(screen.getByText('2 results for "verification & qa"')).toBeTruthy();

    cleanup();
    window.history.replaceState(null, '', '/');
    renderView(); // layer unavailable
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search repositories' }), {
      target: { value: 'verification & qa' },
    });
    // Degraded corpus = base fields only (§7): an enrichment-only query returns
    // an honest 0 — never silently widened to "show all".
    expect(titles()).toEqual([]);
    expect(screen.getByText('0 results for "verification & qa"')).toBeTruthy();
  });

  it('M24-CNT-1: suppressed skills values are excluded from the Filters count and summary, yet counted once ready; chips stay visible both ways', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(); // unavailable
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy(); // effective 0 → no count suffix
    expect(screen.getByText('3 of 3 repositories')).toBeTruthy(); // no "· filtered"
    expect(screen.getByText('2 active filters')).toBeTruthy(); // chips keep the requested values

    cleanup();
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), readyProps());
    expect(screen.getByRole('button', { name: 'Filters 2' })).toBeTruthy();
    expect(screen.getByText('2 of 3 · filtered')).toBeTruthy();
    expect(screen.getByText('2 active filters')).toBeTruthy();
  });

  it('CHIP-1: the scope chip and skill chip are individually removable; skill chips use taxonomy labels when ready, id slugs when degraded', () => {
    window.history.replaceState(null, '', '/?scope=skills&skill=verification-qa');
    renderView(skillsRepos(), readyProps());
    expect(screen.getByRole('button', { name: /Skill: Verification & QA/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Scope: Skills ecosystem/ }));
    expect(window.location.search).toBe('?skill=verification-qa');
    fireEvent.click(screen.getByRole('button', { name: /Skill: Verification & QA/ }));
    expect(window.location.search).toBe('');

    cleanup();
    window.history.replaceState(null, '', '/?skill=verification-qa');
    renderView(); // degraded → no taxonomy → id slug
    expect(screen.getByRole('button', { name: /Skill: verification-qa/ })).toBeTruthy();
  });
});

describe('M2.4 facet UI + provenance note (§4.11/§2.1)', () => {
  it('FACET-UI-1: the Skills ecosystem section renders the FULL taxonomy in canonical order when ready; hidden when not ready', () => {
    renderView(skillsRepos(), readyProps());
    const sidebar = screen.getByRole('complementary', { name: 'Filters' });
    expect(within(sidebar).getByText('Skills ecosystem')).toBeTruthy();
    const facet = within(sidebar).getByRole('group', { name: 'Skill category' });
    const options = within(facet)
      .getAllByRole('checkbox')
      .map((el) => el.parentElement?.textContent);
    // Canonical §4.2 I-5 order, all three taxonomy categories — including the
    // one with zero live matches (options are the taxonomy, never data-mined).
    expect(options).toEqual(['Verification & QA', 'Design & UI', 'Infra & Runtime']);

    cleanup();
    renderView(); // unavailable → section hidden (M0 AI-facet precedent)
    expect(screen.queryByText('Skills ecosystem')).toBeNull();
  });

  it('M24-DRW-1: the mobile filter drawer carries the Skills facet too — sidebar/drawer parity (PR #263 review F6)', () => {
    renderView(skillsRepos(), readyProps());
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const drawer = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(drawer).getByText('Skills ecosystem')).toBeTruthy();
    expect(
      within(drawer).getByRole('checkbox', { name: 'Skills-ecosystem repos only' }),
    ).toBeTruthy();
  });

  it('FACET-UI-2: the scope checkbox and a category checkbox drive the canonical state', () => {
    renderView(skillsRepos(), readyProps());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Skills-ecosystem repos only' }));
    expect(window.location.search).toBe('?scope=skills');
    expect(titles().sort()).toEqual(['acme/classified', 'acme/secondary']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Design & UI' }));
    expect(window.location.search).toBe('?scope=skills&skill=design-ui');
    expect(titles()).toEqual(['acme/secondary']);
  });

  it('M24-PRV-1: the §2.1 soft note renders ONLY when ready + the generation hash differs from the live dataset', () => {
    // ready + match (fixture default) → no note
    renderView(skillsRepos(), readyProps());
    expect(screen.queryByText(/generated against an older snapshot/)).toBeNull();

    cleanup();
    // ready + mismatch → soft note in the Skills ecosystem section
    renderView(skillsRepos(), { ...readyProps(), starsSha256: 'f'.repeat(64) });
    expect(screen.getByText(/generated against an older snapshot/)).toBeTruthy();

    cleanup();
    // not ready → never (there is no generation hash to compare)
    renderView(skillsRepos(), { starsSha256: 'f'.repeat(64) });
    expect(screen.queryByText(/generated against an older snapshot/)).toBeNull();
  });

  it('M24-COV-1: ready ⇒ the three generation-time coverage numbers render separately labeled in the Skills-ecosystem section; not-ready ⇒ absent (§4.12/§5)', () => {
    renderView(skillsRepos(), readyProps());
    const sidebar = screen.getByRole('complementary', { name: 'Filters' });
    // One line, three separately-labeled numbers, fixture values 2/1/0 all
    // distinct — any swap, sum, or relabel breaks the exact text (§5's
    // "never conflate"; the numbers are loader `coverage`, never live-derived).
    expect(
      within(sidebar).getByText(
        'Coverage at generation: 2 matched · 1 unclassified · 0 unresolved source entries',
      ),
    ).toBeTruthy();

    cleanup();
    renderView(skillsRepos(), { skillsClassification: classification(), skillsStatus: 'loading' });
    expect(screen.queryByText(/Coverage at generation/)).toBeNull();
  });

  it('M24-COV-2: ready + coverage.matched=0 keeps the layer READY — section + explicit zero-coverage sentence render, the join map still narrows, no degraded notice (§4.12, F2 re-entry pin)', () => {
    const zeroCoverage = (entries: Record<string, ReturnType<typeof makeSkillsRecord>>) =>
      makeSkillsClassification(entries, {
        coverage: { matched: 0, unclassified: 3, unresolved: 2 },
      });

    // Discriminating arm: matched=0 beside a NON-EMPTY join map — filtering
    // must key on the map, never on the statistic (matched counts the
    // GENERATION snapshot; a later re-star can legitimately join while the
    // recorded matched stays 0). A readiness or filter derived from coverage
    // fails here.
    window.history.replaceState(null, '', '/?scope=skills');
    renderView(skillsRepos(), {
      skillsClassification: zeroCoverage({
        R_cls: makeSkillsRecord({ primaryCategoryId: 'verification-qa' }),
        R_sec: makeSkillsRecord({
          primaryCategoryId: 'design-ui',
          secondaryCategoryIds: ['verification-qa'],
        }),
      }),
      skillsStatus: 'ready',
      starsSha256: LIVE_STARS_SHA,
    });
    expect(screen.getByText('Skills ecosystem')).toBeTruthy(); // READY: section renders
    expect(
      screen.getByText(
        'Coverage at generation: 0 matched · 3 unclassified · 2 unresolved source entries',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/matched none of the starred repositories at generation time/),
    ).toBeTruthy();
    expect(titles().sort()).toEqual(['acme/classified', 'acme/secondary']); // the map still narrows
    expect(screen.getByText('2 of 3 · filtered')).toBeTruthy(); // still an effective filter
    expect(screen.queryByText(/Skills classification/)).toBeNull(); // never a degraded notice
    // R1 L2: the download link and the category facet must SURVIVE matched=0 —
    // a matched-gated link or facet is the same F2 violation in miniature.
    expect(
      screen.getByRole('link', { name: 'Download the classification source (.md)' }),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Verification & QA' })).toBeTruthy();

    cleanup();
    // Realistic arm: matched=0 with an EMPTY map — zero-yield narrowing stays a
    // valid READY result (owner F2 ruling): 0 results with recovery, never
    // demoted to `unavailable`, section still present.
    window.history.replaceState(null, '', '/?scope=skills');
    renderView(skillsRepos(), {
      skillsClassification: zeroCoverage({}),
      skillsStatus: 'ready',
      starsSha256: LIVE_STARS_SHA,
    });
    expect(screen.getByText('Skills ecosystem')).toBeTruthy();
    expect(screen.getByText('0 of 3 · filtered')).toBeTruthy();
    expect(titles()).toEqual([]);
    expect(screen.getByText(/matched none of the starred repositories/)).toBeTruthy();
    expect(screen.queryByText(/Skills classification/)).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Download the classification source (.md)' }),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Design & UI' })).toBeTruthy();
  });

  it('M24-DL-1: ready ⇒ a same-origin download link for the vendored .md in the Skills-ecosystem section; not-ready ⇒ absent (§4.12)', () => {
    renderView(skillsRepos(), readyProps());
    const link = screen.getByRole('link', {
      name: 'Download the classification source (.md)',
    }) as HTMLAnchorElement;
    // BASE_URL-relative ⇒ same-origin by construction (tests run with '/')
    expect(link.getAttribute('href')).toBe('/skills-classified.md');
    expect(link.hasAttribute('download')).toBe(true);

    cleanup();
    renderView(skillsRepos(), { skillsClassification: classification(), skillsStatus: 'loading' });
    expect(screen.queryByRole('link', { name: /Download the classification source/ })).toBeNull();
  });

  it('M24-DL-2: the href derives from BASE_URL — under a non-root base (the Pages subpath) it carries the base prefix (R1 sol: a hardcoded "/" href is invisible at the test default)', () => {
    vi.stubEnv('BASE_URL', '/starledger/');
    try {
      renderView(skillsRepos(), readyProps());
      const link = screen.getByRole('link', {
        name: 'Download the classification source (.md)',
      }) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/starledger/skills-classified.md');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('M2.4 badges (§8 v1)', () => {
  it('M24-BDG-1: ready + classified → primary (and ≤1 secondary) taxonomy-labeled badges; unclassified → none; not ready → none', () => {
    renderView(skillsRepos(), readyProps());
    const cardOf = (name: string) =>
      screen.getByRole('link', { name }).closest('li.card') as HTMLElement;
    const badgesIn = (name: string) =>
      Array.from(cardOf(name).querySelectorAll('.badge-skill')).map((el) => el.textContent);
    expect(badgesIn('acme/classified')).toEqual(['Verification & QA']);
    expect(badgesIn('acme/secondary')).toEqual(['Design & UI', 'Verification & QA']);
    expect(badgesIn('acme/plain')).toEqual([]); // absence is not a classification

    cleanup();
    // Data present, status loading: badges must key on readiness, never on
    // data presence alone (discriminates a dropped ready-gate on the join map).
    renderView(skillsRepos(), { skillsClassification: classification(), skillsStatus: 'loading' });
    expect(document.querySelector('.badge-skill')).toBeNull();
  });

  it('M24-BDG-2: a card without a labels map falls back to the canonical id slug (defensive display only)', () => {
    render(
      <ul>
        <RepositoryCard
          repo={deriveRepo(makeRepo({ node_id: 'R_1' }), NOW, null, makeSkillsRecord())}
          now={NOW}
        />
      </ul>,
    );
    expect(screen.getByText('verification-qa')).toBeTruthy();
  });
});

describe('M2.4 URL codec + reset semantics (§6 amendments)', () => {
  it('M24-URL-1: scope/skill round-trip; §4.11 emit order; invalid scope → default; unknown skill ids preserved, deduped + sorted', () => {
    const state = parseDashboardState(
      new URLSearchParams('scope=skills&skill=b-cat&skill=a-cat&skill=a-cat&view=discovery&q=x'),
    );
    expect(state.scope).toBe('skills');
    expect(state.skillCategories).toEqual(['a-cat', 'b-cat']); // deduped + sorted
    // emit order: view, scope, skill, then the P1 order (§4.11)
    expect(serializeDashboardState(state)).toBe(
      'view=discovery&scope=skills&skill=a-cat&skill=b-cat&q=x',
    );
    // round trip is exact
    expect(parseDashboardState(new URLSearchParams(serializeDashboardState(state)))).toEqual(state);
    // invalid scope falls back to the default and is omitted on re-serialization
    const invalid = parseDashboardState(new URLSearchParams('scope=bogus&skill=kept-anyway'));
    expect(invalid.scope).toBe('all');
    expect(invalid.skillCategories).toEqual(['kept-anyway']); // unknown id preserved (bookmark)
    expect(serializeDashboardState(invalid)).toBe('skill=kept-anyway');
    // defaults stay omitted entirely
    expect(serializeDashboardState(DEFAULT_DASHBOARD_STATE)).toBe('');
  });

  it('M24-RST-1: scope/skill value changes reset page → 1; a no-op does not; explicit page wins; clear-all clears both, preserving view/density', () => {
    // A bare state probe (no RepositoryView) so §6.2 reconciliation cannot
    // rewrite the page and mask the §6.3 reset behavior under test.
    function ResetProbe() {
      const { state, update, reset } = useDashboardState();
      return (
        <div>
          <span data-testid="page">{state.page}</span>
          <span data-testid="scope">{state.scope}</span>
          <span data-testid="skills">{state.skillCategories.join(',')}</span>
          <span data-testid="view">{state.view}</span>
          <span data-testid="density">{state.density}</span>
          <button onClick={() => update({ page: 3 })}>goPage3</button>
          <button onClick={() => update({ scope: 'skills' })}>scopeSkills</button>
          <button onClick={() => update({ skillCategories: ['verification-qa'] })}>addSkill</button>
          <button onClick={() => update({ scope: 'all', page: 5 })}>scopeAndPage</button>
          <button onClick={() => update({ view: 'discovery' })}>toDiscovery</button>
          <button onClick={() => update({ density: 'comfortable' })}>toComfy</button>
          <button onClick={() => reset()}>clearAll</button>
        </div>
      );
    }
    render(<ResetProbe />);
    const page = () => screen.getByTestId('page').textContent;

    // scope value change resets the page
    fireEvent.click(screen.getByText('goPage3'));
    expect(page()).toBe('3');
    fireEvent.click(screen.getByText('scopeSkills'));
    expect(page()).toBe('1');
    // a no-op re-set of the same scope value must NOT reset
    fireEvent.click(screen.getByText('goPage3'));
    fireEvent.click(screen.getByText('scopeSkills'));
    expect(page()).toBe('3');
    // a skill-category value change resets
    fireEvent.click(screen.getByText('addSkill'));
    expect(page()).toBe('1');
    // an explicit page in the same update wins over the implicit reset
    fireEvent.click(screen.getByText('scopeAndPage')); // scope skills→all + page 5
    expect(page()).toBe('5');
    expect(screen.getByTestId('scope').textContent).toBe('all');
    // clear-all clears scope + skillCategories but preserves view and density
    fireEvent.click(screen.getByText('toDiscovery'));
    fireEvent.click(screen.getByText('toComfy'));
    fireEvent.click(screen.getByText('scopeSkills'));
    fireEvent.click(screen.getByText('clearAll'));
    expect(screen.getByTestId('scope').textContent).toBe('all');
    expect(screen.getByTestId('skills').textContent).toBe('');
    expect(page()).toBe('1');
    expect(screen.getByTestId('view').textContent).toBe('discovery');
    expect(screen.getByTestId('density').textContent).toBe('comfortable');
  });
});
