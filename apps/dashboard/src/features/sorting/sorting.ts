import type { CanonicalRepo } from '@starred/schema';

export type SortField =
  | 'starred_at'
  | 'stargazer_count'
  | 'pushed_at'
  | 'latest_stable_release'
  | 'name_with_owner';

export type SortDirection = 'asc' | 'desc';

export const SORT_FIELDS: readonly SortField[] = [
  'starred_at',
  'stargazer_count',
  'pushed_at',
  'latest_stable_release',
  'name_with_owner',
];

/** Comparable value for a field, or null when unknown/absent (always sorts last). */
function sortValue(repo: CanonicalRepo, field: SortField): string | number | null {
  switch (field) {
    case 'starred_at':
      return repo.starred_at;
    case 'name_with_owner':
      return repo.name_with_owner;
    case 'stargazer_count':
      return repo.stargazer_count;
    case 'pushed_at':
      return repo.pushed_at;
    case 'latest_stable_release':
      return repo.latest_stable_release?.published_at ?? null;
  }
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// Deterministic tiebreak, independent of sort direction (mirrors P0 D2).
function tieBreak(a: CanonicalRepo, b: CanonicalRepo): number {
  return a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0;
}

export function compareRepos(
  field: SortField,
  direction: SortDirection,
): (a: CanonicalRepo, b: CanonicalRepo) => number {
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const va = sortValue(a, field);
    const vb = sortValue(b, field);
    // null/unknown ALWAYS last, regardless of direction.
    if (va === null && vb === null) return tieBreak(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = compareValues(va, vb);
    return cmp !== 0 ? cmp * sign : tieBreak(a, b);
  };
}

export function sortRepos<T extends CanonicalRepo>(
  repos: readonly T[],
  field: SortField,
  direction: SortDirection,
): T[] {
  return [...repos].sort(compareRepos(field, direction));
}
