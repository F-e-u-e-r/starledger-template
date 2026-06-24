import { describe, expect, it } from 'vitest';
import { deriveRepo } from '../../data/derive-fields';
import { makeRepo } from '../../test-utils';
import { applyFilters, EMPTY_FILTERS } from './filters';

const NOW = new Date('2026-06-19T00:00:00Z');
const d = (overrides: Parameters<typeof makeRepo>[0]) => deriveRepo(makeRepo(overrides), NOW);

const ts = d({ node_id: 'R_ts', primary_language: 'TypeScript', topics: ['cli'] });
const go = d({ node_id: 'R_go', primary_language: 'Go', topics: ['cli', 'automation'] });
const py = d({ node_id: 'R_py', primary_language: 'Python', topics: ['ml'] });
const repos = [ts, go, py];

describe('applyFilters (FILTER-1..6)', () => {
  it('FILTER-2: OR within a facet', () => {
    const result = applyFilters(repos, { ...EMPTY_FILTERS, languages: ['TypeScript', 'Go'] });
    expect(result.map((r) => r.node_id).sort()).toEqual(['R_go', 'R_ts']);
  });

  it('FILTER-1: AND across facets', () => {
    const result = applyFilters(repos, {
      ...EMPTY_FILTERS,
      languages: ['TypeScript', 'Go'],
      topics: ['automation'],
    });
    expect(result.map((r) => r.node_id)).toEqual(['R_go']);
  });

  it('FILTER-3: empty filters return the full dataset', () => {
    expect(applyFilters(repos, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('FILTER-4: a "none" release filter excludes "unavailable"', () => {
    const none = d({ node_id: 'R_none', latest_stable_release: null });
    const unavailable = d({
      node_id: 'R_unavail',
      hydration_status: 'failed',
      latest_stable_release: null,
      unavailable_fields: ['latest_stable_release'],
    });
    const result = applyFilters([none, unavailable], { ...EMPTY_FILTERS, stableRelease: ['none'] });
    expect(result.map((r) => r.node_id)).toEqual(['R_none']);
  });

  it('FILTER-5: stable=none + any=has match a prerelease-only repo (independent dimensions)', () => {
    const prereleaseOnly = d({
      node_id: 'R_pre',
      latest_stable_release: null,
      latest_any_release: {
        tag_name: 'v1.0.0-rc.1',
        published_at: '2026-01-01T00:00:00Z',
        is_prerelease: true,
      },
    });
    // The two release dimensions are genuinely independent for this repo.
    expect([prereleaseOnly.stableRelease, prereleaseOnly.anyRelease]).toEqual(['none', 'has']);
    const result = applyFilters([prereleaseOnly], {
      ...EMPTY_FILTERS,
      stableRelease: ['none'],
      anyRelease: ['has'],
    });
    expect(result.map((r) => r.node_id)).toEqual(['R_pre']);
  });

  it('FILTER-6: any-release "unavailable" is distinct from "none" in both directions', () => {
    const none = d({ node_id: 'R_none', latest_any_release: null });
    const unavailable = d({
      node_id: 'R_unavail',
      hydration_status: 'failed',
      latest_any_release: null,
      unavailable_fields: ['latest_any_release'],
    });
    expect([none.anyRelease, unavailable.anyRelease]).toEqual(['none', 'unavailable']);
    const pair = [none, unavailable];
    expect(
      applyFilters(pair, { ...EMPTY_FILTERS, anyRelease: ['none'] }).map((r) => r.node_id),
    ).toEqual(['R_none']);
    expect(
      applyFilters(pair, { ...EMPTY_FILTERS, anyRelease: ['unavailable'] }).map((r) => r.node_id),
    ).toEqual(['R_unavail']);
  });
});
