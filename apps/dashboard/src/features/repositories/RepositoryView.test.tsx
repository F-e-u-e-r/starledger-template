// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDashboardState } from '../../state/use-dashboard-state';
import { makeAnnotation, makeAnnotations, makeRepo } from '../../test-utils';
import { RepositoryView } from './RepositoryView';

const NOW = new Date('2026-06-19T00:00:00Z');

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

/** Provides the App-owned canonical-state controls so the view can be tested
 *  standalone (App lifts the single `useDashboardState` instance in production). */
function Harness(props: Omit<ComponentProps<typeof RepositoryView>, 'controls'>) {
  const controls = useDashboardState();
  return <RepositoryView {...props} controls={controls} />;
}

function renderView(
  repos = sampleRepos(),
  extra: Partial<Omit<ComponentProps<typeof RepositoryView>, 'controls' | 'repos'>> = {},
) {
  return render(
    <Harness repos={repos} datasetGeneratedAt="2026-06-18T00:00:00Z" initialNow={NOW} {...extra} />,
  );
}

function sampleRepos() {
  return [
    makeRepo({
      node_id: 'R_ts',
      name_with_owner: 'acme/ts-tool',
      url: 'https://github.com/acme/ts-tool',
      description: 'A telegram client',
      primary_language: 'TypeScript',
      topics: ['cli'],
      stargazer_count: 10,
    }),
    makeRepo({
      node_id: 'R_go',
      name_with_owner: 'acme/go-tool',
      url: 'https://github.com/acme/go-tool',
      primary_language: 'Go',
      topics: ['automation'],
      stargazer_count: 20,
    }),
  ];
}

