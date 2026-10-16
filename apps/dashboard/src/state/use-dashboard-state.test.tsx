// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDashboardState } from './use-dashboard-state';

function Harness() {
  const { state, update, reset } = useDashboardState();
  return (
    <div>
      <span data-testid="q">{state.query}</span>
      <span data-testid="langs">{state.languages.join(',')}</span>
      <button onClick={() => update({ query: 'abc' }, 'replace')}>type</button>
      <button onClick={() => update({ languages: ['Go'] })}>addGo</button>
      <button onClick={() => update({ languages: ['TypeScript', 'Go', 'Go'] })}>messy</button>
      <button onClick={() => reset()}>reset</button>
    </div>
  );
}

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

describe('useDashboardState', () => {
  it('initializes from the URL (reload / shared link)', () => {
    window.history.replaceState(null, '', '/?q=hello&language=Go');
    render(<Harness />);
    expect(screen.getByTestId('q').textContent).toBe('hello');
    expect(screen.getByTestId('langs').textContent).toBe('Go');
  });

  it('writes updates back to the URL', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('type'));
    expect(window.location.search).toBe('?q=abc');
    fireEvent.click(screen.getByText('addGo'));
    expect(window.location.search).toBe('?q=abc&language=Go');
  });

  it('uses replaceState for typing and pushState for discrete actions', () => {
    render(<Harness />);
    const len0 = window.history.length;
    fireEvent.click(screen.getByText('type')); // replace → no new entry
    expect(window.history.length).toBe(len0);
    fireEvent.click(screen.getByText('addGo')); // push → one new entry
    expect(window.history.length).toBe(len0 + 1);
  });

  it('keeps the in-memory state canonical (dedupe + sort), matching the URL', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('messy'));
    expect(screen.getByTestId('langs').textContent).toBe('Go,TypeScript'); // not 'TypeScript,Go,Go'
    expect(window.location.search).toBe('?language=Go&language=TypeScript');
  });

  it('restores state on popstate (back/forward)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('addGo'));
    expect(screen.getByTestId('langs').textContent).toBe('Go');
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('langs').textContent).toBe('');
  });
});

function ResetHarness() {
  const { state, update, reset } = useDashboardState();
  return (
    <div>
      <span data-testid="page">{state.page}</span>
      <span data-testid="density">{state.density}</span>
      <span data-testid="view">{state.view}</span>
      <button onClick={() => update({ page: 3 })}>goPage3</button>
      <button onClick={() => update({ query: 'x' })}>changeQuery</button>
      <button onClick={() => update({ sort: state.sort })}>sortNoop</button>
      <button onClick={() => update({ density: 'comfortable' })}>changeDensity</button>
      <button onClick={() => update({ view: 'discovery' })}>toDiscovery</button>
      <button onClick={() => update({ languages: ['Go'] })}>addGo</button>
      <button onClick={() => update({ languages: ['Go'], page: 5 })}>filterAndPage</button>
      <button onClick={() => reset()}>clearAll</button>
    </div>
  );
}

describe('useDashboardState — page reset semantics (§6.3)', () => {
  const page = () => screen.getByTestId('page').textContent;

  it('resets page → 1 on a semantic change to a filter field', () => {
    render(<ResetHarness />);
    fireEvent.click(screen.getByText('goPage3'));
    expect(page()).toBe('3');
    fireEvent.click(screen.getByText('addGo'));
    expect(page()).toBe('1');
    expect(window.location.search).toBe('?language=Go'); // page dropped
  });

  it('resets page → 1 when the query changes', () => {
    render(<ResetHarness />);
    fireEvent.click(screen.getByText('goPage3'));
    fireEvent.click(screen.getByText('changeQuery'));
    expect(page()).toBe('1');
  });

  it('does NOT reset page on a no-op update (same value) — key presence alone must not reset', () => {
    render(<ResetHarness />);
    fireEvent.click(screen.getByText('goPage3'));
    fireEvent.click(screen.getByText('sortNoop'));
    expect(page()).toBe('3');
  });

  it('does NOT reset page when density changes', () => {
    render(<ResetHarness />);
    fireEvent.click(screen.getByText('goPage3'));
    fireEvent.click(screen.getByText('changeDensity'));
    expect(page()).toBe('3');
    expect(screen.getByTestId('density').textContent).toBe('comfortable');
  });

  it('an explicit page in the same update wins over the implicit reset', () => {
    render(<ResetHarness />);
    fireEvent.click(screen.getByText('filterAndPage'));
    expect(page()).toBe('5'); // not reset to 1
    expect(window.location.search).toBe('?language=Go&page=5');
  });

  it('reset (clear-all) clears filters/search/sort + page but PRESERVES view and density', () => {
    render(<ResetHarness />);
    fireEvent.click(screen.getByText('toDiscovery')); // view = discovery
    fireEvent.click(screen.getByText('changeDensity')); // density = comfortable
    fireEvent.click(screen.getByText('addGo')); // a filter
    fireEvent.click(screen.getByText('clearAll')); // reset()
    expect(screen.getByTestId('view').textContent).toBe('discovery'); // preserved
    expect(screen.getByTestId('density').textContent).toBe('comfortable'); // preserved
    // filters/search/sort cleared; only the preserved display/nav fields remain
    expect(window.location.search).toBe('?view=discovery&density=comfortable');
  });
});

