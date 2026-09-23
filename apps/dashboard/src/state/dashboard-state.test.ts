import { describe, expect, it } from 'vitest';
import {
  type DashboardState,
  DEFAULT_DASHBOARD_STATE,
  normalizeDashboardState,
  parseDashboardState,
  serializeDashboardState,
} from './dashboard-state';

const parse = (qs: string) => parseDashboardState(new URLSearchParams(qs));

function state(over: Partial<DashboardState> = {}): DashboardState {
  return { ...DEFAULT_DASHBOARD_STATE, ...over };
}

describe('dashboard-state codec', () => {
  it('STATE-1: defaults normalize to themselves and serialize to an empty string', () => {
    expect(normalizeDashboardState(DEFAULT_DASHBOARD_STATE)).toEqual(DEFAULT_DASHBOARD_STATE);
    expect(serializeDashboardState(DEFAULT_DASHBOARD_STATE)).toBe('');
    expect(parse('')).toEqual(DEFAULT_DASHBOARD_STATE);
  });

  it('STATE-1: invalid scalar enums normalize back to defaults', () => {
    const messy = { ...DEFAULT_DASHBOARD_STATE, sort: 'bogus', direction: 'sideways' } as never;
    const norm = normalizeDashboardState(messy);
    expect(norm.sort).toBe('starred_at');
    expect(norm.direction).toBe('desc');
  });

  it('STATE-2: array facets deduplicate and sort lexicographically', () => {
    const norm = normalizeDashboardState(
      state({
        languages: ['TypeScript', 'Go', 'Go'],
        topics: ['cli', 'automation', 'cli'],
        stableRelease: ['none', 'has', 'has'],
        hydrationStatuses: ['partial', 'ok', 'ok'],
      }),
    );
    expect(norm.languages).toEqual(['Go', 'TypeScript']);
    expect(norm.topics).toEqual(['automation', 'cli']);
    expect(norm.stableRelease).toEqual(['has', 'none']);
    expect(norm.hydrationStatuses).toEqual(['ok', 'partial']);
  });

  it('URL-1: a full non-default state round-trips and serializes in canonical order', () => {
    const full = state({
      view: 'discovery',
      scope: 'skills',
      query: 'telegram bot',
      sort: 'stargazer_count',
      direction: 'asc',
      languages: ['TypeScript', 'Go'],
      topics: ['cli', 'automation'],
      licenses: ['MIT', 'Apache-2.0'],
      categories: ['security', 'ai-ml'],
      aiTags: ['llm', 'cli'],
      skillCategories: ['verification-qa', 'design-ui'],
      archived: false,
      fork: true,
      stale: false,
      stableRelease: ['none', 'has'],
      anyRelease: ['has'],
      hydrationStatuses: ['partial', 'ok'],
      density: 'comfortable',
      page: 7,
    });
    // "Full" means LITERALLY every canonical DashboardState field non-default
    // (max-review round-2 finding 3: the F12 comment overclaimed while
    // categories/aiTags — and view/density/page — sat at defaults; the fixture
    // now backs the claim, so dropping ANY field's emission reddens this pin).
    expect(serializeDashboardState(full)).toBe(
      'view=discovery&scope=skills&skill=design-ui&skill=verification-qa' +
        '&q=telegram+bot&sort=stargazer_count&direction=asc' +
        '&language=Go&language=TypeScript&topic=automation&topic=cli' +
        '&license=Apache-2.0&license=MIT' +
        '&category=ai-ml&category=security&aiTag=cli&aiTag=llm' +
        '&archived=false&fork=true&stale=false' +
        '&stableRelease=has&stableRelease=none&anyRelease=has&hydration=ok&hydration=partial' +
        '&density=comfortable&page=7',
    );
    // round-trip: decode(encode(x)) === normalize(x)
    expect(parse(serializeDashboardState(full))).toEqual(normalizeDashboardState(full));
  });

  it('URL-2: equivalent states (order/dupes aside) serialize byte-identically', () => {
    const a = serializeDashboardState(
      state({ languages: ['Go', 'TypeScript'], topics: ['b', 'a'] }),
    );
    const b = serializeDashboardState(
      state({ languages: ['TypeScript', 'Go', 'Go'], topics: ['a', 'b', 'a'] }),
    );
    expect(a).toBe(b);
  });

  it('URL-3: invalid enum values are ignored / fall back to defaults', () => {
    const s = parse(
      'sort=bogus&direction=sideways&stableRelease=maybe&hydration=unknown&archived=perhaps&language=Go',
    );
    expect(s.sort).toBe('starred_at');
    expect(s.direction).toBe('desc');
    expect(s.stableRelease).toEqual([]);
    expect(s.hydrationStatuses).toEqual([]);
    expect(s.archived).toBeNull();
    expect(s.languages).toEqual(['Go']); // arbitrary domain values are kept
  });

  it('URL-4: a repeated scalar takes the last VALID value', () => {
    expect(parse('sort=stargazer_count&sort=name_with_owner').sort).toBe('name_with_owner');
    expect(parse('direction=desc&direction=asc').direction).toBe('asc');
    // a trailing invalid value does not clobber the last valid one
    expect(parse('sort=name_with_owner&sort=bogus').sort).toBe('name_with_owner');
  });

  it('URL-5: the default state produces no query string; direction emits independently of sort (R1, §6.1)', () => {
    expect(serializeDashboardState(DEFAULT_DASHBOARD_STATE)).toBe('');
    // A non-default direction on the DEFAULT sort now emits `direction` ALONE:
    // `sort` is omitted because it is default, and the two params are independent
    // (this supersedes the P1 "sort+direction always travel together" rule). It is
    // unambiguous — it decodes back to {sort: starred_at, direction: asc}.
    expect(serializeDashboardState(state({ direction: 'asc' }))).toBe('direction=asc');
    expect(parse('direction=asc')).toEqual(state({ direction: 'asc' }));
  });

  it('URL-6: the prerelease-only release combination round-trips', () => {
    const s = state({ stableRelease: ['none'], anyRelease: ['has'] });
    expect(serializeDashboardState(s)).toBe('stableRelease=none&anyRelease=has');
    expect(parse(serializeDashboardState(s))).toEqual(normalizeDashboardState(s));
  });

  it('URL-7: unknown-but-valid facet values survive parsing (bookmarks do not silently drop)', () => {
    const s = parse('language=Rust&topic=embedded&license=BSD-3-Clause');
    expect(s.languages).toEqual(['Rust']);
    expect(s.topics).toEqual(['embedded']);
    expect(s.licenses).toEqual(['BSD-3-Clause']);
  });

  it('empty-string scalar/array values are discarded', () => {
    expect(parse('q=').query).toBe('');
    expect(parse('language=&language=Go').languages).toEqual(['Go']);
  });
});

