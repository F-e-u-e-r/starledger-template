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
      query: 'telegram bot',
      sort: 'stargazer_count',
      direction: 'asc',
      languages: ['TypeScript', 'Go'],
      topics: ['cli', 'automation'],
      licenses: ['MIT', 'Apache-2.0'],
      archived: false,
      fork: true,
      stale: false,
      stableRelease: ['none', 'has'],
      anyRelease: ['has'],
      hydrationStatuses: ['partial', 'ok'],
    });
    expect(serializeDashboardState(full)).toBe(
      'q=telegram+bot&sort=stargazer_count&direction=asc' +
        '&language=Go&language=TypeScript&topic=automation&topic=cli' +
        '&license=Apache-2.0&license=MIT' +
        '&archived=false&fork=true&stale=false' +
        '&stableRelease=has&stableRelease=none&anyRelease=has&hydration=ok&hydration=partial',
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

  it('URL-5: the default state produces no query string', () => {
    expect(serializeDashboardState(DEFAULT_DASHBOARD_STATE)).toBe('');
    // a non-default direction on the default sort still emits both, unambiguously
    expect(serializeDashboardState(state({ direction: 'asc' }))).toBe(
      'sort=starred_at&direction=asc',
    );
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
