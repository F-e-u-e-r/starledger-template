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