describe('dashboard-state codec — M1.1 fields (view/density/page + R1)', () => {
  it('M1-VIEW: view round-trips; invalid → default stars; default omitted', () => {
    expect(parse('view=discovery').view).toBe('discovery');
    expect(parse('view=bogus').view).toBe('stars');
    expect(serializeDashboardState(state({ view: 'discovery' }))).toBe('view=discovery');
    expect(serializeDashboardState(state({ view: 'stars' }))).toBe('');
  });

  it('M1-DENSITY: density round-trips; invalid → default compact; default omitted', () => {
    expect(parse('density=comfortable').density).toBe('comfortable');
    expect(parse('density=bogus').density).toBe('compact');
    expect(serializeDashboardState(state({ density: 'comfortable' }))).toBe('density=comfortable');
    expect(serializeDashboardState(state({ density: 'compact' }))).toBe('');
  });

  it('M1-PAGE decode: accepts a requested page ≥ 1; junk / 0 / negative / decimal → 1', () => {
    expect(parse('page=5').page).toBe(5);
    expect(parse('page=007').page).toBe(7);
    expect(parse('page=999').page).toBe(999); // requested is accepted; clamp is downstream (§6.2)
    expect(parse('page=0').page).toBe(1);
    expect(parse('page=-3').page).toBe(1);
    expect(parse('page=2.5').page).toBe(1);
    expect(parse('page=abc').page).toBe(1);
    expect(parse('').page).toBe(1);
  });

  it('M1-PAGE repeat: a repeated page takes the last VALID value', () => {
    expect(parse('page=2&page=9').page).toBe(9);
    expect(parse('page=9&page=abc').page).toBe(9);
  });

  it('M1-PAGE encode: page omitted at 1, emitted otherwise', () => {
    expect(serializeDashboardState(state({ page: 1 }))).toBe('');
    expect(serializeDashboardState(state({ page: 3 }))).toBe('page=3');
  });

  it('M1-PAGE normalize: page floored to a positive integer', () => {
    expect(normalizeDashboardState(state({ page: 2.9 })).page).toBe(2);
    expect(normalizeDashboardState(state({ page: 0 })).page).toBe(1);
    expect(normalizeDashboardState(state({ page: -5 })).page).toBe(1);
    expect(normalizeDashboardState(state({ page: Number.NaN })).page).toBe(1);
  });

  it('M1-PAGE closure: an out-of-safe-range page clamps so it survives serialize→parse (no exponent form)', () => {
    // 30 digits parses to a float beyond MAX_SAFE_INTEGER; String() would emit
    // "1e+30" which the digits-only decode rejects → silent reset. Clamp prevents it.
    const parsed = parse(`page=${'9'.repeat(30)}`);
    expect(parsed.page).toBe(Number.MAX_SAFE_INTEGER);
    expect(serializeDashboardState(parsed)).toBe('page=9007199254740991');
    expect(parse(serializeDashboardState(parsed)).page).toBe(Number.MAX_SAFE_INTEGER); // closed
    // an overlong digit string overflows Number() to Infinity → still clamps, not reset to 1
    expect(parse(`page=${'9'.repeat(400)}`).page).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('R1 decode: a missing direction resolves to defaultDirection(sort), not global desc', () => {
    expect(parse('sort=name_with_owner').direction).toBe('asc');
    expect(parse('sort=stargazer_count').direction).toBe('desc');
    expect(parse('').direction).toBe('desc'); // default sort starred_at → desc
  });

  it('R1 encode: direction emitted only when it differs from defaultDirection(sort)', () => {
    expect(serializeDashboardState(state({ sort: 'name_with_owner', direction: 'asc' }))).toBe(
      'sort=name_with_owner',
    );
    expect(serializeDashboardState(state({ sort: 'name_with_owner', direction: 'desc' }))).toBe(
      'sort=name_with_owner&direction=desc',
    );
    expect(serializeDashboardState(state({ sort: 'stargazer_count', direction: 'desc' }))).toBe(
      'sort=stargazer_count',
    );
    expect(serializeDashboardState(state({ sort: 'stargazer_count', direction: 'asc' }))).toBe(
      'sort=stargazer_count&direction=asc',
    );
  });

  it('R1 compat: a redundant explicit default direction still decodes, then drops on re-serialize', () => {
    const s = parse('sort=name_with_owner&direction=asc');
    expect(s.sort).toBe('name_with_owner');
    expect(s.direction).toBe('asc');
    expect(serializeDashboardState(s)).toBe('sort=name_with_owner'); // redundancy dropped
  });

  it('ORDER: canonical emit order = view, scope, skill, q, sort, direction, facets, density, page (§4.11 amendment)', () => {
    const full = state({
      view: 'discovery',
      scope: 'skills',
      skillCategories: ['verification-qa'],
      query: 'x',
      sort: 'stargazer_count',
      direction: 'asc',
      languages: ['Go'],
      density: 'comfortable',
      page: 3,
    });
    expect(serializeDashboardState(full)).toBe(
      'view=discovery&scope=skills&skill=verification-qa' +
        '&q=x&sort=stargazer_count&direction=asc&language=Go&density=comfortable&page=3',
    );
    expect(parse(serializeDashboardState(full))).toEqual(normalizeDashboardState(full));
  });
});
