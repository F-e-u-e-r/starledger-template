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
