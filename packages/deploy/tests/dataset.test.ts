import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatasetIntegrityError, sha256Hex, verifyDatasetIntegrity } from '../src/dataset';
import { writeFixtureDataset } from '../src/fixture';
import { DATASET_META_FILE, STARS_FILE } from '../src/stage';

function fixtureTexts() {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  writeFixtureDataset(dir, new Date('2026-06-19T00:00:00Z'));
  return {
    starsText: readFileSync(join(dir, STARS_FILE), 'utf8'),
    metaText: readFileSync(join(dir, DATASET_META_FILE), 'utf8'),
  };
}

describe('verifyDatasetIntegrity (BUILD-DATA-1/2)', () => {
  it('BUILD-DATA-1: a matching stars + meta pair verifies', () => {
    const { starsText, metaText } = fixtureTexts();
    const r = verifyDatasetIntegrity(starsText, metaText);
    expect(r.meta.repo_count).toBe(1);
    expect(r.stars.repos).toHaveLength(1);
    expect(r.sha256).toBe(sha256Hex(starsText));
  });

  it('BUILD-DATA-2: a stars/meta hash mismatch is rejected', () => {
    const { starsText, metaText } = fixtureTexts();
    const tampered = starsText.replace('octo/one', 'octo/two'); // bytes change → stale sha
    expect(() => verifyDatasetIntegrity(tampered, metaText)).toThrow(DatasetIntegrityError);
  });

  it('rejects a repo_count mismatch', () => {
    const { starsText, metaText } = fixtureTexts();
    const meta = JSON.parse(metaText) as Record<string, unknown>;
    meta.repo_count = 99;
    expect(() => verifyDatasetIntegrity(starsText, JSON.stringify(meta))).toThrow(/repo_count/);
  });

  it('rejects malformed JSON and schema-invalid data', () => {
    expect(() => verifyDatasetIntegrity('{not json', '{}')).toThrow(DatasetIntegrityError);
    const { starsText } = fixtureTexts();
    expect(() => verifyDatasetIntegrity(starsText, '{"schema_version":"1.0"}')).toThrow(/schema/);
  });
});