function GroupHarness() {
  const { state, update, reset } = useDashboardState();
  return (
    <div>
      <span data-testid="page">{state.page}</span>
      <span data-testid="group">{state.group}</span>
      <span data-testid="scope">{state.scope}</span>
      <span data-testid="skills">{state.skillCategories.join(',')}</span>
      <button onClick={() => update({ page: 3 })}>goPage3</button>
      <button onClick={() => update({ group: 'skill' })}>groupSkill</button>
      <button onClick={() => update({ group: 'none' })}>groupNone</button>
      <button onClick={() => update({ group: state.group })}>groupNoop</button>
      <button onClick={() => update({ group: 'skill', page: 4 })}>groupAndPage</button>
      <button onClick={() => update({ density: 'comfortable' })}>changeDensity</button>
      <button onClick={() => update({ view: 'discovery' })}>toDiscovery</button>
      <button onClick={() => update({ scope: 'skills', skillCategories: ['design-ui'] })}>
        skillsFilters
      </button>
      <button onClick={() => update({ languages: ['Go'] })}>addGo</button>
      <button onClick={() => reset()}>clearAll</button>
    </div>
  );
}

describe('useDashboardState — M4.1 `group` (§15.3 page reset + D4 clear-all)', () => {
  const page = () => screen.getByTestId('page').textContent;
  const group = () => screen.getByTestId('group').textContent;

  it('M41-RST-1: a genuine group change resets page → 1; a no-op does not; explicit page wins', () => {
    render(<GroupHarness />);
    fireEvent.click(screen.getByText('goPage3'));
    expect(page()).toBe('3');
    fireEvent.click(screen.getByText('groupNoop')); // same value: key presence alone never resets
    expect(page()).toBe('3');
    fireEvent.click(screen.getByText('groupSkill')); // none → skill: semantic change
    expect(page()).toBe('1');
    expect(group()).toBe('skill');
    expect(window.location.search).toBe('?group=skill'); // page dropped, group emitted
    fireEvent.click(screen.getByText('goPage3'));
    fireEvent.click(screen.getByText('groupNone')); // skill → none: also a semantic change
    expect(page()).toBe('1');
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByText('groupAndPage')); // explicit page in the same update wins
    expect(page()).toBe('4');
    expect(window.location.search).toBe('?group=skill&page=4');
  });

  it('M41-RST-1: reset() preserves group (with view + density) and clears scope / skill facets', () => {
    render(<GroupHarness />);
    fireEvent.click(screen.getByText('toDiscovery'));
    fireEvent.click(screen.getByText('changeDensity'));
    fireEvent.click(screen.getByText('groupSkill'));
    fireEvent.click(screen.getByText('skillsFilters'));
    fireEvent.click(screen.getByText('addGo'));
    expect(window.location.search).toBe(
      '?view=discovery&scope=skills&skill=design-ui&group=skill&language=Go&density=comfortable',
    );
    fireEvent.click(screen.getByText('clearAll'));
    expect(group()).toBe('skill'); // a presentation preference, not a filter (D4)
    expect(screen.getByTestId('scope').textContent).toBe('all'); // filters cleared
    expect(screen.getByTestId('skills').textContent).toBe('');
    expect(window.location.search).toBe('?view=discovery&group=skill&density=comfortable');
  });

  it('M41-RST-1: popstate restores group from the URL (back/forward)', () => {
    render(<GroupHarness />);
    fireEvent.click(screen.getByText('groupSkill'));
    expect(group()).toBe('skill');
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(group()).toBe('none');
    act(() => {
      window.history.replaceState(null, '', '/?group=skill&page=2');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(group()).toBe('skill');
    expect(page()).toBe('2'); // requested page is restored as-is; the view reconciles it (§15.5)
  });
});
