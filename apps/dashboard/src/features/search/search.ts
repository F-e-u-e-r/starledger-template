import type { CanonicalRepo } from '@starred/schema';
import type { RepoAnnotation } from '../../data/load-annotations';

/** A canonical repo optionally carrying its joined AI annotation. */
export type Searchable = CanonicalRepo & { ai?: RepoAnnotation | null };

/** Lowercase + NFKD-normalize + trim, for accent/width-insensitive substring search. */
export function normalizeText(text: string): string {
  return text.normalize('NFKD').toLowerCase().trim();
}

function repoSearchText(repo: Searchable): string {
  const parts = [
    repo.name_with_owner,
    repo.description ?? '',
    repo.topics.join(' '),
    repo.primary_language ?? '',
  ];
  // AI category / tags / summary are searchable too — but only when present.
  if (repo.ai) parts.push(repo.ai.category, repo.ai.tags.join(' '), repo.ai.summary);
  return parts.join(' ');
}

/**
 * Precompute a repo's normalized searchable text. Done ONCE per dataset so the
 * hot path (one call per keystroke per repo) is a plain substring check.
 */
export function buildSearchText(repo: Searchable): string {
  return normalizeText(repoSearchText(repo));
}

/** Match precomputed (already-normalized) text against a query. Empty/whitespace query matches all. */
export function matchesSearchText(searchText: string, query: string): boolean {
  const q = normalizeText(query);
  return q.length === 0 || searchText.includes(q);
}

/**
 * Substring match over name_with_owner / description / topics / language. Empty
 * query matches all. Normalizes the repo on each call — prefer
 * {@link buildSearchText} + {@link matchesSearchText} on hot paths.
 */
export function matchesQuery(repo: Searchable, query: string): boolean {
  return matchesSearchText(buildSearchText(repo), query);
}
