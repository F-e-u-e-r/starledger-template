import { describe, expect, it } from 'vitest';
import { HttpsUrlSchema, CanonicalRepoSchema } from '../src/canonical-repo';
import { DatasetMetaSchema } from '../src/dataset-meta';
import { StarsFileSchema } from '../src/stars';

// Zod 3 -> Zod 4 parity oracle for UNCHANGED external-input schemas. Expected values were
// captured by running these exact inputs under zod@3.25.76 (the pre-migration contract):
// accept/reject, the stored output for accepted inputs (no trimming or rewriting), and the
// set of issue paths for rejected inputs. Issue codes and messages are Zod's own naming and
// are deliberately not asserted. Inputs whose outcome Zod 4 changed on purpose (safe-integer
// `.int()`, the early size-bound rejection of GHSA-mrhx-c7xc-m3w5) are disclosed in the PR
// instead of being pinned here.
describe('HttpsUrlSchema parity with zod@3.25.76 (schema.HttpsUrlSchema)', () => {
  it('https-plain: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://github.com/octo/one');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://github.com/octo/one');
  });

  it('https-path-query-fragment: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://x.example/p/a%20b?q=1#frag');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://x.example/p/a%20b?q=1#frag');
  });

  it('http-scheme: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse('http://x.example/');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('upper-scheme: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('HTTPS://GITHUB.COM/octo/one');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('HTTPS://GITHUB.COM/octo/one');
  });

  it('javascript-scheme: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse('javascript:alert(1)');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('data-scheme: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse('data:text/html,hi');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('leading-space: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse(' https://x.example/');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(' https://x.example/');
  });

  it('trailing-space: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://x.example/ ');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://x.example/ ');
  });

  it('leading-nbsp: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse(' https://x.example/');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('trailing-bom: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://x.example/﻿');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://x.example/﻿');
  });

  it('leading-ideographic-space: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse('　https://x.example/');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('inner-space: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://x.example/a b');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://x.example/a b');
  });

  it('ipv6-host: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://[::1]/');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://[::1]/');
  });

  it('no-host: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse('https://');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('empty: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse('');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('relative: rejected at the same paths as Zod 3', () => {
    const result = HttpsUrlSchema.safeParse('/octo/one');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('userinfo: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://user:pw@x.example/');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://user:pw@x.example/');
  });

  it('unicode-host: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://bücher.example/');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://bücher.example/');
  });

  it('percent-bad: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://x.example/%zz');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://x.example/%zz');
  });

  it('newline: accepted with the Zod 3 output', () => {
    const result = HttpsUrlSchema.safeParse('https://x.example/\n');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('https://x.example/\n');
  });
});

