import type { CanonicalRepo, StarsFile } from '@starred/schema';
import type { LoadedAnnotations, RepoAnnotation } from './data/load-annotations';
import type {
  LoadedSkillsClassification,
  RepoSkillsClassification,
} from './data/load-skills-classification';
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

export function makeSkillsRecord(
  overrides: Partial<RepoSkillsClassification> = {},
): RepoSkillsClassification {
  return {
    primaryCategoryId: 'verification-qa',
    secondaryCategoryIds: [],
    summary: 'Curated one-liner.',
    ...overrides,
  };
}

/**
 * A ready skills-classification fixture (P7 §4.11). The default
 * `generatedAgainstStarsSha256` equals `makeDataset`'s `stars_sha256`, so the
 * §2.1 provenance note stays OFF unless a test opts into the mismatch.
 */
export function makeSkillsClassification(
  entries: Record<string, RepoSkillsClassification>,
  overrides: Partial<Omit<LoadedSkillsClassification, 'byNodeId'>> = {},
): LoadedSkillsClassification {
  return {
    byNodeId: new Map(Object.entries(entries)),
    categories: [
      {
        id: 'verification-qa',
        label: 'Verification & QA',
        kind: 'domain',
        definition: 'Testing, review, and QA skills.',
        order: 0,
        target_pack: 'opus-pack',
      },
      {
        id: 'design-ui',
        label: 'Design & UI',
        kind: 'domain',
        definition: 'Design and UI skills.',
        order: 1,
        target_pack: 'design-pack',
      },
      {
        id: 'infra-runtime',
        label: 'Infra & Runtime',
        kind: 'infrastructure',
        definition: 'Infrastructure repos.',
        order: 2,
        target_pack: null,
      },
    ],
    scope: {
      id: 'coding-agent-skills-ecosystem',
      label: 'Coding-agent skills ecosystem',
      description: 'A curated subset; absence is not a classification.',
    },
    taxonomyVersion: 'skills-1',
    generatedAt: '2026-08-14T00:00:00Z',
    generatedAgainstStarsSha256: '0'.repeat(64),
    coverage: { matched: 2, unclassified: 1, unresolved: 0 },
    ...overrides,
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
