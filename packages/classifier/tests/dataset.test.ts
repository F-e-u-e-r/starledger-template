import { describe, expect, it } from 'vitest';
import { DatasetError, loadCanonicalDataset } from '../src/dataset';
import { makeDataset, repo } from './helpers';

describe('canonical dataset loading', () => {
  it('DATA-1: a valid dataset loads with the exact dataset SHA, count, and repos', () => {
    const repos = [repo('a'), repo('b')];
    const { starsText, metaText, datasetSha256 } = makeDataset(repos);
    const dataset = loadCanonicalDataset(starsText, metaText);
    expect(dataset.repos).toHaveLength(2);
    expect(dataset.datasetSha256).toBe(datasetSha256);
    expect(dataset.meta.stars_sha256).toBe(datasetSha256);
    expect(dataset.meta.repo_count).toBe(2);
  });

  it('DATA-2: a stars_sha256 mismatch is rejected (no dataset, no manifest)', () => {
    const { starsText, metaText } = makeDataset([repo('a')]);
    const tampered = metaText.replace(
      /"stars_sha256": "[0-9a-f]{64}"/,
      `"stars_sha256": "${'0'.repeat(64)}"`,
    );
    expect(() => loadCanonicalDataset(starsText, tampered)).toThrow(DatasetError);
  });

  it('DATA-2: a repo_count mismatch is rejected', () => {
    const { starsText, metaText } = makeDataset([repo('a'), repo('b')]);
    const tampered = metaText.replace('"repo_count": 2', '"repo_count": 3');
    expect(() => loadCanonicalDataset(starsText, tampered)).toThrow(/repo_count/);
  });

  it('DATA-2: a schema-invalid canonical identity is rejected', () => {
    const { metaText } = makeDataset([repo('a')]);
    const badStars =
      JSON.stringify({ schema_version: '1.0', repos: [{ node_id: '' }] }, null, 2) + '\n';
    expect(() => loadCanonicalDataset(badStars, metaText)).toThrow(DatasetError);
  });

  it('DATA-2: a duplicate node_id is rejected', () => {
    const dup = repo('a');
    const { starsText, metaText } = makeDataset([dup, { ...dup }]);
    expect(() => loadCanonicalDataset(starsText, metaText)).toThrow(/duplicate node_id/);
  });

  it('DATA-2: non-JSON input is rejected', () => {
    expect(() => loadCanonicalDataset('{not json', '{}')).toThrow(DatasetError);
  });
});
