import { sha256, TAXONOMY_VERSION, type Annotation } from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import { AiConfigSchema, type AiConfig } from '../src/config';
import { repoMetadataSha256, sourceFingerprint } from '../src/fingerprint';
import type { ReadmeRef, ReadmeSource, RepoCoordinates } from '../src/readme-source';

export type PlannerConfig = AiConfig['ai'];

export function makeCanonicalRepo(overrides: Partial<CanonicalRepo> = {}): CanonicalRepo {
  return {
    node_id: 'R_kgDOAAA',
    name_with_owner: 'example/repo',
    owner: 'example',
    name: 'repo',
    url: 'https://github.com/example/repo',
    description: 'An example repository for tests.',
    homepage_url: null,
    primary_language: 'TypeScript',
    topics: ['cli', 'automation'],
    license_spdx: 'MIT',
    stargazer_count: 100,
    fork_count: 5,
    open_issues_count: 2,
    is_archived: false,
    is_disabled: false,
    is_fork: false,
    created_at: '2020-01-01T00:00:00Z',
    pushed_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    latest_stable_release: null,
    latest_any_release: null,
    starred_at: '2026-01-01T00:00:00Z',
    hydration_status: 'ok',
    unavailable_fields: [],
    ...overrides,
  };
}

/** A canonical repo with id-derived identity, so its README key is unique. */
export function repo(id: string, overrides: Partial<CanonicalRepo> = {}): CanonicalRepo {
  return makeCanonicalRepo({
    node_id: `R_${id}`,
    owner: `owner-${id}`,
    name: `repo-${id}`,
    name_with_owner: `owner-${id}/repo-${id}`,
    url: `https://github.com/owner-${id}/repo-${id}`,
    ...overrides,
  });
}

export interface DatasetText {
  starsText: string;
  metaText: string;
  datasetSha256: string;
}

/** Serialize repos into matching stars.json + dataset-meta.json bytes. */
export function makeDataset(repos: readonly CanonicalRepo[]): DatasetText {
  const starsText = JSON.stringify({ schema_version: '1.0', repos }, null, 2) + '\n';
  const datasetSha256 = sha256(starsText);
  const metaText =
    JSON.stringify(
      {
        schema_version: '1.0',
        dataset_generated_at: '2026-01-01T00:00:00Z',
        stars_sha256: datasetSha256,
        repo_count: repos.length,
      },
      null,
      2,
    ) + '\n';
  return { starsText, metaText, datasetSha256 };
}

export function aiConfig(ai: Record<string, unknown> = {}): PlannerConfig {
  return AiConfigSchema.parse({ ai }).ai;
}

export interface FakeReadmeEntry {
  ref: ReadmeRef | null;
  content?: string | null;
}

/** A ReadmeSource backed by a fixed map, recording every call for assertions. */
export class FakeReadmeSource implements ReadmeSource {
  readonly refCalls: string[] = [];
  readonly contentCalls: Array<{ repo: string; path: string }> = [];

  constructor(private readonly entries: Map<string, FakeReadmeEntry>) {}

  private key(coords: RepoCoordinates): string {
    return `${coords.owner}/${coords.name}`;
  }

  getReadmeRef(coords: RepoCoordinates): Promise<ReadmeRef | null> {
    this.refCalls.push(this.key(coords));
    return Promise.resolve(this.entries.get(this.key(coords))?.ref ?? null);
  }

  getReadmeContent(coords: RepoCoordinates, path: string): Promise<string | null> {
    this.contentCalls.push({ repo: this.key(coords), path });
    return Promise.resolve(this.entries.get(this.key(coords))?.content ?? null);
  }
}

export function readmeEntries(
  entries: Record<string, FakeReadmeEntry>,
): Map<string, FakeReadmeEntry> {
  return new Map(Object.entries(entries));
}

/** The exact fingerprint the planner will compute for a repo + observed README ref. */
export function expectedFingerprint(
  target: CanonicalRepo,
  config: PlannerConfig,
  ref: ReadmeRef | null,
): string {
  return sourceFingerprint({
    nodeId: target.node_id,
    sourceKind: ref ? 'readme' : 'metadata',
    readmePath: ref?.path ?? null,
    readmeOid: ref?.oid ?? null,
    repoMetadataSha256: repoMetadataSha256(target),
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: config.prompt_version,
    executionProfileVersion: config.execution_profile.execution_profile_version,
    executorKind: config.executor_kind,
  });
}

/** A published annotation for a repo at a known fingerprint (to seed "already classified"). */
export function makeAnnotationFor(
  target: CanonicalRepo,
  fingerprint: string,
  ref: ReadmeRef | null,
): Annotation {
  const repo_metadata_sha256 = repoMetadataSha256(target);
  return {
    node_id: target.node_id,
    category: 'developer-tools',
    tags: ['automation', 'cli'],
    summary:
      'A concise, factual description of what this repository does and why it is useful to developers.',
    source:
      ref === null
        ? {
            kind: 'metadata',
            readme_path: null,
            readme_oid: null,
            repo_metadata_sha256,
            fingerprint,
          }
        : {
            kind: 'readme',
            readme_path: ref.path,
            readme_oid: ref.oid,
            repo_metadata_sha256,
            fingerprint,
          },
    generation: {
      executor_kind: 'claude-routine',
      execution_profile_version: 'agent-v1',
      model_label: 'informational-only',
      prompt_version: 'classify-v1',
      generated_at: '2026-06-01T00:00:00Z',
    },
  };
}
