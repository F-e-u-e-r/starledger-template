// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRepo } from '../../test-utils';
import { RepositoryView } from './RepositoryView';

const NOW = new Date('2026-06-19T00:00:00Z');

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

function renderView(repos = sampleRepos()) {
  return render(
    <RepositoryView repos={repos} datasetGeneratedAt="2026-06-18T00:00:00Z" initialNow={NOW} />,
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
      <RepositoryView
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
    render(<RepositoryView repos={staleRepos()} initialNow={NOW} />); // 2026-06-19
    fireEvent.click(staleYes());
    expect(titles()).toEqual(['a/old']); // only the >12-months-old repo is stale at NOW
    fireEvent.click(screen.getByRole('button', { name: /sort direction/i }));
    expect(titles()).toEqual(['a/old']); // an unrelated control did not move the clock
  });

  it('TIME-2: a newer mount clock re-evaluates staleness', () => {
    render(<RepositoryView repos={staleRepos()} initialNow={new Date('2030-01-01T00:00:00Z')} />);
    fireEvent.click(staleYes());
    expect(titles().sort()).toEqual(['a/new', 'a/old']); // both are stale relative to 2030
  });
});
