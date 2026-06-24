import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationFailedError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { publishDataset, validateArtifacts } from '../src/publish';
import { serializeStars, sha256 } from '../src/serialize';
import { FakeGit, makeRepo } from './helpers';

const NOW = new Date('2026-06-18T00:00:00Z');

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'stars-pub-'));
}

function publishInput(dir: string, repos = [makeRepo({ node_id: 'R_1' })]) {
  const starsJson = serializeStars(repos);
  return {
    outDir: dir,
    starsFileName: 'stars.json',
    datasetMetaFileName: 'dataset-meta.json',
    starsJson,
    repoCount: repos.length,
    now: NOW,
  };
}

describe('validateArtifacts (PUB-1 / PUB-2 / HASH-1)', () => {
  it('accepts matching artifacts', () => {
    const starsJson = serializeStars([makeRepo({ node_id: 'R_1' })]);
    const meta = JSON.stringify({
      schema_version: '1.0',
      dataset_generated_at: NOW.toISOString(),
      stars_sha256: sha256(starsJson),
      repo_count: 1,
    });
    expect(() => validateArtifacts(starsJson, meta)).not.toThrow();
  });

  it('PUB-1: rejects a schema-invalid stars.json', () => {
    expect(() => validateArtifacts('{"bad":true}', '{}')).toThrow(ValidationFailedError);
  });

  it('PUB-2: rejects a dataset-meta whose sha does not match stars bytes', () => {
    const starsJson = serializeStars([makeRepo({ node_id: 'R_1' })]);
    const meta = JSON.stringify({
      schema_version: '1.0',
      dataset_generated_at: NOW.toISOString(),
      stars_sha256: '0'.repeat(64),
      repo_count: 1,
    });
    expect(() => validateArtifacts(starsJson, meta)).toThrow(ValidationFailedError);
  });
});

describe('publishDataset (PUB-3..8 / HASH-1)', () => {
  it('PUB-5 / HASH-1: a changed dataset is one commit of both files; meta sha matches bytes', async () => {
    const dir = tmp();
    const input = publishInput(dir);
    const git = new FakeGit();
    const result = await publishDataset({ ...input, git });
    expect(result.datasetChanged).toBe(true);
    expect(result.commitCreated).toBe(true);
    expect(result.pushSucceeded).toBe(true);
    expect(git.commits).toEqual([['stars.json', 'dataset-meta.json']]);
    const meta = JSON.parse(readFileSync(join(dir, 'dataset-meta.json'), 'utf8'));
    expect(meta.stars_sha256).toBe(sha256(input.starsJson));
  });

  it('PUB-4: an unchanged dataset is not re-committed', async () => {
    const dir = tmp();
    const input = publishInput(dir);
    const git = new FakeGit();
    await publishDataset({ ...input, git });
    const second = await publishDataset({ ...input, git });
    expect(second.datasetChanged).toBe(false);
    expect(git.commits).toHaveLength(1);
  });

  it('PUB-3: a validation failure leaves the working tree untouched', async () => {
    const dir = tmp();
    const git = new FakeGit();
    await expect(
      publishDataset({
        outDir: dir,
        starsFileName: 'stars.json',
        datasetMetaFileName: 'dataset-meta.json',
        starsJson: '{"bad":true}',
        repoCount: 0,
        now: NOW,
        git,
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    expect(existsSync(join(dir, 'stars.json'))).toBe(false);
    expect(git.commits).toHaveLength(0);
  });

  it('PUB-6: a commit failure is reported (no push)', async () => {
    const dir = tmp();
    const result = await publishDataset({
      ...publishInput(dir),
      git: new FakeGit({ failCommit: true }),
    });
    expect(result.commitCreated).toBe(false);
    expect(result.pushSucceeded).toBe(false);
  });

  it('PUB-7: a push failure is reported (commit created, not pushed)', async () => {
    const dir = tmp();
    const git = new FakeGit({ failPush: true });
    const result = await publishDataset({ ...publishInput(dir), git });
    expect(result.commitCreated).toBe(true);
    expect(result.pushSucceeded).toBe(false);
    expect(git.pushes).toBe(0);
  });
});
