// @vitest-environment jsdom
/**
 * M4.1 view-level acceptance suite (P7 §15.5–§15.8, §15.10): grouped
 * presentation as a pure projection AFTER search → filter → sort, the U1
 * exclusion disclosure, the requested/effective fail-soft matrix across
 * `loading | ready | unavailable`, single-page grouped rendering, the E-G
 * grouped-empty state, the h2 → h3 → h4 heading contract, and the invariant
 * that `group` is presentation-only — never a filter. Mirrors the M2.4
 * `skills-projection` harness (App-owned canonical state via the real hook).
 */
import type { SkillsCategory } from '@starred/skills-schema/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDashboardState } from '../../state/dashboard-state';
import { useDashboardState } from '../../state/use-dashboard-state';
import { makeRepo, makeSkillsClassification, makeSkillsRecord } from '../../test-utils';
import { activeFilterCount } from '../filters/FilterChips';
import { RepositoryView } from './RepositoryView';

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

type ViewProps = Partial<Omit<ComponentProps<typeof RepositoryView>, 'controls' | 'repos'>>;

const view = (repos: ReturnType<typeof makeRepo>[], extra: ViewProps = {}) => (
  <Harness repos={repos} datasetGeneratedAt="2026-06-18T00:00:00Z" initialNow={NOW} {...extra} />
);

function renderView(repos = smallRepos(), extra: ViewProps = {}) {
  return render(view(repos, extra));
}

/**
 * Taxonomy in canonical `order` (I-5). Label order is NOT alphabetical
 * (alphabetical would be Infra, MCP, Security, Verification), so a view that
 * sorted headings by label would differ from the contract.
 */
const CATEGORIES: SkillsCategory[] = [
  {
    id: 'security',
    label: 'Security',
    kind: 'domain',
    definition: 'Security skills.',
    order: 0,
    target_pack: null,
  },
  {
    id: 'mcp-integrations',
    label: 'MCP integrations',
    kind: 'domain',
    definition: 'MCP servers and clients.',
    order: 1,
    target_pack: null,
  },
  {
    id: 'verification-qa',
    label: 'Verification & QA',
    kind: 'domain',
    definition: 'Testing, review, and QA skills.',
    order: 2,
    target_pack: null,
  },
  {
    id: 'infra-runtime',
    label: 'Infra & Runtime',
    kind: 'infrastructure',
    definition: 'Infrastructure repos.',
    order: 3,
    target_pack: null,
  },
];

/**
 * Seven repos: five classified across all four categories, two unclassified.
 * `starred_at` (the default sort, desc) puts `qa-zulu` before `qa-alpha`,
 * while name ascending puts `qa-alpha` first — so the two orders are
 * distinguishable inside the Verification & QA group. The substring
 * "security" appears in NO base field: only the taxonomy label carries it
 * (the M41-SRCH-1 / A1 fixture — Repo A = `R_sec`, Repo B = `R_mcp`).
 */
function smallRepos() {
  const repo = (
    node_id: string,
    name: string,
    primary_language: string,
    starredDay: number,
    stargazer_count: number,
  ) =>
    makeRepo({
      node_id,
      name_with_owner: `acme/${name}`,
      name,
      url: `https://github.com/acme/${name}`,
      primary_language,
      stargazer_count,
      starred_at: `2026-01-${String(starredDay).padStart(2, '0')}T00:00:00Z`,
    });
  return [
    repo('R_sec', 'sec-tool', 'TypeScript', 5, 50),
    repo('R_mcp', 'mcp-bridge', 'Go', 4, 40),
    repo('R_qa1', 'qa-alpha', 'TypeScript', 2, 30),
    repo('R_qa2', 'qa-zulu', 'Go', 3, 35),
    repo('R_infra', 'infra-rs', 'Rust', 1, 20),
    repo('R_plain1', 'plain-go', 'Go', 6, 10),
    repo('R_plain2', 'plain-ts', 'TypeScript', 7, 5),
  ];
}