const search = () => screen.getByRole('searchbox', { name: 'Search repositories' });
const titles = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('RepositoryView', () => {
  it('renders the result count and repository links (CARD-3)', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'StarLedger' })).toBeTruthy();
    expect(screen.getByText(/Last synced 1 day ago/)).toBeTruthy();
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'acme/ts-tool' });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/ts-tool');
  });

  it('SEARCH: narrows results and reflects the query in the URL (replaceState)', () => {
    renderView();
    fireEvent.change(search(), { target: { value: 'telegram' } });
    expect(screen.getByText('1 result for "telegram"')).toBeTruthy();
    expect(titles()).toEqual(['acme/ts-tool']);
    expect(window.location.search).toBe('?q=telegram');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((search() as HTMLInputElement).value).toBe('');
    expect(window.location.search).toBe('');
  });

  it('FACET-1/2: a language facet filters; its chip removes only that filter', () => {
    renderView();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Go' }));
    expect(titles()).toEqual(['acme/go-tool']);
    expect(window.location.search).toBe('?language=Go');
    // one-line result summary + section shows selected count, not option count
    expect(screen.getByText('1 of 2 · filtered')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Language 1 selected/ })).toBeTruthy();

    const chip = screen.getByRole('button', { name: /Language: Go — remove filter/ });
    fireEvent.click(chip);
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
    expect(window.location.search).toBe('');
    // focus is handed to the results heading, not dropped to <body> (A11Y-4)
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Starred repositories' }),
    );
  });

  it('FACET-3: clear-all returns to the default state', () => {
    renderView();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Go' }));
    fireEvent.change(search(), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
    expect((search() as HTMLInputElement).value).toBe('');
    expect(window.location.search).toBe('');
  });

  it('RESULT-2: no matches show the no-results state, not the empty-dataset state', () => {
    renderView();
    fireEvent.change(search(), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('0 results for "zzz-no-match"')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No matching repositories' })).toBeTruthy();
    expect(screen.queryByText('No starred repositories yet.')).toBeNull();
    // the no-results "Clear filters" action restores the dataset
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
  });

  it('SORT: changing field/direction reorders results and updates the URL', () => {
    renderView();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'stargazer_count' },
    });
    // default direction desc → higher stars first
    expect(titles()).toEqual(['acme/go-tool', 'acme/ts-tool']);
    fireEvent.click(screen.getByRole('button', { name: /sort direction/i }));
    expect(titles()).toEqual(['acme/ts-tool', 'acme/go-tool']);
    expect(window.location.search).toBe('?sort=stargazer_count&direction=asc');
  });

  it('restores state from the initial URL (reload / shared link)', () => {
    window.history.replaceState(null, '', '/?language=Go');
    renderView();
    expect(titles()).toEqual(['acme/go-tool']);
    expect((screen.getByRole('checkbox', { name: 'Go' }) as HTMLInputElement).checked).toBe(true);
  });

  it('A11Y: search, sort and direction controls have accessible names', () => {
    renderView();
    expect(search()).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Sort' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sort direction/i })).toBeTruthy();
  });

  it('keeps long filter sections collapsed until requested', () => {
    renderView();
    expect(screen.queryByRole('checkbox', { name: 'automation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Topics 2 options/ }));
    expect(screen.getByRole('checkbox', { name: 'automation' })).toBeTruthy();
  });

  it('opens the mobile filter drawer without replacing the desktop filter contract', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(dialog).getByRole('button', { name: /Language 2 options/ })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close filters' }));
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    // A11Y-5: closing the drawer returns focus to the toggle, not to <body>.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters' }));
  });

  it('hides the Data status facet until the dataset has degraded repositories', () => {
    const { rerender } = renderView(); // sample repos all hydrate OK
    expect(screen.queryByRole('button', { name: /Data status/ })).toBeNull();

    rerender(
      <Harness
        repos={[
          makeRepo({
            node_id: 'R_partial',
            name_with_owner: 'a/partial',
            url: 'https://github.com/a/partial',
            hydration_status: 'partial',
            pushed_at: null,
            unavailable_fields: ['pushed_at'],
          }),
        ]}
        datasetGeneratedAt="2026-06-18T00:00:00Z"
        initialNow={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /Data status/ })).toBeTruthy();
  });

  const staleRepos = () => [
    makeRepo({
      node_id: 'R_old',
      name_with_owner: 'a/old',
      url: 'https://github.com/a/old',
      pushed_at: '2024-01-01T00:00:00Z',
    }),
    makeRepo({
      node_id: 'R_new',
      name_with_owner: 'a/new',
      url: 'https://github.com/a/new',
      pushed_at: '2026-06-01T00:00:00Z',
    }),
  ];
  const staleYes = () =>
    within(screen.getByRole('group', { name: 'Stale' })).getByRole('radio', { name: 'Yes' });

  it('TIME-1: stale membership uses the mounted clock and is stable across other changes', () => {
    renderView(staleRepos()); // 2026-06-19
    fireEvent.click(staleYes());
    expect(titles()).toEqual(['a/old']); // only the >12-months-old repo is stale at NOW
    fireEvent.click(screen.getByRole('button', { name: /sort direction/i }));
    expect(titles()).toEqual(['a/old']); // an unrelated control did not move the clock
  });

  it('TIME-2: a newer mount clock re-evaluates staleness', () => {
    renderView(staleRepos(), { initialNow: new Date('2030-01-01T00:00:00Z') });
    fireEvent.click(staleYes());
    expect(titles().sort()).toEqual(['a/new', 'a/old']); // both are stale relative to 2030
  });

  it('M0-FS-4: a bookmarked AI filter is inactive when AI is unavailable — base preserved + degraded surfaced', () => {
    window.history.replaceState(null, '', '/?category=security');
    renderView(); // no annotations → AI layer unavailable
    // base entities preserved (never blanked to zero)
    expect(titles().sort()).toEqual(['acme/go-tool', 'acme/ts-tool']);
    // not counted as an effective filter (no "· filtered")
    expect(screen.getByText('2 of 2 repositories')).toBeTruthy();
    // degraded state explicitly surfaced
    expect(screen.getByText(/AI classification is unavailable/)).toBeTruthy();
    // and the filter is retained in the URL for recoverability
    expect(window.location.search).toBe('?category=security');
  });

  it('M0-SORT-2: selecting Name resets direction to ascending (A→Z), not an inherited desc', () => {
    renderView();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'name_with_owner' },
    });
    expect(titles()).toEqual(['acme/go-tool', 'acme/ts-tool']); // A→Z
    // R1 (§6.1): asc IS defaultDirection('name_with_owner'), so `direction` is
    // omitted from the canonical URL as redundant; it decodes back to asc.
    expect(window.location.search).toBe('?sort=name_with_owner');
  });

  it('M0-FS-5: AI unavailable suppresses only the AI filter — a canonical filter still applies, base preserved, degraded surfaced', () => {
    window.history.replaceState(null, '', '/?language=Go&category=security');
    renderView(); // no annotations → AI layer unavailable
    // the canonical (language) filter STILL applies — neutralization is scoped to AI-dependent filters only
    expect(titles()).toEqual(['acme/go-tool']);
    // language is an effective filter, so the summary reflects filtering (1 of 2)
    expect(screen.getByText('1 of 2 · filtered')).toBeTruthy();
    // the AI category filter is suppressed, and its degraded state is surfaced
    expect(screen.getByText(/AI classification is unavailable/)).toBeTruthy();
    // both requested filters are retained in the URL (intent preserved for recovery)
    expect(window.location.search).toBe('?language=Go&category=security');
  });

  it('M0-FS-6: while AI is LOADING, the AI filter is held inactive with loading-specific wording (not "unavailable")', () => {
    window.history.replaceState(null, '', '/?category=security');
    renderView(sampleRepos(), { annotationStatus: 'loading' });
    // base repos preserved during the load window (filter held, not applied)
    expect(titles().sort()).toEqual(['acme/go-tool', 'acme/ts-tool']);
    // loading is distinct from terminal failure: "still loading" copy, NOT "unavailable"
    expect(screen.getByText(/still loading/)).toBeTruthy();
    expect(screen.queryByText(/AI classification is unavailable/)).toBeNull();
  });
});

