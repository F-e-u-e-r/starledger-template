import type { CanonicalRepo } from '@starred/schema';
import type { ReleaseAvailability } from '../data/derive-fields';
import { SORT_FIELDS, type SortDirection, type SortField } from '../features/sorting/sorting';

export type HydrationStatus = CanonicalRepo['hydration_status'];

/** Tri-state facet: `null` = "all" (no constraint); `true`/`false` = yes/no. */
export type BooleanFilter = boolean | null;

/**
 * The single canonical dashboard state. React controls, URL encoding and URL
 * decoding all read and write THIS shape — there is no second source of truth.
 * Every field has an explicit default (see {@link DEFAULT_DASHBOARD_STATE}).
 */
export interface DashboardState {
  query: string;
  sort: SortField;
  direction: SortDirection;

  languages: string[];
  topics: string[];
  licenses: string[];
  categories: string[];
  aiTags: string[];

  archived: BooleanFilter;
  fork: BooleanFilter;
  stale: BooleanFilter;

  stableRelease: ReleaseAvailability[];
  anyRelease: ReleaseAvailability[];
  hydrationStatuses: HydrationStatus[];
}

export const DEFAULT_DASHBOARD_STATE: DashboardState = {
  query: '',
  sort: 'starred_at',
  direction: 'desc',
  languages: [],
  topics: [],
  licenses: [],
  categories: [],
  aiTags: [],
  archived: null,
  fork: null,
  stale: null,
  stableRelease: [],
  anyRelease: [],
  hydrationStatuses: [],
};

// Canonical value sets for enum facets. `satisfies` ties them to the source
// unions so a renamed/added variant fails the build here, not silently at runtime.
const DIRECTIONS = ['asc', 'desc'] as const satisfies readonly SortDirection[];
const RELEASE_VALUES = [
  'has',
  'none',
  'unavailable',
] as const satisfies readonly ReleaseAvailability[];
const HYDRATION_VALUES = ['ok', 'partial', 'failed'] as const satisfies readonly HydrationStatus[];

// URL parameter names (singular for repeated array facets). Kept in one place so
// encode and decode can never disagree, and to lock the canonical emit order.
const PARAM = {
  query: 'q',
  sort: 'sort',
  direction: 'direction',
  languages: 'language',
  topics: 'topic',
  licenses: 'license',
  categories: 'category',
  aiTags: 'aiTag',
  archived: 'archived',
  fork: 'fork',
  stale: 'stale',
  stableRelease: 'stableRelease',
  anyRelease: 'anyRelease',
  hydrationStatuses: 'hydration',
} as const;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Drop empties, deduplicate, sort lexicographically. */
function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => v !== ''))].sort(byText);
}

/** Keep only allow-listed values, deduplicate, sort lexicographically. */
function canonicalEnum<T extends string>(values: readonly string[], allowed: readonly T[]): T[] {
  const allow = allowed as readonly string[];
  return [...new Set(values.filter((v): v is T => allow.includes(v)))].sort(byText);
}

/** Walk values from the end and return the first that maps to a defined result. */
function lastValid<T>(
  values: readonly string[],
  pick: (v: string) => T | undefined,
): T | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value === undefined) continue;
    const result = pick(value);
    if (result !== undefined) return result;
  }
  return undefined;
}

function parseBooleanFilter(values: readonly string[]): BooleanFilter {
  const value = lastValid(values, (v) => (v === 'true' ? true : v === 'false' ? false : undefined));
  return value ?? null;
}

/**
 * Canonicalize a (possibly untrusted) state: invalid scalar enums fall back to
 * defaults, array facets are filtered to known values, deduplicated and sorted.
 * Idempotent — `normalize(normalize(x)) === normalize(x)`.
 */
export function normalizeDashboardState(state: DashboardState): DashboardState {
  return {
    query: state.query,
    sort: SORT_FIELDS.includes(state.sort) ? state.sort : DEFAULT_DASHBOARD_STATE.sort,
    direction: (DIRECTIONS as readonly string[]).includes(state.direction)
      ? state.direction
      : DEFAULT_DASHBOARD_STATE.direction,
    languages: canonicalStrings(state.languages),
    topics: canonicalStrings(state.topics),
    licenses: canonicalStrings(state.licenses),
    categories: canonicalStrings(state.categories),
    aiTags: canonicalStrings(state.aiTags),
    archived: state.archived,
    fork: state.fork,
    stale: state.stale,
    stableRelease: canonicalEnum(state.stableRelease, RELEASE_VALUES),
    anyRelease: canonicalEnum(state.anyRelease, RELEASE_VALUES),
    hydrationStatuses: canonicalEnum(state.hydrationStatuses, HYDRATION_VALUES),
  };
}

