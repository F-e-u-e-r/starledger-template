import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatasetIntegrityError, sha256Hex, verifyDatasetIntegrity } from '../src/dataset';
import { writeFixtureDataset } from '../src/fixture';
import { DATASET_META_FILE, STARS_FILE } from '../src/stage';

/** The verifier takes BYTES; the digest is generated over bytes, not text. */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

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
    const r = verifyDatasetIntegrity(utf8(starsText), metaText);
    expect(r.meta.repo_count).toBe(1);
    expect(r.stars.repos).toHaveLength(1);
    expect(r.sha256).toBe(sha256Hex(starsText));
  });

  it('BUILD-DATA-2: a stars/meta hash mismatch is rejected', () => {
    const { starsText, metaText } = fixtureTexts();
    const tampered = starsText.replace('octo/one', 'octo/two'); // bytes change → stale sha
    expect(() => verifyDatasetIntegrity(utf8(tampered), metaText)).toThrow(DatasetIntegrityError);
  });

  it('rejects a repo_count mismatch', () => {
    const { starsText, metaText } = fixtureTexts();
    const meta = JSON.parse(metaText) as Record<string, unknown>;
    meta.repo_count = 99;
    expect(() => verifyDatasetIntegrity(utf8(starsText), JSON.stringify(meta))).toThrow(
      /repo_count/,
    );
  });

  it('rejects a duplicated node_id (build side of the shared invariant)', () => {
    // The runtime pins this at its own boundary; without a BUILD-side pin a
    // call-site mutation consuming only the count problem would pass the whole
    // deploy suite (review finding).
    const { starsText, metaText } = fixtureTexts();
    const stars = JSON.parse(starsText) as { repos: Record<string, unknown>[] };
    stars.repos.push({ ...stars.repos[0] });
    const dupText = JSON.stringify(stars, null, 2) + '\n';
    const meta = JSON.parse(metaText) as Record<string, unknown>;
    meta.stars_sha256 = createHash('sha256').update(Buffer.from(dupText, 'utf8')).digest('hex');
    meta.repo_count = stars.repos.length; // count is CORRECT — only the id repeats
    expect(() => verifyDatasetIntegrity(utf8(dupText), JSON.stringify(meta))).toThrow(
      /duplicate node_id/,
    );
  });

  it('rejects malformed JSON and schema-invalid data', () => {
    expect(() => verifyDatasetIntegrity(utf8('{not json'), '{}')).toThrow(DatasetIntegrityError);
    const { starsText } = fixtureTexts();
    expect(() => verifyDatasetIntegrity(utf8(starsText), '{"schema_version":"1.0"}')).toThrow(
      /schema/,
    );
  });
});

describe('verifyDatasetIntegrity is a BYTE contract (round-5 finding)', () => {
  /**
   * The canonical digest is generated over stars.json's BYTES, and the runtime
   * loader now verifies it that way. If the build hashed decoded text instead,
   * a byte mutation that decodes identically would pass the build and then be
   * REJECTED at runtime — and because stars is the canonical dataset, that
   * means the base dashboard fails closed on a file the build called sound.
   *
   * The trap is a literal U+FFFD whose three UTF-8 bytes are replaced by a bare
   * 0xFF: a decoder maps that straight back to U+FFFD, so the text is identical
   * and only the bytes differ. (A BOM would not work here — unlike the web
   * `Response.text()`, Node's utf8 decode keeps it.)
   */
  it('rejects a byte mutation that decodes to identical text', () => {
    const { starsText, metaText } = fixtureTexts();
    const stars = JSON.parse(starsText) as { repos: { description: string | null }[] };
    stars.repos[0]!.description = 'contains � replacement';
    const canonicalText = JSON.stringify(stars, null, 2) + '\n';
    const canonicalBytes = Buffer.from(canonicalText, 'utf8');

    const meta = JSON.parse(metaText) as Record<string, unknown>;
    meta.stars_sha256 = createHash('sha256').update(canonicalBytes).digest('hex');
    const meta2 = JSON.stringify(meta);

    // Control: the untouched bytes verify, so the trap below cannot pass for a
    // fixture reason.
    expect(() => verifyDatasetIntegrity(canonicalBytes, meta2)).not.toThrow();

    const at = canonicalBytes.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      canonicalBytes.subarray(0, at),
      Buffer.from([0xff]),
      canonicalBytes.subarray(at + 3),
    ]);
    // Preconditions: bytes differ, decoded text does not.
    expect(mutated.equals(canonicalBytes)).toBe(false);
    expect(mutated.toString('utf8')).toBe(canonicalText);

    expect(() => verifyDatasetIntegrity(mutated, meta2)).toThrow(DatasetIntegrityError);
  });
});