function manyRepos(n: number) {
  return Array.from({ length: n }, (_, i) =>
    makeRepo({
      node_id: `R_${i}`,
      name_with_owner: `acme/tool-${String(i).padStart(3, '0')}`,
      url: `https://github.com/acme/tool-${i}`,
      stargazer_count: n - i,
    }),
  );
}

const pager = () => screen.getByRole('navigation', { name: 'Pagination' });

describe('RepositoryView — pagination (§6.2)', () => {
  it('PAGE-1: slices at 48/page with a working Prev/Next pager', () => {
    renderView(manyRepos(50));
    expect(screen.getAllByRole('link')).toHaveLength(48);
    expect(within(pager()).getByText('Page 1 of 2')).toBeTruthy();
    expect(
      within(pager())
        .getByRole('button', { name: /Previous/ })
        .getAttribute('aria-disabled'),
    ).toBe('true');

    fireEvent.click(within(pager()).getByRole('button', { name: /Next/ }));
    expect(screen.getAllByRole('link')).toHaveLength(2); // 50 − 48
    expect(within(pager()).getByText('Page 2 of 2')).toBeTruthy();
    expect(window.location.search).toBe('?page=2');
    expect(
      within(pager()).getByRole('button', { name: /Next/ }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('PAGE-2: no pager when results fit a single page', () => {
    renderView(manyRepos(10));
    expect(screen.getAllByRole('link')).toHaveLength(10);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('PAGE-3: an out-of-range ?page reconciles to the last page via replaceState (no history push)', () => {
    window.history.replaceState(null, '', '/?page=999');
    const lenBefore = window.history.length;
    renderView(manyRepos(50));
    expect(within(pager()).getByText('Page 2 of 2')).toBeTruthy(); // clamped to the last page
    expect(window.location.search).toBe('?page=2'); // URL canonicalized to the effective page
    expect(window.history.length).toBe(lenBefore); // replace, not push
  });

  it('PAGE-4: a search (semantic change) resets pagination to page 1', () => {
    renderView(manyRepos(50));
    fireEvent.click(within(pager()).getByRole('button', { name: /Next/ }));
    expect(window.location.search).toBe('?page=2');
    fireEvent.change(search(), { target: { value: 'tool' } }); // matches all 50
    expect(window.location.search).toBe('?q=tool'); // page dropped by the reset
    expect(within(pager()).getByText('Page 1 of 2')).toBeTruthy();
  });

  it('PAGE-5 (F3): a boundary control uses aria-disabled (not `disabled`) and is a no-op, so focus is never stranded', () => {
    renderView(manyRepos(50));
    fireEvent.click(within(pager()).getByRole('button', { name: /Next/ })); // → page 2 (last)
    const next = within(pager()).getByRole('button', { name: /Next/ });
    expect((next as HTMLButtonElement).disabled).toBe(false); // still focusable (not natively disabled)
    expect(next.getAttribute('aria-disabled')).toBe('true'); // state conveyed to AT
    fireEvent.click(next); // guarded no-op at the boundary
    expect(window.location.search).toBe('?page=2'); // unchanged — no phantom page 3
  });
});

describe('RepositoryView — R3 effective-filter badge (§13, M1.2a)', () => {
  it('R3-unavailable: an AI-only filter with the AI layer unavailable does not inflate the badge', () => {
    window.history.replaceState(null, '', '/?category=security');
    renderView(); // no annotations → AI unavailable
    // badge shows NO count (the requested-but-inactive AI filter is not counted)
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Filters \d/ })).toBeNull();
    // still surfaced as a degraded notice (recoverability preserved)
    expect(screen.getByText(/AI classification is unavailable/)).toBeTruthy();
  });

  it('R3-mixed: with AI unavailable, the badge counts only the effective (canonical) filter', () => {
    window.history.replaceState(null, '', '/?language=Go&category=security');
    renderView(); // AI unavailable
    // language is effective (1); the suppressed AI category is not added → "Filters 1", not 2
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy();
  });

  it('R3-ready: once the AI layer is ready, the activated AI filter is counted', () => {
    window.history.replaceState(null, '', '/?category=security');
    renderView(sampleRepos(), {
      annotations: makeAnnotations({ R_ts: makeAnnotation({ category: 'security' }) }),
    });
    // AI ready → the category filter activates → counted
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy();
  });

  it('R3-loading: while the AI layer is loading, its requested filter is not counted', () => {
    window.history.replaceState(null, '', '/?category=security');
    renderView(sampleRepos(), { annotationStatus: 'loading' });
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Filters \d/ })).toBeNull();
  });
});

