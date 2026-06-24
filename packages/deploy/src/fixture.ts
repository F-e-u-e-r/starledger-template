import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type CanonicalRepo, SCHEMA_VERSION, StarsFileSchema } from '@starred/schema';
import { sha256Hex } from './dataset';
import { DATASET_META_FILE, STARS_FILE } from './stage';

function fixtureRepo(over: Partial<CanonicalRepo>): CanonicalRepo {
  return {
    node_id: 'R_fixture',
    name_with_owner: 'octo/fixture',
    owner: 'octo',
    name: 'fixture',
    url: 'https://github.com/octo/fixture',
    description: 'Fixture repository for the Pages smoke test',
    homepage_url: null,
    primary_language: 'TypeScript',
    topics: ['fixture'],
    license_spdx: 'MIT',
    stargazer_count: 1,
    fork_count: 0,
    open_issues_count: 0,
    is_archived: false,
    is_disabled: false,
    is_fork: false,
    created_at: '2024-01-01T00:00:00Z',
    pushed_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-02-01T00:00:00Z',
    latest_stable_release: null,
    latest_any_release: null,
    starred_at: '2024-03-01T00:00:00Z',
    hydration_status: 'ok',
    unavailable_fields: [],
    ...over,
  };
}

export interface FixtureResult {
  sha256: string;
  repoCount: number;
}

/**
 * Write a small, schema-valid `stars.json` + matching `dataset-meta.json` into
 * `dir`. Used by the Pages smoke so it never depends on a real exporter run.
 */
export function writeFixtureDataset(dir: string, now: Date = new Date()): FixtureResult {
  const stars = StarsFileSchema.parse({
    schema_version: SCHEMA_VERSION,
    repos: [
      fixtureRepo({
        node_id: 'R_1',
        name_with_owner: 'octo/one',
        url: 'https://github.com/octo/one',
      }),
    ],
  });
  const starsText = JSON.stringify(stars, null, 2) + '\n';
  const sha = sha256Hex(starsText);
  const meta = {
    schema_version: SCHEMA_VERSION,
    dataset_generated_at: now.toISOString(),
    stars_sha256: sha,
    repo_count: stars.repos.length,
  };
  writeFileSync(resolve(dir, STARS_FILE), starsText);
  writeFileSync(resolve(dir, DATASET_META_FILE), JSON.stringify(meta, null, 2) + '\n');
  return { sha256: sha, repoCount: stars.repos.length };
}
