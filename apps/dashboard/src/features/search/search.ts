import type { CanonicalRepo } from '@starred/schema';
import type { RepoAnnotation } from '../../data/load-annotations';
import type { RepoSkillsClassification } from '../../data/load-skills-classification';

/** A canonical repo optionally carrying its joined optional-layer records. */
export type Searchable = CanonicalRepo & {
  ai?: RepoAnnotation | null;
  skills?: RepoSkillsClassification | null;
};

/** Lowercase + NFKD-normalize + trim, for accent/width-insensitive substring search. */
export function normalizeText(text: string): string {
  return text.normalize('NFKD').toLowerCase().trim();
}

function repoSearchText(
  repo: Searchable,
  skillCategoryLabels?: ReadonlyMap<string, string>,
): string {
  const parts = [
    repo.name_with_owner,
    repo.description ?? '',
    repo.topics.join(' '),
    repo.primary_language ?? '',
  ];
  // AI category / tags / summary are searchable too — but only when present.
  if (repo.ai) parts.push(repo.ai.category, repo.ai.tags.join(' '), repo.ai.summary);
  // Skills classification (P7 §4.12/§7): the corpus gains the taxonomy LABELS
  // (primary + secondaries, resolved via the loaded taxonomy) and the curated
  // `summary`. Category id SLUGS deliberately stay out — they are URL-canonical
  // machine tokens, not search vocabulary (SEQ-1 pins the exclusion). The
  // readiness gate is structural: `repo.skills` is null whenever the layer is
  // not coherent-ready, so the degraded corpus is base fields only (§7).
  if (repo.skills) {
    for (const id of [repo.skills.primaryCategoryId, ...repo.skills.secondaryCategoryIds]) {
      const label = skillCategoryLabels?.get(id);
      if (label) parts.push(label);
    }
    parts.push(repo.skills.summary);
  }
  return parts.join(' ');
}

/**
 * Precompute a repo's normalized searchable text. Done ONCE per dataset so the
 * hot path (one call per keystroke per repo) is a plain substring check.
 */
export function buildSearchText(
  repo: Searchable,
  skillCategoryLabels?: ReadonlyMap<string, string>,
): string {
  return normalizeText(repoSearchText(repo, skillCategoryLabels));
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