const asSortField = (v: string): SortField | undefined =>
  (SORT_FIELDS as readonly string[]).includes(v) ? (v as SortField) : undefined;
const asDirection = (v: string): SortDirection | undefined =>
  (DIRECTIONS as readonly string[]).includes(v) ? (v as SortDirection) : undefined;

/**
 * Decode URL params into a canonical DashboardState. NEVER throws: unknown
 * scalar enums fall back to defaults, unknown array values are dropped, repeated
 * scalars take the last valid value, empty strings are discarded. Domain values
 * not present in the current dataset (e.g. `language=Rust`) are preserved — they
 * are valid bookmarks that simply yield no results until the data changes.
 */
export function parseDashboardState(params: URLSearchParams): DashboardState {
  return normalizeDashboardState({
    query: lastValid(params.getAll(PARAM.query), (v) => (v === '' ? undefined : v)) ?? '',
    sort: lastValid(params.getAll(PARAM.sort), asSortField) ?? DEFAULT_DASHBOARD_STATE.sort,
    direction:
      lastValid(params.getAll(PARAM.direction), asDirection) ?? DEFAULT_DASHBOARD_STATE.direction,
    languages: params.getAll(PARAM.languages),
    topics: params.getAll(PARAM.topics),
    licenses: params.getAll(PARAM.licenses),
    categories: params.getAll(PARAM.categories),
    aiTags: params.getAll(PARAM.aiTags),
    archived: parseBooleanFilter(params.getAll(PARAM.archived)),
    fork: parseBooleanFilter(params.getAll(PARAM.fork)),
    stale: parseBooleanFilter(params.getAll(PARAM.stale)),
    stableRelease: canonicalEnum(params.getAll(PARAM.stableRelease), RELEASE_VALUES),
    anyRelease: canonicalEnum(params.getAll(PARAM.anyRelease), RELEASE_VALUES),
    hydrationStatuses: canonicalEnum(params.getAll(PARAM.hydrationStatuses), HYDRATION_VALUES),
  });
}

function appendBoolean(params: URLSearchParams, key: string, value: BooleanFilter): void {
  if (value !== null) params.set(key, value ? 'true' : 'false');
}

/**
 * Encode a DashboardState into a canonical query string (no leading `?`).
 * Defaults are omitted, array facets are deduplicated + sorted, and parameters
 * are emitted in a fixed order, so equivalent states always produce a
 * byte-identical string. The default state serializes to `''`.
 *
 * `sort` and `direction` travel together: both are omitted only when fully
 * default, otherwise both are emitted (so a decoded URL is never ambiguous).
 */
export function serializeDashboardState(state: DashboardState): string {
  const s = normalizeDashboardState(state);
  const params = new URLSearchParams();

  if (s.query !== DEFAULT_DASHBOARD_STATE.query) params.set(PARAM.query, s.query);

  if (
    s.sort !== DEFAULT_DASHBOARD_STATE.sort ||
    s.direction !== DEFAULT_DASHBOARD_STATE.direction
  ) {
    params.set(PARAM.sort, s.sort);
    params.set(PARAM.direction, s.direction);
  }

  for (const v of s.languages) params.append(PARAM.languages, v);
  for (const v of s.topics) params.append(PARAM.topics, v);
  for (const v of s.licenses) params.append(PARAM.licenses, v);
  for (const v of s.categories) params.append(PARAM.categories, v);
  for (const v of s.aiTags) params.append(PARAM.aiTags, v);

  appendBoolean(params, PARAM.archived, s.archived);
  appendBoolean(params, PARAM.fork, s.fork);
  appendBoolean(params, PARAM.stale, s.stale);

  for (const v of s.stableRelease) params.append(PARAM.stableRelease, v);
  for (const v of s.anyRelease) params.append(PARAM.anyRelease, v);
  for (const v of s.hydrationStatuses) params.append(PARAM.hydrationStatuses, v);

  return params.toString();
}
