import type { CanonicalRepo } from '@starred/schema';
import type { ReleaseAvailability } from '../data/derive-fields';
import {
  defaultDirection,
  SORT_FIELDS,
  type SortDirection,
  type SortField,
} from '../features/sorting/sorting';

export type HydrationStatus = CanonicalRepo['hydration_status'];

/** Tri-state facet: `null` = "all" (no constraint); `true`/`false` = yes/no. */
export type BooleanFilter = boolean | null;

/** Active top-level tab. `discovery` is fail-soft: honored only when available (§6.4). */
export type DashboardView = 'stars' | 'discovery';

/**
 * Skills-ecosystem scope (P7 §4.11): `all` = no constraint; `skills` = only
 * repos carrying a classification record. The URL token is UI-canonical —
 * deliberately NOT the artifact `scope.id`, because the codec is static and
 * data-free at decode time; a second scope value would be a vocabulary
 * expansion event (D2 rollout pattern), not data drift.
 */
export type SkillsScopeValue = 'all' | 'skills';

/** Row density. `compact` is the default (P7 §3, M1). Visual treatment lands in M1.2. */
export type Density = 'comfortable' | 'compact';

/**
 * The single canonical dashboard state. React controls, URL encoding and URL
 * decoding all read and write THIS shape — there is no second source of truth.
 * Every field has an explicit default (see {@link DEFAULT_DASHBOARD_STATE}).
 */
export interface DashboardState {
  view: DashboardView;
  scope: SkillsScopeValue;

  query: string;
  sort: SortField;
  direction: SortDirection;

  languages: string[];
  topics: string[];
  licenses: string[];
  categories: string[];
  aiTags: string[];
  /** Skill-category ids (§4.11). Unknown/stale ids are preserved like every
   * other data-dependent array facet — valid bookmarks until the taxonomy
   * changes — never validated against loaded data at decode time. */
  skillCategories: string[];

  archived: BooleanFilter;
  fork: BooleanFilter;
  stale: BooleanFilter;

  stableRelease: ReleaseAvailability[];
  anyRelease: ReleaseAvailability[];
  hydrationStatuses: HydrationStatus[];

  density: Density;
  /** The REQUESTED page (>= 1). Not clamped here — the effective page is derived
   * against the filtered result count downstream (§6.2). */
  page: number;
}

export const DEFAULT_DASHBOARD_STATE: DashboardState = {
  view: 'stars',
  scope: 'all',
  query: '',
  sort: 'starred_at',
  direction: 'desc',
  languages: [],
  topics: [],
  licenses: [],
  categories: [],
  aiTags: [],
  skillCategories: [],
  archived: null,
  fork: null,
  stale: null,
  stableRelease: [],
  anyRelease: [],
  hydrationStatuses: [],
  density: 'compact',
  page: 1,
};

// Canonical value sets for enum facets. `satisfies` ties them to the source
// unions so a renamed/added variant fails the build here, not silently at runtime.
const DIRECTIONS = ['asc', 'desc'] as const satisfies readonly SortDirection[];
const VIEW_VALUES = ['stars', 'discovery'] as const satisfies readonly DashboardView[];
const SCOPE_VALUES = ['all', 'skills'] as const satisfies readonly SkillsScopeValue[];
const DENSITY_VALUES = ['comfortable', 'compact'] as const satisfies readonly Density[];
const RELEASE_VALUES = [
  'has',
  'none',
  'unavailable',
] as const satisfies readonly ReleaseAvailability[];
const HYDRATION_VALUES = ['ok', 'partial', 'failed'] as const satisfies readonly HydrationStatus[];