const classification = () =>
  makeSkillsClassification(
    {
      R_sec: makeSkillsRecord({ primaryCategoryId: 'security' }),
      R_mcp: makeSkillsRecord({
        primaryCategoryId: 'mcp-integrations',
        secondaryCategoryIds: ['security'],
      }),
      R_qa1: makeSkillsRecord({ primaryCategoryId: 'verification-qa' }),
      R_qa2: makeSkillsRecord({ primaryCategoryId: 'verification-qa' }),
      R_infra: makeSkillsRecord({ primaryCategoryId: 'infra-runtime' }),
    },
    { categories: CATEGORIES, coverage: { matched: 5, unclassified: 2, unresolved: 0 } },
  );

const readyProps = () => ({
  skillsClassification: classification(),
  skillsStatus: 'ready' as const,
  starsSha256: LIVE_STARS_SHA,
});

/** 100 repos: the first 60 classified round-robin over the four categories
 *  (15 each), the last 40 unclassified — more than one 48-page of classified
 *  cards, so single-page grouped rendering is observable. */
function manyRepos() {
  return Array.from({ length: 100 }, (_, i) =>
    makeRepo({
      node_id: `R_${String(i).padStart(3, '0')}`,
      name_with_owner: `acme/tool-${String(i).padStart(3, '0')}`,
      url: `https://github.com/acme/tool-${i}`,
      stargazer_count: 100 - i,
    }),
  );
}

const manyClassification = () =>
  makeSkillsClassification(
    Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `R_${String(i).padStart(3, '0')}`,
        makeSkillsRecord({ primaryCategoryId: CATEGORIES[i % 4]?.id }),
      ]),
    ),
    { categories: CATEGORIES, coverage: { matched: 60, unclassified: 40, unresolved: 0 } },
  );

const manyReadyProps = () => ({
  skillsClassification: manyClassification(),
  skillsStatus: 'ready' as const,
  starsSha256: LIVE_STARS_SHA,
});

/** One `.result-group` section as data: `[id, heading text, card title links]`. */
type GroupRow = [id: string | undefined, heading: string | undefined, titles: (string | null)[]];

/** The grouped DOM as data, in DOM order. */
const groups = (): GroupRow[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.result-group')).map(
    (section): GroupRow => [
      section.getAttribute('aria-labelledby')?.replace(/^group-/, ''),
      section.querySelector('.result-group-heading')?.textContent ?? undefined,
      within(section)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ],
  );

/** Every card-title link on the page (flat list or all groups), DOM order. */
const allTitles = () =>
  Array.from(document.querySelectorAll('.card-list a')).map((a) => a.textContent);

const summary = () => document.querySelector('.result-count')?.textContent;
const groupSelect = () => screen.getByRole('combobox', { name: 'Group' }) as HTMLSelectElement;
const setGroup = (value: 'none' | 'skill') =>
  fireEvent.change(groupSelect(), { target: { value } });
const pager = () => screen.queryByRole('navigation', { name: 'Pagination' });
/** The pager when it MUST be present — a descriptive lookup failure otherwise. */
const pagerEl = () => screen.getByRole('navigation', { name: 'Pagination' });
/** The N-L / N-U group notice (a `.degraded-notice`), or null when absent. */
const groupNotice = () =>
  Array.from(document.querySelectorAll('.degraded-notice')).find((p) =>
    /grouped view/.test(p.textContent ?? ''),
  ) ?? null;
const search = () => screen.getByRole('searchbox', { name: 'Search repositories' });