describe('RepositoryView — density control (§13, M1.2b)', () => {
  const densitySelect = () => screen.getByRole('combobox', { name: 'Density' });
  const dashboardMain = () => screen.getByRole('main');

  it('DENS-1: compact is the default — control reflects it, presentation class applied, URL stays canonical-empty', () => {
    renderView();
    expect((densitySelect() as HTMLSelectElement).value).toBe('compact');
    expect(dashboardMain().className).toBe('dashboard density-compact');
    expect(window.location.search).toBe('');
  });

  it('DENS-2: the control writes only canonical density — comfortable enters the URL, the compact default is omitted', () => {
    renderView();
    fireEvent.change(densitySelect(), { target: { value: 'comfortable' } });
    expect(window.location.search).toBe('?density=comfortable');
    expect(dashboardMain().className).toBe('dashboard density-comfortable');

    fireEvent.change(densitySelect(), { target: { value: 'compact' } });
    expect(window.location.search).toBe(''); // default omitted — canonical round-trip
    expect(dashboardMain().className).toBe('dashboard density-compact');
  });

  it('DENS-3: a density change preserves the current page (§6.3 density exemption at the UI level)', () => {
    renderView(manyRepos(50));
    fireEvent.click(within(pager()).getByRole('button', { name: /Next/ }));
    expect(window.location.search).toBe('?page=2');

    fireEvent.change(densitySelect(), { target: { value: 'comfortable' } });
    expect(window.location.search).toBe('?density=comfortable&page=2'); // page NOT reset
    expect(within(pager()).getByText('Page 2 of 2')).toBeTruthy();
  });

  it('DENS-4: a bookmarked/reloaded ?density=comfortable reproduces the comfortable presentation', () => {
    window.history.replaceState(null, '', '/?density=comfortable');
    renderView();
    expect((densitySelect() as HTMLSelectElement).value).toBe('comfortable');
    expect(dashboardMain().className).toBe('dashboard density-comfortable');
  });

  it('DENS-5: repository links and toolbar actions survive both densities', () => {
    renderView();
    for (const density of ['comfortable', 'compact'] as const) {
      fireEvent.change(densitySelect(), { target: { value: density } });
      const link = screen.getByRole('link', { name: 'acme/ts-tool' });
      expect(link.getAttribute('href')).toBe('https://github.com/acme/ts-tool');
      expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: 'Sort' })).toBeTruthy();
    }
  });
});