// URL parameter names (singular for repeated array facets). Kept in one place so
// encode and decode can never disagree, and to lock the canonical emit order.
const PARAM = {
  view: 'view',
  scope: 'scope',
  skillCategories: 'skill',
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
  density: 'density',
  page: 'page',
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

/** Coerce an arbitrary value to a REQUESTED page: a positive integer, else 1. */
function canonicalPage(value: number): number {
  if (Number.isNaN(value) || value < 1) return 1;
  // Clamp to a safe integer so the value survives a String()→decode round trip:
  // beyond MAX_SAFE_INTEGER — including +Infinity from an overlong digit string —
  // String() emits exponent form (e.g. "1e+21") that the digits-only decode
  // rejects, which would silently reset the page to 1.
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
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
 * defaults, array facets are filtered to known values, deduplicated and sorted,
 * and `page` is coerced to a positive integer. An invalid `direction` falls back
 * to the sort field's natural default (`defaultDirection`, not a global `desc` —
 * R1, §6.1). `page` is NOT clamped to the dataset here (no result count).
 * Idempotent — `normalize(normalize(x)) === normalize(x)`.
 */
export function normalizeDashboardState(state: DashboardState): DashboardState {
  const sort = SORT_FIELDS.includes(state.sort) ? state.sort : DEFAULT_DASHBOARD_STATE.sort;
  return {
    view: VIEW_VALUES.includes(state.view) ? state.view : DEFAULT_DASHBOARD_STATE.view,
    scope: SCOPE_VALUES.includes(state.scope) ? state.scope : DEFAULT_DASHBOARD_STATE.scope,
    query: state.query,
    sort,
    direction: (DIRECTIONS as readonly string[]).includes(state.direction)
      ? state.direction
      : defaultDirection(sort),
    languages: canonicalStrings(state.languages),
    topics: canonicalStrings(state.topics),
    licenses: canonicalStrings(state.licenses),
    categories: canonicalStrings(state.categories),
    aiTags: canonicalStrings(state.aiTags),
    skillCategories: canonicalStrings(state.skillCategories),
    archived: state.archived,
    fork: state.fork,
    stale: state.stale,
    stableRelease: canonicalEnum(state.stableRelease, RELEASE_VALUES),
    anyRelease: canonicalEnum(state.anyRelease, RELEASE_VALUES),
    hydrationStatuses: canonicalEnum(state.hydrationStatuses, HYDRATION_VALUES),
    density: DENSITY_VALUES.includes(state.density)
      ? state.density
      : DEFAULT_DASHBOARD_STATE.density,
    page: canonicalPage(state.page),
  };
}

const asSortField = (v: string): SortField | undefined =>
  (SORT_FIELDS as readonly string[]).includes(v) ? (v as SortField) : undefined;
const asDirection = (v: string): SortDirection | undefined =>
  (DIRECTIONS as readonly string[]).includes(v) ? (v as SortDirection) : undefined;
const asView = (v: string): DashboardView | undefined =>
  (VIEW_VALUES as readonly string[]).includes(v) ? (v as DashboardView) : undefined;
const asScope = (v: string): SkillsScopeValue | undefined =>
  (SCOPE_VALUES as readonly string[]).includes(v) ? (v as SkillsScopeValue) : undefined;
const asDensity = (v: string): Density | undefined =>
  (DENSITY_VALUES as readonly string[]).includes(v) ? (v as Density) : undefined;
/** A positive-integer page token; rejects `0`, negatives, decimals and junk. */
const asPage = (v: string): number | undefined =>
  /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : undefined;

/**
 * Decode URL params into a canonical DashboardState. NEVER throws: unknown
 * scalar enums fall back to defaults, unknown array values are dropped, repeated
 * scalars take the last valid value, empty strings are discarded. A missing
 * `direction` resolves to `defaultDirection(sort)` (R1, §6.1). `page` accepts the
 * REQUESTED value (>= 1; junk/absent → 1) and is clamped downstream (§6.2).
 * Domain values not present in the current dataset (e.g. `language=Rust`) are
 * preserved — valid bookmarks that simply yield no results until data changes.
 */
export function parseDashboardState(params: URLSearchParams): DashboardState {
  const sort = lastValid(params.getAll(PARAM.sort), asSortField) ?? DEFAULT_DASHBOARD_STATE.sort;
  return normalizeDashboardState({
    view: lastValid(params.getAll(PARAM.view), asView) ?? DEFAULT_DASHBOARD_STATE.view,
    scope: lastValid(params.getAll(PARAM.scope), asScope) ?? DEFAULT_DASHBOARD_STATE.scope,
    query: lastValid(params.getAll(PARAM.query), (v) => (v === '' ? undefined : v)) ?? '',
    sort,
    direction: lastValid(params.getAll(PARAM.direction), asDirection) ?? defaultDirection(sort),
    languages: params.getAll(PARAM.languages),
    topics: params.getAll(PARAM.topics),
    licenses: params.getAll(PARAM.licenses),
    categories: params.getAll(PARAM.categories),
    aiTags: params.getAll(PARAM.aiTags),
    skillCategories: params.getAll(PARAM.skillCategories),
    archived: parseBooleanFilter(params.getAll(PARAM.archived)),
    fork: parseBooleanFilter(params.getAll(PARAM.fork)),
    stale: parseBooleanFilter(params.getAll(PARAM.stale)),
    stableRelease: canonicalEnum(params.getAll(PARAM.stableRelease), RELEASE_VALUES),
    anyRelease: canonicalEnum(params.getAll(PARAM.anyRelease), RELEASE_VALUES),
    hydrationStatuses: canonicalEnum(params.getAll(PARAM.hydrationStatuses), HYDRATION_VALUES),
    density: lastValid(params.getAll(PARAM.density), asDensity) ?? DEFAULT_DASHBOARD_STATE.density,
    page: lastValid(params.getAll(PARAM.page), asPage) ?? DEFAULT_DASHBOARD_STATE.page,
  });
}

function appendBoolean(params: URLSearchParams, key: string, value: BooleanFilter): void {
  if (value !== null) params.set(key, value ? 'true' : 'false');
}

/**
 * Encode a DashboardState into a canonical query string (no leading `?`).
 * Defaults are omitted, array facets are deduplicated + sorted, and parameters
 * are emitted in a fixed order (§6/§4.11: view, scope, skill, q, sort,
 * direction, facets, booleans, release/hydration, density, page), so equivalent
 * states always produce a byte-identical string. The default state serializes
 * to `''`.
 *
 * `sort` and `direction` are INDEPENDENT (R1, §6.1): `sort` is emitted when it is
 * non-default; `direction` is emitted only when it differs from
 * `defaultDirection(sort)` (so a non-default sort at its natural direction emits
 * `sort` alone, and a redundant default direction is never written).
 */
export function serializeDashboardState(state: DashboardState): string {
  const s = normalizeDashboardState(state);
  const params = new URLSearchParams();

  if (s.view !== DEFAULT_DASHBOARD_STATE.view) params.set(PARAM.view, s.view);

  // §4.11 emit-order amendment: `scope`, then `skill`, directly after `view`.
  if (s.scope !== DEFAULT_DASHBOARD_STATE.scope) params.set(PARAM.scope, s.scope);
  for (const v of s.skillCategories) params.append(PARAM.skillCategories, v);

  if (s.query !== DEFAULT_DASHBOARD_STATE.query) params.set(PARAM.query, s.query);

  if (s.sort !== DEFAULT_DASHBOARD_STATE.sort) params.set(PARAM.sort, s.sort);
  if (s.direction !== defaultDirection(s.sort)) params.set(PARAM.direction, s.direction);

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

  if (s.density !== DEFAULT_DASHBOARD_STATE.density) params.set(PARAM.density, s.density);
  if (s.page !== DEFAULT_DASHBOARD_STATE.page) params.set(PARAM.page, String(s.page));

  return params.toString();
}