describe('M4.1 grouped view — projection after search → filter → sort (§15.4)', () => {
  it('M41-GRP-1: a repo with a secondary category renders exactly once, under its PRIMARY heading; groups follow taxonomy order and omit nothing that is non-empty', () => {
    window.history.replaceState(null, '', '/?group=skill');
    renderView(smallRepos(), readyProps());
    expect(groups()).toEqual([
      ['security', 'Security · 1', ['acme/sec-tool']],
      ['mcp-integrations', 'MCP integrations · 1', ['acme/mcp-bridge']], // NOT also under Security
      ['verification-qa', 'Verification & QA · 2', ['acme/qa-zulu', 'acme/qa-alpha']],
      ['infra-runtime', 'Infra & Runtime · 1', ['acme/infra-rs']],
    ]);
    // one DOM node for that node_id, anywhere on the page
    expect(screen.getAllByRole('link', { name: 'acme/mcp-bridge' })).toHaveLength(1);
    // unclassified matches are counted, never rendered — and there is no
    // "Unclassified" pseudo-group
    expect(allTitles()).not.toContain('acme/plain-go');
    expect(screen.queryByText(/Unclassified/)).toBeNull();
    expect(summary()).toBe(
      '5 classified repositories in 4 categories · 2 matching repositories without Skills classification are not shown',
    );
  });

  it('M41-SRT-1: changing the sort re-orders cards INSIDE groups only — group order is taxonomy order under every sort', () => {
    window.history.replaceState(null, '', '/?group=skill');
    renderView(smallRepos(), readyProps());
    // default `starred_at desc`: qa-zulu (starred later) first
    expect(groups().map((g) => g[2])).toEqual([
      ['acme/sec-tool'],
      ['acme/mcp-bridge'],
      ['acme/qa-zulu', 'acme/qa-alpha'],
      ['acme/infra-rs'],
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'name_with_owner' }, // → asc by the field's natural default
    });
    expect(window.location.search).toBe('?group=skill&sort=name_with_owner');
    expect(groups().map((g) => [g[0], g[2]])).toEqual([
      ['security', ['acme/sec-tool']],
      ['mcp-integrations', ['acme/mcp-bridge']],
      ['verification-qa', ['acme/qa-alpha', 'acme/qa-zulu']], // re-ordered inside
      ['infra-runtime', ['acme/infra-rs']], // still last: not alphabetical by label
    ]);
    // flip the direction: every bucket reverses, the group sequence does not
    fireEvent.click(screen.getByRole('button', { name: /Sort direction/ }));
    expect(groups().map((g) => [g[0], g[2]])).toEqual([
      ['security', ['acme/sec-tool']],
      ['mcp-integrations', ['acme/mcp-bridge']],
      ['verification-qa', ['acme/qa-zulu', 'acme/qa-alpha']],
      ['infra-runtime', ['acme/infra-rs']],
    ]);
  });

  it('M41-FLT-1: filters apply BEFORE grouping — a language facet narrows groups and drops emptied ones; a secondary-only skill match renders under its primary heading (D12)', () => {
    window.history.replaceState(null, '', '/?group=skill&language=Go');
    renderView(smallRepos(), readyProps());
    // Go: mcp-bridge, qa-zulu, plain-go → Security and Infra are emptied → omitted
    expect(groups()).toEqual([
      ['mcp-integrations', 'MCP integrations · 1', ['acme/mcp-bridge']],
      ['verification-qa', 'Verification & QA · 1', ['acme/qa-zulu']],
    ]);
    expect(summary()).toBe(
      '2 classified repositories in 2 categories · filtered · 1 matching repository without Skills classification is not shown',
    );

    cleanup();
    // skill=security matches primary (sec-tool) OR secondary (mcp-bridge) —
    // the facet semantics are untouched; the PRESENTATION keys on primary.
    window.history.replaceState(null, '', '/?skill=security&group=skill');
    renderView(smallRepos(), readyProps());
    expect(groups()).toEqual([
      ['security', 'Security · 1', ['acme/sec-tool']],
      ['mcp-integrations', 'MCP integrations · 1', ['acme/mcp-bridge']], // under its primary, not Security
    ]);
    expect(summary()).toBe('2 classified repositories in 2 categories · filtered'); // E = 0: no disclosure
    expect(screen.queryByRole('button', { name: 'Show as list' })).toBeNull();
  });

  it('M41-SRCH-1: search applies BEFORE grouping with the existing enrichment semantics — a secondary-label match renders under its primary group (two groups); grouped node_ids == flat results minus unclassified', () => {
    window.history.replaceState(null, '', '/?group=skill');
    renderView(smallRepos(), readyProps());
    fireEvent.change(search(), { target: { value: 'security' } });
    expect(window.location.search).toBe('?group=skill&q=security');
    // Repo A (primary security) under Security; Repo B (secondary security)
    // under MCP integrations — its primary — so ONE query yields TWO groups.
    expect(groups()).toEqual([
      ['security', 'Security · 1', ['acme/sec-tool']],
      ['mcp-integrations', 'MCP integrations · 1', ['acme/mcp-bridge']],
    ]);
    expect(summary()).toBe('2 classified repositories in 2 categories for "security"');
    const groupedTitles = allTitles().sort();

    // Invariant: the same canonical state, flat = the same result set (no
    // unclassified repo matched, so nothing is excluded).
    setGroup('none');
    expect(window.location.search).toBe('?q=security');
    expect(allTitles().sort()).toEqual(groupedTitles);
    expect(summary()).toBe('2 results for "security"');

    // ...and with a query that ALSO matches an unclassified repo, the flat set
    // is the grouped set plus exactly the disclosed exclusions.
    fireEvent.change(search(), { target: { value: 'acme/' } }); // every repo
    expect(allTitles()).toHaveLength(7);
    setGroup('skill');
    expect(allTitles()).toHaveLength(5);
    expect(summary()).toBe(
      '5 classified repositories in 4 categories for "acme/" · 2 matching repositories without Skills classification are not shown',
    );
  });

  it('M41-UNC-1: scope=all discloses excludedCount and offers Show as list (→ flat count == prior results.length); scope=skills ⇒ no exclusion, no disclosure; the scope checkbox stays operable in grouped mode', () => {
    window.history.replaceState(null, '', '/?group=skill');
    renderView(smallRepos(), readyProps());
    expect(summary()).toBe(
      '5 classified repositories in 4 categories · 2 matching repositories without Skills classification are not shown',
    );
    // the button is the immediate sibling AFTER the summary, outside the live region
    const button = screen.getByRole('button', { name: 'Show as list' });
    const status = document.querySelector('.result-count') as HTMLElement;
    expect(status.nextElementSibling).toBe(button);
    expect(within(status).queryByRole('button')).toBeNull();
    fireEvent.click(button);
    expect(window.location.search).toBe('');
    expect(allTitles()).toHaveLength(7); // grouped 5 + excluded 2 == prior results.length
    expect(summary()).toBe('7 of 7 repositories');
    expect(groupSelect().value).toBe('none');

    // Explicit scope=skills (D3: the scope control stays independent and
    // operable): the universe is the classified set, so E = 0 — nothing to
    // disclose, no Show as list. `scope` IS a filter, hence "· filtered".
    setGroup('skill');
    const scope = screen.getAllByRole('checkbox', { name: 'Skills-ecosystem repos only' })[0];
    expect(scope).toBeDefined();
    fireEvent.click(scope as HTMLElement);
    expect(window.location.search).toBe('?scope=skills&group=skill');
    expect(summary()).toBe('5 classified repositories in 4 categories · filtered');
    expect(screen.queryByRole('button', { name: 'Show as list' })).toBeNull();
    expect(groups().map((g) => g[1])).toEqual([
      'Security · 1',
      'MCP integrations · 1',
      'Verification & QA · 2',
      'Infra & Runtime · 1',
    ]);
    // ...and back off again, still grouped
    fireEvent.click(scope as HTMLElement);
    expect(window.location.search).toBe('?group=skill');
    expect(screen.getByRole('button', { name: 'Show as list' })).toBeTruthy();
  });
});

