import type { CanonicalRepo, StarsFile } from '@starred/schema';
import type { LoadedAnnotations, RepoAnnotation } from './data/load-annotations';
import type { LoadedDataset } from './data/load-stars';

export function makeRepo(overrides: Partial<CanonicalRepo> = {}): CanonicalRepo {
  return {
    node_id: 'R_base',
    name_with_owner: 'acme/base',
    owner: 'acme',
    name: 'base',
    url: 'https://github.com/acme/base',
    description: null,
    homepage_url: null,
    primary_language: null,
    topics: [],
    license_spdx: null,
    stargazer_count: 0,
    fork_count: 0,
    open_issues_count: 0,
    is_archived: false,
    is_disabled: false,
    is_fork: false,
    created_at: '2020-01-01T00:00:00Z',
    pushed_at: null,
    updated_at: '2020-01-02T00:00:00Z',
    latest_stable_release: null,
    latest_any_release: null,
    starred_at: '2026-01-01T00:00:00Z',
    hydration_status: 'ok',
    unavailable_fields: [],
    ...overrides,
  };
}

export function makeStarsFile(repos: CanonicalRepo[]): StarsFile {
  return { schema_version: '1.0', repos };
}

export function makeAnnotation(overrides: Partial<RepoAnnotation> = {}): RepoAnnotation {
  return {
    category: 'developer-tools',
    tags: ['automation', 'cli'],
    summary: 'A concise AI summary of what this repository does and who it is for.',
    generatedAt: '2026-06-20T00:00:00Z',
    modelLabel: 'informational-only',
    ...overrides,
  };
}

export function makeAnnotations(entries: Record<string, RepoAnnotation>): LoadedAnnotations {
  return {
    byNodeId: new Map(Object.entries(entries)),
    taxonomyVersion: '1',
    generatedAt: '2026-06-20T00:00:00Z',
  };
}

export function makeDataset(repos: CanonicalRepo[]): LoadedDataset {
  return {
    stars: makeStarsFile(repos),
    meta: {
      schema_version: '1.0',
      dataset_generated_at: '2026-06-18T00:00:00Z',
      stars_sha256: '0'.repeat(64),
      repo_count: repos.length,
    },
  };
}
