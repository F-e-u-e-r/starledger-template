import { createHash } from 'node:crypto';
import {
  type CanonicalRepo,
  SCHEMA_VERSION,
  type StarsFile,
  StarsFileSchema,
} from '@starred/schema';
import { compareStrings } from './normalize';

/**
 * Total, deterministic ordering: `starred_at` DESC, `node_id` ASC as tiebreak.
 * Independent of input order (invariant I2).
 */
export function sortRepos(repos: readonly CanonicalRepo[]): CanonicalRepo[] {
  return [...repos].sort((a, b) => {
    if (a.starred_at !== b.starred_at) return a.starred_at < b.starred_at ? 1 : -1;
    return compareStrings(a.node_id, b.node_id);
  });
}

// Explicit key order — never rely on object-construction order surviving refactors.
function canonicalizeRepo(repo: CanonicalRepo): Record<string, unknown> {
  return {
    node_id: repo.node_id,
    name_with_owner: repo.name_with_owner,
    owner: repo.owner,
    name: repo.name,
    url: repo.url,
    description: repo.description,
    homepage_url: repo.homepage_url,
    primary_language: repo.primary_language,
    topics: [...repo.topics],
    license_spdx: repo.license_spdx,
    stargazer_count: repo.stargazer_count,
    fork_count: repo.fork_count,
    open_issues_count: repo.open_issues_count,
    is_archived: repo.is_archived,
    is_disabled: repo.is_disabled,
    is_fork: repo.is_fork,
    created_at: repo.created_at,
    pushed_at: repo.pushed_at,
    updated_at: repo.updated_at,
    latest_stable_release:
      repo.latest_stable_release === null
        ? null
        : {
            tag_name: repo.latest_stable_release.tag_name,
            published_at: repo.latest_stable_release.published_at,
            url: repo.latest_stable_release.url,
          },
    latest_any_release:
      repo.latest_any_release === null
        ? null
        : {
            tag_name: repo.latest_any_release.tag_name,
            published_at: repo.latest_any_release.published_at,
            is_prerelease: repo.latest_any_release.is_prerelease,
          },
    starred_at: repo.starred_at,
    hydration_status: repo.hydration_status,
    unavailable_fields: [...repo.unavailable_fields],
  };
}

export function buildStarsFile(repos: readonly CanonicalRepo[]): StarsFile {
  return { schema_version: SCHEMA_VERSION, repos: sortRepos(repos) };
}

/**
 * Validate (including cross-field invariants) then emit canonical bytes:
 * fixed key order, 2-space indent, single trailing newline.
 */
export function serializeStars(repos: readonly CanonicalRepo[]): string {
  const validated = StarsFileSchema.parse(buildStarsFile(repos));
  const canonical = {
    schema_version: validated.schema_version,
    repos: validated.repos.map(canonicalizeRepo),
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