describe('M4.1 requested vs effective — fail-soft matrix (§15.6)', () => {
  it('M41-FS-1: requested group=skill with the layer UNAVAILABLE ⇒ flat list + pager, N-U wording, control still shows `skill`, URL retained, Filters/chips unaffected', () => {
    window.history.replaceState(null, '', '/?group=skill&page=2');
    renderView(manyRepos()); // no skills props → layer unavailable
    // flat, paginated at 48/page (100 repos → 3 pages), on the requested page
    expect(document.querySelector('.result-group')).toBeNull();
    expect(allTitles()).toHaveLength(48);
    expect(within(pagerEl()).getByText('Page 2 of 3')).toBeTruthy();
    expect(summary()).toBe('100 of 100 repositories');
    // N-U wording (the group notice), and NOT the loading wording
    expect(
      screen.getByText(
        'Skills classification is unavailable, so grouped view isn’t applied and results are shown as a list. Group stays in your link and applies once the layer loads.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/still loading/)).toBeNull();
    // the skills FILTER notice is separate and absent (nothing requested there)
    expect(screen.queryByText(/scope and skill-category filters/)).toBeNull();
    // requested value shown and retained — recoverable, never rewritten
    expect(groupSelect().value).toBe('skill');
    expect(groupSelect().disabled).toBe(false);
    expect(window.location.search).toBe('?group=skill&page=2');
    // group is not a filter: no count, no chips
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull();

    cleanup();
    // both a skills FILTER and `group` requested while unavailable ⇒ two
    // independent notices coexist; still flat; the facet count is untouched
    window.history.replaceState(null, '', '/?scope=skills&group=skill&language=Go');
    renderView(smallRepos());
    expect(document.querySelector('.result-group')).toBeNull();
    expect(
      screen.getByText(/so the Skills-ecosystem scope and skill-category filters/),
    ).toBeTruthy();
    expect(screen.getByText(/so grouped view isn’t applied/)).toBeTruthy();
    expect(document.querySelectorAll('.degraded-notice')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy(); // language only
    expect(summary()).toBe('3 of 7 · filtered');
    expect(window.location.search).toBe('?scope=skills&group=skill&language=Go');
  });

  it('M41-FS-2: while LOADING ⇒ flat + N-L wording (data present, status gates); rerender to ready ⇒ grouped sections, pager gone, requested page=3 reconciled to 1 via replace', () => {
    window.history.replaceState(null, '', '/?group=skill&page=3');
    const repos = manyRepos();
    const lenBefore = window.history.length;
    // Data deliberately PRESENT while status says loading (M24-FS-3 pattern):
    // readiness, not data presence, must gate the grouped projection.
    const { rerender } = renderView(repos, {
      skillsClassification: manyClassification(),
      skillsStatus: 'loading',
    });
    expect(document.querySelector('.result-group')).toBeNull();
    expect(within(pagerEl()).getByText('Page 3 of 3')).toBeTruthy();
    expect(allTitles()).toHaveLength(4); // 100 − 96
    expect(
      screen.getByText(
        'Skills classification is still loading — grouped view will apply once it’s ready. Showing the list view meanwhile.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/is unavailable/)).toBeNull();
    expect(window.location.search).toBe('?group=skill&page=3');

    rerender(view(repos, manyReadyProps()));
    expect(groupNotice()).toBeNull();
    expect(pager()).toBeNull();
    expect(groups().map((g) => [g[0], g[2].length])).toEqual([
      ['security', 15],
      ['mcp-integrations', 15],
      ['verification-qa', 15],
      ['infra-runtime', 15],
    ]);
    expect(window.location.search).toBe('?group=skill'); // page converged to 1…
    expect(window.history.length).toBe(lenBefore); // …by replace, not push
  });

  it('M41-FS-3: ready + matches but none classified ⇒ E-G with Show as list (→ flat) and Clear filters (iff filters/query; keeps `group`, focuses the results heading)', () => {
    window.history.replaceState(null, '', '/?group=skill&q=plain');
    renderView(smallRepos(), readyProps());
    // the summary describes the actual result set; E-G carries the explanation
    expect(summary()).toBe('2 results for "plain"');
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'No classified repositories in this result set',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '2 matching repositories have no Skills classification, so grouped view has nothing to show.',
      ),
    ).toBeTruthy();
    expect(document.querySelector('.result-group')).toBeNull();
    expect(screen.queryByText('No matching repositories')).toBeNull(); // not the zero-results state
    expect(screen.getAllByRole('button', { name: 'Show as list' })).toHaveLength(1); // no duplicate
    expect(groupNotice()).toBeNull(); // ready: no degraded notice

    // Clear filters: reset() keeps `group` (D4) → the cleared state re-renders
    // grouped over the full classified set, focus on #results-heading.
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(window.location.search).toBe('?group=skill');
    expect(groups().map((g) => g[1])).toEqual([
      'Security · 1',
      'MCP integrations · 1',
      'Verification & QA · 2',
      'Infra & Runtime · 1',
    ]);
    expect(document.activeElement).toBe(document.getElementById('results-heading'));

    cleanup();
    // Show as list recovers the flat list of the same result set.
    window.history.replaceState(null, '', '/?group=skill&q=plain');
    renderView(smallRepos(), readyProps());
    fireEvent.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(window.location.search).toBe('?q=plain');
    expect(allTitles()).toEqual(['acme/plain-ts', 'acme/plain-go']);
    expect(summary()).toBe('2 results for "plain"');

    cleanup();
    // A singular exclusion reads singular.
    window.history.replaceState(null, '', '/?group=skill&q=plain-go');
    renderView(smallRepos(), readyProps());
    expect(
      screen.getByText(
        '1 matching repository has no Skills classification, so grouped view has nothing to show.',
      ),
    ).toBeTruthy();

    cleanup();
    // No filters and no query (a ready layer that classifies nothing in this
    // dataset): E-G still, but nothing to clear → no Clear filters button.
    window.history.replaceState(null, '', '/?group=skill');
    renderView(smallRepos(), {
      ...readyProps(),
      skillsClassification: makeSkillsClassification({}, { categories: CATEGORIES }),
    });
    expect(screen.getByText('No classified repositories in this result set')).toBeTruthy();
    expect(
      screen.getByText(
        '7 matching repositories have no Skills classification, so grouped view has nothing to show.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show as list' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(summary()).toBe('7 of 7 repositories');
  });

  it('M41-FS-4: ready + zero results ⇒ the existing NoResults, not E-G', () => {
    window.history.replaceState(null, '', '/?group=skill&q=zzz');
    renderView(smallRepos(), readyProps());
    expect(screen.getByText('No matching repositories')).toBeTruthy();
    expect(screen.queryByText(/No classified repositories/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show as list' })).toBeNull();
    expect(document.querySelector('.result-group')).toBeNull();
    expect(summary()).toBe('0 results for "zzz"');
    expect(groupSelect().value).toBe('skill'); // still requested; operable
    // Clear filters keeps group and returns to the grouped full set
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(window.location.search).toBe('?group=skill');
    expect(document.querySelectorAll('.result-group')).toHaveLength(4);
  });
});

describe('M4.1 pagination, headings, and filter-count invariance (§15.5, §15.8)', () => {
  it('M41-PAG-1: grouped mode renders EVERY classified card on one page (60 > 48), no pager, whole-group heading counts, ?page=3 rewritten to 1 via replace', () => {
    window.history.replaceState(null, '', '/?group=skill&page=3');
    const lenBefore = window.history.length;
    renderView(manyRepos(), manyReadyProps());
    expect(allTitles()).toHaveLength(60); // not 48, not 4 (page 3 of a flat slice)
    expect(pager()).toBeNull();
    expect(groups().map((g) => g[1])).toEqual([
      'Security · 15',
      'MCP integrations · 15',
      'Verification & QA · 15',
      'Infra & Runtime · 15',
    ]);
    expect(summary()).toBe(
      '60 classified repositories in 4 categories · 40 matching repositories without Skills classification are not shown',
    );
    expect(window.location.search).toBe('?group=skill');
    expect(window.history.length).toBe(lenBefore);
    // leaving grouped mode starts the flat list at page 1 (group is a reset field)
    setGroup('none');
    expect(window.location.search).toBe('');
    expect(allTitles()).toHaveLength(48);
    expect(within(pagerEl()).getByText('Page 1 of 3')).toBeTruthy();
  });

  it('M41-A11Y-1: h2 results → h3 labelled group sections ("{label} · {n}") → h4 cards; flat cards stay h3; chip removal still focuses #results-heading', () => {
    window.history.replaceState(null, '', '/?group=skill&language=Go');
    renderView(smallRepos(), readyProps());
    expect(screen.getByRole('heading', { level: 2, name: 'Starred repositories' })).toBeTruthy();
    const sections = screen.getAllByRole('region');
    // the results section itself + one labelled region per group
    expect(sections.map((s) => s.getAttribute('aria-labelledby'))).toEqual([
      'results-heading',
      'group-mcp-integrations',
      'group-verification-qa',
    ]);
    expect(
      within(screen.getByRole('region', { name: 'MCP integrations · 1' })).getByRole('heading', {
        level: 3,
        name: 'MCP integrations · 1',
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'MCP integrations · 1',
      'Verification & QA · 1',
    ]);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'acme/mcp-bridge',
      'acme/qa-zulu',
    ]);
    expect(document.querySelectorAll('h3.card-title')).toHaveLength(0);
    expect(document.querySelectorAll('h4.card-title')).toHaveLength(2);

    // removing the chip keeps the M1 focus contract and widens the groups
    fireEvent.click(screen.getByRole('button', { name: 'Language: Go — remove filter' }));
    expect(document.activeElement).toBe(document.getElementById('results-heading'));
    expect(document.querySelectorAll('.result-group')).toHaveLength(4);
    expect(window.location.search).toBe('?group=skill');

    // flat mode: unchanged hierarchy — h3 cards, no group headings
    setGroup('none');
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
    expect(document.querySelectorAll('h3.card-title')).toHaveLength(7);
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('M41-CNT-1: `group` never counts as a filter — activeFilterCount, "Filters N", chips and "· filtered" are identical with group=none and group=skill', () => {
    expect(activeFilterCount(parseDashboardState(new URLSearchParams('group=skill')))).toBe(0);
    expect(
      activeFilterCount(parseDashboardState(new URLSearchParams('group=skill&language=Go'))),
    ).toBe(activeFilterCount(parseDashboardState(new URLSearchParams('language=Go'))));

    window.history.replaceState(null, '', '/?language=Go');
    renderView(smallRepos(), readyProps());
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy();
    expect(screen.getByText('1 active filter')).toBeTruthy();
    expect(summary()).toBe('3 of 7 · filtered');

    setGroup('skill');
    expect(window.location.search).toBe('?group=skill&language=Go');
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy(); // not 2
    expect(screen.getByText('1 active filter')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Active filters' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Language: Go× — remove filter', 'Clear all']); // no Group chip
    expect(summary()).toContain('· filtered');

    // Clear all (chips) clears the filter and keeps group — no chips remain,
    // "Filters" has no count, and the summary carries no "· filtered".
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(window.location.search).toBe('?group=skill');
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull();
    expect(summary()).toBe(
      '5 classified repositories in 4 categories · 2 matching repositories without Skills classification are not shown',
    );
  });
});