describe('DatasetMetaSchema parity with zod@3.25.76 (schema.DatasetMetaSchema.repo_count)', () => {
  it('zero: accepted with the Zod 3 output', () => {
    const result = DatasetMetaSchema.safeParse({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: 0,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: 0,
    });
  });

  it('safe-max: accepted with the Zod 3 output', () => {
    const result = DatasetMetaSchema.safeParse({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: 9007199254740991,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: 9007199254740991,
    });
  });

  it('negative: rejected at the same paths as Zod 3', () => {
    const result = DatasetMetaSchema.safeParse({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: -1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['repo_count']);
  });

  it('fraction: rejected at the same paths as Zod 3', () => {
    const result = DatasetMetaSchema.safeParse({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: 1.5,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['repo_count']);
  });

  it('negative-zero: accepted with the Zod 3 output', () => {
    const result = DatasetMetaSchema.safeParse({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: 0,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: 0,
    });
  });

  it('string-digit: rejected at the same paths as Zod 3', () => {
    const result = DatasetMetaSchema.safeParse({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: '5',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['repo_count']);
  });

  it('null: rejected at the same paths as Zod 3', () => {
    const result = DatasetMetaSchema.safeParse({
      schema_version: '1.0',
      dataset_generated_at: '2026-10-27T15:06:05.441Z',
      stars_sha256: '0e3bf767c364d107e0e05600ddda5bb15748bf9794c3cb37e2f485ba35bd7674',
      repo_count: null,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['repo_count']);
  });
});

describe('CanonicalRepoSchema parity with zod@3.25.76 (schema.CanonicalRepoSchema)', () => {
  it('fixture-repo: accepted with the Zod 3 output', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
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
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
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
    });
  });

  it('repo-extra-key: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
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
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('repo-missing-url: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('repo-http-url: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'http://github.com/octo/one',
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('repo-javascript-url: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'javascript:alert(1)',
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('repo-stars-negative: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: ['fixture'],
      license_spdx: 'MIT',
      stargazer_count: -1,
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['stargazer_count']);
  });

  it('repo-stars-float: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: ['fixture'],
      license_spdx: 'MIT',
      stargazer_count: 1.5,
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['stargazer_count']);
  });

  it('repo-stars-null: accepted with the Zod 3 output', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: ['fixture'],
      license_spdx: 'MIT',
      stargazer_count: null,
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
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: ['fixture'],
      license_spdx: 'MIT',
      stargazer_count: null,
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
    });
  });

  it('repo-topics-not-array: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: 'a',
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['topics']);
  });

  it('repo-topics-empty-string: accepted with the Zod 3 output', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: [''],
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
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: [''],
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
    });
  });

  it('repo-description-number: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 5,
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['description']);
  });

  it('repo-is-archived-string: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse({
      node_id: 'R_1',
      name_with_owner: 'octo/one',
      owner: 'octo',
      name: 'fixture',
      url: 'https://github.com/octo/one',
      description: 'Fixture repository for the Pages smoke test',
      homepage_url: null,
      primary_language: 'TypeScript',
      topics: ['fixture'],
      license_spdx: 'MIT',
      stargazer_count: 1,
      fork_count: 0,
      open_issues_count: 0,
      is_archived: 'no',
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
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['is_archived']);
  });

  it('repo-array-input: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse([
      {
        node_id: 'R_1',
        name_with_owner: 'octo/one',
        owner: 'octo',
        name: 'fixture',
        url: 'https://github.com/octo/one',
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
      },
    ]);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('repo-null-input: rejected at the same paths as Zod 3', () => {
    const result = CanonicalRepoSchema.safeParse(null);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});

describe('StarsFileSchema parity with zod@3.25.76 (schema.StarsFileSchema)', () => {
  it('fixture: accepted with the Zod 3 output', () => {
    const result = StarsFileSchema.safeParse({
      schema_version: '1.0',
      repos: [
        {
          node_id: 'R_1',
          name_with_owner: 'octo/one',
          owner: 'octo',
          name: 'fixture',
          url: 'https://github.com/octo/one',
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
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      repos: [
        {
          node_id: 'R_1',
          name_with_owner: 'octo/one',
          owner: 'octo',
          name: 'fixture',
          url: 'https://github.com/octo/one',
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
        },
      ],
    });
  });

  it('unknown-top-key: rejected at the same paths as Zod 3', () => {
    const result = StarsFileSchema.safeParse({
      schema_version: '1.0',
      repos: [
        {
          node_id: 'R_1',
          name_with_owner: 'octo/one',
          owner: 'octo',
          name: 'fixture',
          url: 'https://github.com/octo/one',
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
        },
      ],
      extra: true,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('bad-schema-version: rejected at the same paths as Zod 3', () => {
    const result = StarsFileSchema.safeParse({
      schema_version: '2.0',
      repos: [
        {
          node_id: 'R_1',
          name_with_owner: 'octo/one',
          owner: 'octo',
          name: 'fixture',
          url: 'https://github.com/octo/one',
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
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['schema_version']);
  });

  it('repos-not-array: rejected at the same paths as Zod 3', () => {
    const result = StarsFileSchema.safeParse({
      schema_version: '1.0',
      repos: {},
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['repos']);
  });
});
