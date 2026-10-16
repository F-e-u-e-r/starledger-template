/**
 * M4.1 pure grouping projection (P7 §15.4): primary-only bucket key, taxonomy
 * `order`, empty groups omitted, within-group order = input order (never
 * re-sorted), unclassified results counted but not rendered.
 */
import type { SkillsCategory } from '@starred/skills-schema/contracts';
import { describe, expect, it } from 'vitest';
import { makeRepo, makeSkillsRecord } from '../../test-utils';
import { sortRepos } from '../sorting/sorting';
import { groupByPrimaryCategory } from './group';
import { prepareRepositories, type SearchableRepo } from './select';

const NOW = new Date('2026-06-19T00:00:00Z');

/** Taxonomy in canonical `order` (I-5) whose labels are alphabetically INVERTED
 *  vs `order`, so an alphabetical mutant re-orders every non-empty group. */
const CATEGORIES: SkillsCategory[] = [
  {
    id: 'zeta-tools',
    label: 'Zeta tools',
    kind: 'domain',
    definition: 'z',
    order: 0,
    target_pack: null,
  },
  {
    id: 'mid-stuff',
    label: 'Mid stuff',
    kind: 'domain',
    definition: 'm',
    order: 1,
    target_pack: null,
  },
  {
    id: 'alpha-ops',
    label: 'Alpha ops',
    kind: 'infrastructure',
    definition: 'a',
    order: 2,
    target_pack: null,
  },
  {
    id: 'empty-cat',
    label: 'Empty category',
    kind: 'domain',
    definition: 'e',
    order: 3,
    target_pack: null,
  },
];

const LABELS = new Map(CATEGORIES.map((c) => [c.id, c.label] as const));

/** Insertion order INVERTED vs taxonomy order (alpha first, zeta last); counts
 *  non-monotonic in taxonomy order (zeta 2, mid 3, alpha 1); one unclassified. */
function fixture(): SearchableRepo[] {
  const repos = [
    makeRepo({ node_id: 'R_a1', name_with_owner: 'acme/alpha-one' }),
    makeRepo({ node_id: 'R_m1', name_with_owner: 'acme/mid-one' }),
    makeRepo({ node_id: 'R_m2', name_with_owner: 'acme/mid-two' }),
    makeRepo({ node_id: 'R_m3', name_with_owner: 'acme/mid-three' }),
    makeRepo({ node_id: 'R_z1', name_with_owner: 'acme/zeta-one' }),
    makeRepo({ node_id: 'R_z2', name_with_owner: 'acme/zeta-two' }),
    makeRepo({ node_id: 'R_plain', name_with_owner: 'acme/plain' }),
  ];
  const skills = new Map([
    ['R_a1', makeSkillsRecord({ primaryCategoryId: 'alpha-ops' })],
    ['R_m1', makeSkillsRecord({ primaryCategoryId: 'mid-stuff' })],
    ['R_m2', makeSkillsRecord({ primaryCategoryId: 'mid-stuff' })],
    ['R_m3', makeSkillsRecord({ primaryCategoryId: 'mid-stuff' })],
    ['R_z1', makeSkillsRecord({ primaryCategoryId: 'zeta-tools' })],
    ['R_z2', makeSkillsRecord({ primaryCategoryId: 'zeta-tools' })],
  ]);
  return prepareRepositories(repos, NOW, undefined, skills, LABELS);
}

const ids = (repos: readonly SearchableRepo[]) => repos.map((r) => r.node_id);

