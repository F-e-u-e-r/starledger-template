import type { ResolvedRepository } from './models';

/**
 * P2 summary boundary. The deterministic summary is the ONLY summarizer in P2;
 * an LLM-backed provider is deferred to P3 and would be added behind this
 * interface (so delivery never changes). A summary can never become a required
 * delivery dependency.
 */
export interface RepositorySummary {
  title: string;
  body: string;
}

export interface SummaryProvider {
  summarize(repository: ResolvedRepository): Promise<RepositorySummary>;
}

function formatStars(count: number | null): string {
  if (count === null) return 'Stars unknown';
  if (count < 1_000) return `${count} stars`;
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1)}k stars`;
  return `${(count / 1_000_000).toFixed(1)}M stars`;
}

/**
 * Stable metadata-only summary. It intentionally has no network or model
 * dependency, so notifications remain available without LLM_API_KEY.
 */
export function deterministicSummary(repository: ResolvedRepository): RepositorySummary {
  const details: string[] = [];
  if (repository.description?.trim()) details.push(repository.description.trim());

  const facts = [
    repository.primary_language ?? 'Language unknown',
    formatStars(repository.stargazer_count),
    repository.latest_release ? `Latest ${repository.latest_release.tag_name}` : null,
    repository.license_spdx ? repository.license_spdx : null,
  ].filter((value): value is string => value !== null);
  details.push(facts.join(' · '));

  const topics = repository.topics.filter(Boolean).slice(0, 8);
  if (topics.length > 0) details.push(`Topics: ${topics.join(', ')}`);
  if (repository.is_archived) details.push('Archived repository');
  if (repository.is_fork) details.push('Fork');

  return { title: repository.name_with_owner, body: details.join('\n') };
}

export class DeterministicSummaryProvider implements SummaryProvider {
  async summarize(repository: ResolvedRepository): Promise<RepositorySummary> {
    return deterministicSummary(repository);
  }
}