describe('RepositoryView — sticky toolbar (§13, M1.2c)', () => {
  const toolbar = () => document.querySelector('.toolbar') as HTMLElement;
  const setScrollY = (value: number) =>
    Object.defineProperty(window, 'scrollY', { value, configurable: true, writable: true });

  afterEach(() => setScrollY(0));

  it('STICK-1: the toolbar is a direct child of the dashboard main and starts without is-scrolled', () => {
    renderView();
    const main = screen.getByRole('main');
    // position:sticky is constrained to the parent's box — re-nesting the
    // toolbar into the short .dashboard-head would silently un-stick it, which
    // jsdom cannot observe; this structural pin makes that regression visible.
    expect(main.querySelector(':scope > .toolbar')).toBe(toolbar());
    expect(toolbar().className).toBe('toolbar');
  });

  it('STICK-2: scrolling toggles the ephemeral is-scrolled presentation flag', () => {
    renderView();
    setScrollY(120);
    fireEvent.scroll(window);
    expect(toolbar().className).toBe('toolbar is-scrolled');
    setScrollY(0);
    fireEvent.scroll(window);
    expect(toolbar().className).toBe('toolbar');
  });

  it('STICK-3: while stuck, toolbar controls still write canonical state (no second owner)', () => {
    renderView();
    setScrollY(120);
    fireEvent.scroll(window);
    fireEvent.change(screen.getByRole('combobox', { name: 'Density' }), {
      target: { value: 'comfortable' },
    });
    expect(window.location.search).toBe('?density=comfortable');
    expect(toolbar().className).toBe('toolbar is-scrolled');
  });

  it('STICK-4: the toolbar height is published as --toolbar-h for the sidebar clearance (PR #239 R1-1)', () => {
    renderView();
    const main = screen.getByRole('main') as HTMLElement;
    // jsdom has no layout (offsetHeight = 0) and no ResizeObserver — the pin is
    // the WIRING (the variable is published on mount); the actual clearance
    // geometry is browser-verified in the review-round smoke.
    expect(main.style.getPropertyValue('--toolbar-h')).toBe('0px');
  });
});