describe('groupByPrimaryCategory (M4.1 §15.4)', () => {
  it('M41-ORD-1: groups follow taxonomy `order` — not label order, not insertion order, not count; empty categories omitted', () => {
    const { groups, groupedCount, excludedCount } = groupByPrimaryCategory(fixture(), CATEGORIES);
    expect(groups.map((g) => g.id)).toEqual(['zeta-tools', 'mid-stuff', 'alpha-ops']);
    expect(groups.map((g) => g.label)).toEqual(['Zeta tools', 'Mid stuff', 'Alpha ops']);
    expect(groups.map((g) => g.repos.length)).toEqual([2, 3, 1]); // non-monotonic
    expect(groups.some((g) => g.id === 'empty-cat')).toBe(false); // omitted, not rendered empty
    expect(groupedCount).toBe(6);
    expect(excludedCount).toBe(1); // R_plain: counted, never bucketed — no pseudo-group
    expect(groups.flatMap((g) => ids(g.repos))).not.toContain('R_plain');
  });

  it('M41-GRP-1: bucket key is the PRIMARY category only — a secondary never places the repo a second time', () => {
    const repos = [
      makeRepo({ node_id: 'R_both', name_with_owner: 'acme/both' }),
      makeRepo({ node_id: 'R_z', name_with_owner: 'acme/z' }),
    ];
    const skills = new Map([
      [
        'R_both',
        makeSkillsRecord({ primaryCategoryId: 'alpha-ops', secondaryCategoryIds: ['zeta-tools'] }),
      ],
      ['R_z', makeSkillsRecord({ primaryCategoryId: 'zeta-tools' })],
    ]);
    const prepared = prepareRepositories(repos, NOW, undefined, skills, LABELS);
    const { groups, groupedCount, excludedCount } = groupByPrimaryCategory(prepared, CATEGORIES);
    const byId = new Map(groups.map((g) => [g.id, ids(g.repos)] as const));
    expect(byId.get('alpha-ops')).toEqual(['R_both']); // under its primary
    expect(byId.get('zeta-tools')).toEqual(['R_z']); // NOT also under its secondary
    // exactly once overall: memberships are a partition of the classified set
    const all = groups.flatMap((g) => ids(g.repos));
    expect(all).toHaveLength(new Set(all).size);
    expect(all).toHaveLength(groupedCount);
    expect(groupedCount).toBe(2);
    expect(excludedCount).toBe(0);
  });

  it('M41-SRT-1: within-group order is the INPUT (effective sort) order — the partition never re-sorts', () => {
    // Name ascending puts R_m3 ("mid-three") before R_m2 ("mid-two"): the
    // sorted order differs from both insertion order and node_id order, so a
    // bucket that re-sorted by node_id (or kept insertion order) would differ.
    const partition = (repos: readonly SearchableRepo[]) =>
      groupByPrimaryCategory(repos, CATEGORIES).groups.map((g) => [g.id, ids(g.repos)]);
    expect(partition(sortRepos(fixture(), 'name_with_owner', 'asc'))).toEqual([
      ['zeta-tools', ['R_z1', 'R_z2']],
      ['mid-stuff', ['R_m1', 'R_m3', 'R_m2']],
      ['alpha-ops', ['R_a1']],
    ]);
    // Reversing the effective sort reverses every bucket, and ONLY the buckets:
    // group order is untouched by `sort`/`direction`.
    expect(partition(sortRepos(fixture(), 'name_with_owner', 'desc'))).toEqual([
      ['zeta-tools', ['R_z2', 'R_z1']],
      ['mid-stuff', ['R_m2', 'R_m3', 'R_m1']],
      ['alpha-ops', ['R_a1']],
    ]);
  });

  it('is a pure projection: the input is not mutated and the same result set yields the same partition', () => {
    const input = fixture();
    const before = ids(input);
    const a = groupByPrimaryCategory(input, CATEGORIES);
    const b = groupByPrimaryCategory(input, CATEGORIES);
    expect(ids(input)).toEqual(before);
    expect(a).toEqual(b);
    // no results ⇒ no groups, nothing excluded
    expect(groupByPrimaryCategory([], CATEGORIES)).toEqual({
      groups: [],
      groupedCount: 0,
      excludedCount: 0,
    });
  });
});
