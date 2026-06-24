import type { RawStarEdge } from '@starred/github-client';
import type { CanonicalRepo } from '@starred/schema';

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim().length === 0 ? null : value;
}

function dedupeSortTopics(topics: readonly string[]): string[] {
  return [...new Set(topics)].sort(compareStrings);
}

/**
 * Maps a raw GraphQL star edge to a CanonicalRepo.
 *
 * Release model (ADR): `latest_stable_release` is taken verbatim from GitHub's
 * `Repository.latestRelease` (we do not reproduce GitHub's selection algorithm);
 * `latest_any_release` is the most-recently-created release including
 * prereleases (`releases(first: 1, orderBy: CREATED_AT DESC)`).
 *
 * In the P0.1 GraphQL path hydration is inline and complete, so every record is
 * `hydration_status: "ok"` with empty `unavailable_fields`.
 */
export function normalizeEdge(edge: RawStarEdge): CanonicalRepo {
  const node = edge.node;

  const latestStable = node.latestRelease
    ? {
        tag_name: node.latestRelease.tagName,
        published_at: node.latestRelease.publishedAt,
        url: node.latestRelease.url,
      }
    : null;

  const newestRelease = node.releases.nodes[0];
  const latestAny = newestRelease
    ? {
        tag_name: newestRelease.tagName,
        published_at: newestRelease.publishedAt,
        is_prerelease: newestRelease.isPrerelease,
      }
    : null;

  return {
    node_id: node.id,
    name_with_owner: node.nameWithOwner,
    owner: node.owner.login,
    name: node.name,
    url: node.url,
    description: emptyToNull(node.description),
    homepage_url: emptyToNull(node.homepageUrl),
    primary_language: node.primaryLanguage?.name ?? null,
    topics: dedupeSortTopics(node.repositoryTopics.nodes.map((t) => t.topic.name)),
    license_spdx: node.licenseInfo?.spdxId ?? null,
    stargazer_count: node.stargazerCount,
    fork_count: node.forkCount,
    open_issues_count: node.issues.totalCount,
    is_archived: node.isArchived,
    is_disabled: node.isDisabled,
    is_fork: node.isFork,
    created_at: node.createdAt,
    pushed_at: node.pushedAt,
    updated_at: node.updatedAt,
    latest_stable_release: latestStable,
    latest_any_release: latestAny,
    starred_at: edge.starredAt,
    hydration_status: 'ok',
    unavailable_fields: [],
  };
}
