import { describe, expect, it } from 'vitest';
import { makeRepo } from '../../test-utils';
import { EMPTY_FILTERS } from '../filters/filters';
import {
  dashboardToView,
  deriveFacetOptions,
  prepareRepositories,
  selectFromPrepared,
  selectRepositories,
  type ViewState,
} from './select';
import { DEFAULT_DASHBOARD_STATE } from '../../state/dashboard-state';

const NOW = new Date('2026-06-19T00:00:00Z');

function view(over: Partial<ViewState> = {}): ViewState {
  return {
    query: '',
    filters: EMPTY_FILTERS,
    sort: { field: 'starred_at', direction: 'desc' },
    ...over,
  };
}

describe('selectRepositories (RESULT-1, PERF-1)', () => {
  it('RESULT-1: combined search + filter + sort yields the correct set', () => {
    const repos = [
      makeRepo({
        node_id: 'R_1',
        name_with_owner: 'a/telegram-bot',
        primary_language: 'TypeScript',
      }),
      makeRepo({ node_id: 'R_2', name_with_owner: 'a/telegram-cli', primary_language: 'Go' }),
      makeRepo({ node_id: 'R_3', name_with_owner: 'a/unrelated', primary_language: 'TypeScript' }),
    ];
    const result = selectRepositories(
      repos,
      view({ query: 'telegram', filters: { ...EMPTY_FILTERS, languages: ['TypeScript'] } }),
      NOW,
    );
    expect(result.map((r) => r.node_id)).toEqual(['R_1']); // telegram AND TypeScript
  });

  it('deriveFacetOptions returns sorted, unique values', () => {
    const repos = [
      makeRepo({ primary_language: 'Go', topics: ['b', 'a'], license_spdx: 'MIT' }),
      makeRepo({ primary_language: 'Go', topics: ['a'], license_spdx: 'Apache-2.0' }),
    ];
    expect(deriveFacetOptions(repos)).toEqual({
      languages: ['Go'],
      topics: ['a', 'b'],
      licenses: ['Apache-2.0', 'MIT'],
      categories: [],
      aiTags: [],
    });
  });

  it('PERF-1: handles thousands of repositories quickly', () => {
    const repos = Array.from({ length: 5000 }, (_, i) =>
      makeRepo({
        node_id: `R_${i}`,
        name_with_owner: `acme/repo-${i}`,
        stargazer_count: i,
        primary_language: i % 2 ? 'Go' : 'TypeScript',
      }),
    );
    const start = performance.now();
    const result = selectRepositories(
      repos,
      view({
        query: 'repo',
        filters: { ...EMPTY_FILTERS, languages: ['Go'] },
        sort: { field: 'stargazer_count', direction: 'desc' },
      }),
      NOW,
    );
    const ms = performance.now() - start;
    expect(result.length).toBe(2500);
    expect(ms).toBeLessThan(1000);
  });
});

describe('prepared pipeline (PERF-2 / PERF-3)', () => {
  const repos = [
    makeRepo({ node_id: 'R_ts', name_with_owner: 'a/ts', primary_language: 'TypeScript' }),
    makeRepo({ node_id: 'R_go', name_with_owner: 'a/go', primary_language: 'Go' }),
  ];

  it('PERF-2: one prepared dataset powers many queries without re-deriving', () => {
    const prepared = prepareRepositories(repos, NOW);
    // searchable text is precomputed once, in prepare (not per query)
    expect(prepared[0]?.searchText).toContain('a/ts');
    const r1 = selectFromPrepared(prepared, view({ query: 'ts' }));
    const r2 = selectFromPrepared(prepared, view({ query: 'go' }));
    expect(r1.map((r) => r.node_id)).toEqual(['R_ts']);
    expect(r2.map((r) => r.node_id)).toEqual(['R_go']);
    // selectFromPrepared takes no clock — it structurally cannot re-derive metadata
    expect(selectFromPrepared.length).toBe(2);
  });

  it('PERF-3: facet options depend only on the dataset', () => {
    expect(deriveFacetOptions(repos)).toEqual(deriveFacetOptions(repos));
    expect(deriveFacetOptions(repos)).toEqual({
      languages: ['Go', 'TypeScript'],
      topics: [],
      licenses: [],
      categories: [],
      aiTags: [],
    });
  });

  it('dashboardToView maps the canonical state onto the pipeline view', () => {
    const v = dashboardToView({
      ...DEFAULT_DASHBOARD_STATE,
      query: 'x',
      sort: 'stargazer_count',
      direction: 'asc',
      languages: ['Go'],
      stale: true,
    });
    expect(v.query).toBe('x');
    expect(v.sort).toEqual({ field: 'stargazer_count', direction: 'asc' });
    expect(v.filters.languages).toEqual(['Go']);
    expect(v.filters.stale).toBe(true);
  });
});