describe('RepositoryView — facet scroll (§13, M1.2d)', () => {
  const langRepos = () =>
    Array.from({ length: 15 }, (_, i) =>
      makeRepo({
        node_id: `R_lang${i}`,
        name_with_owner: `acme/lang-${i}`,
        url: `https://github.com/acme/lang-${i}`,
        primary_language: `Alpha${String(i + 1).padStart(2, '0')}`,
        topics: [
          `topic-${String(i + 1).padStart(2, '0')}`,
          `extra-${String(i + 1).padStart(2, '0')}`,
        ],
      }),
    );

  const languageGroup = () => screen.getByRole('group', { name: 'Language' });
  const optionsBox = (group: HTMLElement) => group.querySelector('.facet-options') as HTMLElement;

  it('FSCROLL-1: expanding a long facet applies the bounded-scroll class; the collapsed default is unbounded', () => {
    renderView(langRepos());
    const group = languageGroup();
    expect(within(group).getAllByRole('checkbox')).toHaveLength(10);
    expect(optionsBox(group).className).toBe('facet-options');
    fireEvent.click(within(group).getByRole('button', { name: 'Show 5 more' }));
    expect(within(group).getAllByRole('checkbox')).toHaveLength(15);
    // the bound rides on this class (max-height + overflow-y in CSS; the
    // actual scrolling is browser-verified — jsdom does no layout)
    expect(optionsBox(group).className).toBe('facet-options facet-options--scroll');
  });

  it('FSCROLL-2: the searchable topics facet always carries the bounded-scroll class', () => {
    renderView(langRepos());
    fireEvent.click(screen.getByRole('button', { name: /Topics/ })); // section is collapsed by default
    const topicsGroup = screen.getByRole('group', { name: 'Topics' });
    expect(optionsBox(topicsGroup).className).toBe('facet-options facet-options--scroll');
  });

  it('FSCROLL-3: a selected value beyond the collapsed limit stays visible (selected-overflow reachability)', () => {
    window.history.replaceState(null, '', '/?language=Alpha15');
    renderView(langRepos());
    const group = languageGroup();
    expect(within(group).getByRole('button', { name: /Show \d+ more/ })).toBeTruthy(); // still collapsed
    const box = within(group).getByRole('checkbox', { name: 'Alpha15' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('TCOL-4: toggling a card topics affordance is LOCAL presentation state — the URL never changes (§13 M1.2e)', () => {
    renderView([
      makeRepo({
        node_id: 'R_many',
        name_with_owner: 'acme/many-topics',
        url: 'https://github.com/acme/many-topics',
        topics: ['one', 'two', 'three', 'four', 'five', 'six'],
      }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(window.location.search).toBe('');
  });

  it('FSCROLL-4: a COLLAPSED facet inflated past the budget by selected-overflow rows is bounded too', () => {
    // R1 xcheck finding (sol): bounding keyed on `showAll` alone missed lists
    // grown long while collapsed — reachable via URL preselection (this test),
    // drawer-instance selections, or a section collapse/reopen resetting
    // `showAll`. The bound must ride on rendered length.
    window.history.replaceState(
      null,
      '',
      '/?language=Alpha11&language=Alpha12&language=Alpha13&language=Alpha14&language=Alpha15',
    );
    renderView(langRepos());
    const group = languageGroup();
    expect(within(group).getAllByRole('checkbox')).toHaveLength(15); // 10 default + 5 overflow
    expect(optionsBox(group).className).toBe('facet-options facet-options--scroll');
  });
});

describe('RepositoryView — M1.2f integrated closure (§13)', () => {
  // 120 repos, two languages (Go = 60 → two 48-pages when filtered), six shared
  // topics — enough surface to combine filters, pagination, density, R3 and
  // topic collapse in one canonical state.
  const intRepos = (n = 120) =>
    Array.from({ length: n }, (_, i) =>
      makeRepo({
        node_id: `R_int${i}`,
        name_with_owner: `acme/int-${String(i).padStart(3, '0')}`,
        url: `https://github.com/acme/int-${i}`,
        primary_language: i % 2 === 0 ? 'Go' : 'Rust',
        topics: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
        stargazer_count: n - i,
      }),
    );

  const densitySelect = () => screen.getByRole('combobox', { name: 'Density' });

  it('INT-1: a fully combined bookmark reproduces every axis at once (R3 × density × filter × page)', () => {
    window.history.replaceState(
      null,
      '',
      '/?language=Go&category=security&density=comfortable&page=2',
    );
    renderView(intRepos()); // AI unavailable → the category filter is suppressed
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy(); // language only (R3)
    expect(screen.getByText(/AI classification is unavailable/)).toBeTruthy();
    expect((densitySelect() as HTMLSelectElement).value).toBe('comfortable');
    expect(screen.getByRole('main').className).toBe('dashboard density-comfortable');
    expect(within(pager()).getByText('Page 2 of 2')).toBeTruthy(); // 60 Go → 48 + 12
    expect(window.location.search).toBe(
      '?language=Go&category=security&density=comfortable&page=2',
    );
  });

  it('INT-2: AI becoming ready activates the filter, re-counts the badge, and reconciles the page — density survives', () => {
    window.history.replaceState(
      null,
      '',
      '/?language=Go&category=security&density=comfortable&page=2',
    );
    const repos = intRepos();
    const { rerender } = renderView(repos, { annotationStatus: 'loading' });
    // loading suppresses ONLY the AI facet — the language filter still counts,
    // and the requested page SURVIVES the loading phase (60 Go results → 2 pages):
    expect(screen.getByRole('button', { name: 'Filters 1' })).toBeTruthy();
    expect(within(pager()).getByText('Page 2 of 2')).toBeTruthy();
    expect(window.location.search).toBe(
      '?language=Go&category=security&density=comfortable&page=2',
    );

    rerender(
      <Harness
        repos={repos}
        datasetGeneratedAt="2026-06-18T00:00:00Z"
        initialNow={NOW}
        annotations={makeAnnotations({ R_int0: makeAnnotation({ category: 'security' }) })}
      />,
    );
    // ready: the category filter activates → exactly the annotated Go repo
    // remains (the join is proven by the result set, not just the badge) → the
    // requested page 2 reconciles to 1 (dropped from the URL as the default),
    // density persists.
    expect(screen.getByRole('button', { name: 'Filters 2' })).toBeTruthy();
    expect(screen.getByText('1 of 120 · filtered')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'acme/int-000' })).toBeTruthy();
    expect(window.location.search).toBe('?language=Go&category=security&density=comfortable');
    expect(screen.getByRole('main').className).toBe('dashboard density-comfortable');
  });

  it('INT-3: while the toolbar is stuck, density preserves the LIVE page and a sort change resets it (§6.3)', () => {
    renderView(intRepos());
    // Re-query on every assertion: a rerender may replace the node, and a
    // detached reference would false-pass (R1 xcheck finding).
    const toolbar = () => document.querySelector('.toolbar') as HTMLElement;
    fireEvent.click(within(pager()).getByRole('button', { name: /Next/ }));
    expect(window.location.search).toBe('?page=2');

    Object.defineProperty(window, 'scrollY', { value: 200, configurable: true, writable: true });
    fireEvent.scroll(window);
    expect(toolbar().className).toBe('toolbar is-scrolled');

    // density FIRST, while page=2 is live — the §6.3 exemption is proven, not
    // asserted after the page was already reset (R1 xcheck finding):
    fireEvent.change(densitySelect(), { target: { value: 'comfortable' } });
    expect(window.location.search).toBe('?density=comfortable&page=2');
    expect(toolbar().className).toBe('toolbar is-scrolled');

    // then a semantic change resets the page and keeps density:
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'stargazer_count' },
    });
    expect(window.location.search).toBe('?sort=stargazer_count&density=comfortable');
    expect(within(pager()).getByText(/Page 1 of/)).toBeTruthy();
    expect(toolbar().className).toBe('toolbar is-scrolled'); // presentation flag undisturbed
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  });

  // 17 distinct topics across the dataset (common + top00..top15) → the topics
  // facet offers Show-more; shared by INT-4 and INT-6.
  const topicPoolRepos = () =>
    Array.from({ length: 16 }, (_, i) =>
      makeRepo({
        node_id: `R_t${i}`,
        name_with_owner: `acme/t-${String(i).padStart(2, '0')}`,
        url: `https://github.com/acme/t-${i}`,
        topics: ['common', `top${String(i).padStart(2, '0')}`],
      }),
    );

  it('INT-4: a fully EXPANDED bounded facet keeps its class and its expansion across a density switch', () => {
    renderView(topicPoolRepos());
    fireEvent.click(screen.getByRole('button', { name: /Topics/ }));
    // Re-query past rerenders — a stale fieldset reference would false-pass
    // against a detached node (R1 xcheck finding).
    const topicsGroup = () => screen.getByRole('group', { name: 'Topics' });
    const box = () => topicsGroup().querySelector('.facet-options') as HTMLElement;
    fireEvent.click(within(topicsGroup()).getByRole('button', { name: /Show \d+ more/ }));
    expect(within(topicsGroup()).getAllByRole('checkbox')).toHaveLength(17); // truly expanded
    expect(box().className).toBe('facet-options facet-options--scroll');

    fireEvent.change(densitySelect(), { target: { value: 'comfortable' } });
    expect(within(topicsGroup()).getAllByRole('checkbox')).toHaveLength(17); // expansion survives
    expect(box().className).toBe('facet-options facet-options--scroll');
    expect(window.location.search).toBe('?density=comfortable');
  });

  it('INT-5: a card topic toggle is inert to a fully populated canonical URL', () => {
    window.history.replaceState(null, '', '/?topic=zeta&density=comfortable&page=2');
    renderView(intRepos()); // zeta matches all 120 → 3 pages; page 2 valid
    const canonical = '?topic=zeta&density=comfortable&page=2';
    expect(window.location.search).toBe(canonical);

    // selected-first: zeta visible on a collapsed card
    const firstCard = document.querySelector('.card') as HTMLElement;
    const topics = Array.from(firstCard.querySelectorAll('.topic:not(.topic-more)')).map(
      (t) => t.textContent,
    );
    expect(topics[0]).toBe('zeta');

    fireEvent.click(within(firstCard).getByRole('button', { name: '+2' }));
    expect(window.location.search).toBe(canonical); // local toggle leaks nothing
    fireEvent.click(within(firstCard).getByRole('button', { name: 'Show fewer' }));
    expect(window.location.search).toBe(canonical);
  });

  it('INT-6: the topics facet keeps a bookmarked beyond-limit selection visible while collapsed (its own selected-overflow path)', () => {
    window.history.replaceState(null, '', '/?topic=top15');
    renderView(topicPoolRepos());
    fireEvent.click(screen.getByRole('button', { name: /Topics/ }));
    const topicsGroup = screen.getByRole('group', { name: 'Topics' });
    // Lexicographic facet order: 'common', top00..top15 → top15 is 17th, well
    // beyond the 12-row collapsed budget; TopicFacet's OWN selected-overflow
    // path (distinct from the generic CheckboxFacet's) must keep it visible.
    const selected = within(topicsGroup).getByRole('checkbox', {
      name: 'top15',
    }) as HTMLInputElement;
    expect(selected.checked).toBe(true);
    expect(within(topicsGroup).getByRole('button', { name: /Show \d+ more/ })).toBeTruthy(); // still collapsed
    expect(within(topicsGroup).getAllByRole('checkbox')).toHaveLength(13); // 12 + the selected overflow row
  });
});
