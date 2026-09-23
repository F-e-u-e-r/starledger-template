import { describe, expect, it } from 'vitest';
import { DatasetError, loadCanonicalDataset } from '../src/dataset';
import { makeDataset, repo } from './helpers';

describe('canonical dataset loading', () => {
  it('DATA-1: a valid dataset loads with the exact dataset SHA, count, and repos', () => {
    const repos = [repo('a'), repo('b')];
    const { starsBytes, metaText, datasetSha256 } = makeDataset(repos);
    const dataset = loadCanonicalDataset(starsBytes, metaText);
    expect(dataset.repos).toHaveLength(2);
    expect(dataset.datasetSha256).toBe(datasetSha256);
    expect(dataset.meta.stars_sha256).toBe(datasetSha256);
    expect(dataset.meta.repo_count).toBe(2);
  });

  it('DATA-2: a stars_sha256 mismatch is rejected (no dataset, no manifest)', () => {
    const { starsBytes, metaText } = makeDataset([repo('a')]);
    const tampered = metaText.replace(
      /"stars_sha256": "[0-9a-f]{64}"/,
      `"stars_sha256": "${'0'.repeat(64)}"`,
    );
    expect(() => loadCanonicalDataset(starsBytes, tampered)).toThrow(DatasetError);
  });

  it('DATA-2: a repo_count mismatch is rejected', () => {
    const { starsBytes, metaText } = makeDataset([repo('a'), repo('b')]);
    const tampered = metaText.replace('"repo_count": 2', '"repo_count": 3');
    expect(() => loadCanonicalDataset(starsBytes, tampered)).toThrow(/repo_count/);
  });

  it('DATA-2: a schema-invalid canonical identity is rejected', () => {
    const { metaText } = makeDataset([repo('a')]);
    const badStars =
      JSON.stringify({ schema_version: '1.0', repos: [{ node_id: '' }] }, null, 2) + '\n';
    expect(() => loadCanonicalDataset(Buffer.from(badStars, 'utf8'), metaText)).toThrow(
      DatasetError,
    );
  });

  it('DATA-2: a duplicate node_id is rejected', () => {
    const dup = repo('a');
    const { starsBytes, metaText } = makeDataset([dup, { ...dup }]);
    expect(() => loadCanonicalDataset(starsBytes, metaText)).toThrow(/duplicate node_id/);
  });

  it('DATA-2: non-JSON input is rejected', () => {
    expect(() => loadCanonicalDataset(Buffer.from('{not json', 'utf8'), '{}')).toThrow(
      DatasetError,
    );
  });
});

/**
 * CLASSIFIER ACCEPTANCE IS A BYTE CONTRACT (round-9 owner ruling, closing the
 * fifth/sixth surfaces of the decoded-text digest class).
 *
 * The trap is deliberately NOT a BOM: a literal U+FFFD's three UTF-8 bytes are
 * replaced by a bare 0xFF, which a decoder maps straight back to U+FFFD — so
 * `hash(decode(bytes))` matches while the bytes differ. Under the old text
 * hash the classifier ACCEPTED such a dataset and would happily classify
 * against a file the byte-strict deployed runtime refuses to load.
 */
describe('canonical dataset acceptance is a BYTE contract', () => {
  function fixtureWithReplacementChar(): { canonical: Buffer; metaText: string } {
    const repos = [repo('a', { description: 'contains \uFFFD replacement' })];
    const { starsText, metaText, datasetSha256 } = makeDataset(repos);
    // makeDataset's digest is generation-side over starsText, which equals the
    // byte digest of its UTF-8 encoding — the control below proves that.
    expect(metaText).toContain(datasetSha256);
    return { canonical: Buffer.from(starsText, 'utf8'), metaText };
  }

  it('CONTROL: the unmutated bytes load', () => {
    const { canonical, metaText } = fixtureWithReplacementChar();
    expect(loadCanonicalDataset(canonical, metaText).repos).toHaveLength(1);
  });

  it('BYTES: a byte mutation that decodes to identical text is REJECTED', () => {
    const { canonical, metaText } = fixtureWithReplacementChar();
    const at = canonical.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      canonical.subarray(0, at),
      Buffer.from([0xff]),
      canonical.subarray(at + 3),
    ]);
    // Preconditions of the trap: bytes differ, decoded text does not.
    expect(mutated.equals(canonical)).toBe(false);
    expect(mutated.toString('utf8')).toBe(canonical.toString('utf8'));

    expect(() => loadCanonicalDataset(mutated, metaText)).toThrow(
      /stars_sha256 does not match stars\.json bytes/,
    );
  });
});
