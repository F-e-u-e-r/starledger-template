import { describe, expect, it } from 'vitest';
import type { ParsedEntry } from '../src/parse-source';
import { resolveEntries } from '../src/resolve';

function entry(name: string): ParsedEntry {
  return {
    source_name_with_owner: name,
    summary: 'Fixture summary.',
    primary_category_id: 'verification-qa',
    secondary_category_ids: [],
    source_line: 1,
  };
}

const empty = new Map<string, string>();
const map = (pairs: [string, string][]) => new Map(pairs);

describe('evaluate-all resolution (§5, owner gate 2)', () => {
  it('zero candidates → unresolved, retained', () => {
    const result = resolveEntries([entry('gone/missing')], {
      starsByName: empty,
      aliasesByName: empty,
      priorByName: empty,
    });
    expect(result.issues).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      node_id: null,
      resolution: 'missing_from_stars',
    });
  });

  it.each([
    ['exact match', map([['a/b', 'R_x1']]), empty, empty],
    ['alias only (rename)', empty, map([['a/b', 'R_x1']]), empty],
    ['prior only (sticky)', empty, empty, map([['a/b', 'R_x1']])],
  ])('single source resolves: %s', (_name, stars, aliases, prior) => {
    const result = resolveEntries([entry('a/b')], {
      starsByName: stars,
      aliasesByName: aliases,
      priorByName: prior,
    });
    expect(result.issues).toEqual([]);
    expect(result.entries[0]).toMatchObject({ node_id: 'R_x1', resolution: 'resolved' });
  });

  it('all three sources agreeing on one id resolve cleanly', () => {
    const result = resolveEntries([entry('a/b')], {
      starsByName: map([['a/b', 'R_x1']]),
      aliasesByName: map([['a/b', 'R_x1']]),
      priorByName: map([['a/b', 'R_x1']]),
    });
    expect(result.issues).toEqual([]);
    expect(result.entries[0]?.node_id).toBe('R_x1');
  });

  it('GATE-2: exact vs alias disagreement is a NAMED conflict — a first-match precedence loop would silently return the exact hit', () => {
    const result = resolveEntries([entry('a/b')], {
      starsByName: map([['a/b', 'R_recycled']]),
      aliasesByName: map([['a/b', 'R_original']]),
      priorByName: empty,
    });
    expect(result.entries).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('a/b');
    expect(result.issues[0]).toContain('R_recycled');
    expect(result.issues[0]).toContain('R_original');
    expect(result.issues[0]).toContain('exact-match');
    expect(result.issues[0]).toContain('alias-map');
  });

  it('GATE-2: exact vs prior disagreement (same-name different-repo swap) is a named conflict', () => {
    const result = resolveEntries([entry('a/b')], {
      starsByName: map([['a/b', 'R_new']]),
      aliasesByName: empty,
      priorByName: map([['a/b', 'R_old']]),
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('R_new');
    expect(result.issues[0]).toContain('R_old');
  });

  it('alias vs prior disagreement (exact missing) is a named conflict', () => {
    const result = resolveEntries([entry('a/b')], {
      starsByName: empty,
      aliasesByName: map([['a/b', 'R_alias']]),
      priorByName: map([['a/b', 'R_prior']]),
    });
    expect(result.issues).toHaveLength(1);
  });

  it('lookups are case-insensitive on the source name', () => {
    const result = resolveEntries([entry('A/B')], {
      starsByName: map([['a/b', 'R_x1']]),
      aliasesByName: empty,
      priorByName: empty,
    });
    expect(result.entries[0]?.node_id).toBe('R_x1');
  });

  it('a stale alias is a non-fatal surfaced diagnostic, never an issue', () => {
    const result = resolveEntries([entry('a/b')], {
      starsByName: map([['a/b', 'R_x1']]),
      aliasesByName: map([['dead/alias', 'R_dead']]),
      priorByName: empty,
    });
    expect(result.issues).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain('stale alias');
    expect(result.diagnostics[0]).toContain('dead/alias');
  });

  it('per-entry adjudication is independent — one conflict does not block other entries', () => {
    const result = resolveEntries([entry('a/b'), entry('c/d')], {
      starsByName: map([
        ['a/b', 'R_x1'],
        ['c/d', 'R_x2'],
      ]),
      aliasesByName: map([['a/b', 'R_other']]),
      priorByName: empty,
    });
    expect(result.issues).toHaveLength(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.source_name_with_owner).toBe('c/d');
  });
});
