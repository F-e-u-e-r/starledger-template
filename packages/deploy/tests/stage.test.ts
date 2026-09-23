import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFixtureDataset } from '../src/fixture';
import { DATASET_META_FILE, STARS_FILE, stageDashboardData } from '../src/stage';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  const dataDir = join(root, 'data');
  const distDir = join(root, 'dist');
  mkdirSync(dataDir);
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<html></html>');
  return { dataDir, distDir };
}

describe('stageDashboardData (BUILD-DATA-1/3, DEPLOY-3/4)', () => {
  it('copies validated data into dist', () => {
    const { dataDir, distDir } = setup();
    writeFixtureDataset(dataDir);
    const r = stageDashboardData({ dataDir, distDir });
    expect(r.repoCount).toBe(1);
    expect(existsSync(join(distDir, STARS_FILE))).toBe(true);
    expect(existsSync(join(distDir, DATASET_META_FILE))).toBe(true);
  });

  it('BUILD-DATA-3: refuses to ship a run-meta.json (telemetry) in the artifact', () => {
    const { dataDir, distDir } = setup();
    writeFixtureDataset(dataDir);
    writeFileSync(join(distDir, 'run-meta.json'), '{}');
    expect(() => stageDashboardData({ dataDir, distDir })).toThrow(/forbidden/);
    // the forbidden check runs before any copy, so no data was staged
    expect(existsSync(join(distDir, STARS_FILE))).toBe(false);
  });

  it('DEPLOY-3/4: invalid data throws before copying — dist is left untouched', () => {
    const { dataDir, distDir } = setup();
    writeFixtureDataset(dataDir);
    const metaPath = join(dataDir, DATASET_META_FILE);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    meta.repo_count = 5; // integrity now broken
    writeFileSync(metaPath, JSON.stringify(meta));
    expect(() => stageDashboardData({ dataDir, distDir })).toThrow();
    expect(existsSync(join(distDir, STARS_FILE))).toBe(false);
  });

  it('throws when the canonical data is missing', () => {
    const { dataDir, distDir } = setup();
    expect(() => stageDashboardData({ dataDir, distDir })).toThrow(/canonical data not found/);
  });
});

/**
 * Round-6 finding (High, evidence): the canonical byte-contract regression
 * tested `verifyDatasetIntegrity` DIRECTLY and never its staging call site.
 * Review reproduced the gap by making `stageDashboardData` decode and re-encode
 * before calling the verifier — malformed raw bytes were accepted again and a
 * body whose raw digest did not match meta was published, while every dataset
 * test stayed green. A guarantee is only as good as the level it is pinned at.
 */
describe('stageDashboardData enforces the BYTE contract at its own call site', () => {
  function fixtureWithReplacementChar(dataDir: string): { canonical: Buffer; metaText: string } {
    writeFixtureDataset(dataDir, new Date('2026-06-19T00:00:00Z'));
    const stars = JSON.parse(readFileSync(join(dataDir, STARS_FILE), 'utf8')) as {
      repos: { description: string | null }[];
    };
    stars.repos[0]!.description = 'contains \uFFFD replacement';
    const canonical = Buffer.from(JSON.stringify(stars, null, 2) + '\n', 'utf8');
    const meta = JSON.parse(readFileSync(join(dataDir, DATASET_META_FILE), 'utf8')) as Record<
      string,
      unknown
    >;
    meta.stars_sha256 = createHash('sha256').update(canonical).digest('hex');
    const metaText = JSON.stringify(meta, null, 2) + '\n';
    writeFileSync(join(dataDir, DATASET_META_FILE), metaText);
    return { canonical, metaText };
  }

  it('SNAPSHOT: a source rewritten between validation and publication cannot reach the dist', () => {
    const { dataDir, distDir } = setup();
    const { canonical } = fixtureWithReplacementChar(dataDir);
    writeFileSync(join(dataDir, STARS_FILE), canonical);
    const sneaky = Buffer.from(canonical.toString('utf8').replace('contains', 'REWRITTEN'), 'utf8');
    expect(sneaky.equals(canonical)).toBe(false);

    // A correct implementation neither throws NOR publishes the rewrite. Both
    // halves are asserted: a re-opening implementation trips the structural
    // guard and throws, so without the first assertion the mutant would kill
    // this test by an uncaught error rather than by anything it claims to
    // check — red for a reason the test never asserted (review finding).
    expect(() =>
      stageDashboardData(
        { dataDir, distDir },
        {
          // A generator replacing the source after it was validated.
          beforePublish: () => writeFileSync(join(dataDir, STARS_FILE), sneaky),
        },
      ),
    ).not.toThrow();

    expect(readFileSync(join(distDir, STARS_FILE)).equals(canonical)).toBe(true);
  });

  it('GUARD: the post-publish digest check actually fires on a mismatch', () => {
    // The structural guard exists because any implementation-invoked seam can
    // be defeated by re-reading just before it. A detector nobody has watched
    // fire is not evidence, so drive it: corrupt what landed, and staging must
    // refuse rather than report success.
    const { dataDir, distDir } = setup();
    const { canonical } = fixtureWithReplacementChar(dataDir);
    writeFileSync(join(dataDir, STARS_FILE), canonical);
    expect(() =>
      stageDashboardData(
        { dataDir, distDir },
        { afterPublish: () => writeFileSync(join(distDir, STARS_FILE), 'CORRUPTED AFTER WRITE') },
      ),
    ).toThrow(/does not match the verified digest/);
  });

  it('GUARD-META: a canonical meta rewritten after publish is refused (read-back, both halves)', () => {
    // The canonical meta carries no self-digest (its dataset_generated_at is
    // legitimately different each run), so its guard is a read-back against
    // THIS invocation's validated snapshot. A rewrite that keeps the correct
    // stars_sha256 leaves the pair internally coherent — no digest can catch
    // it, only the read-back. Every pair's guard must cover BOTH halves.
    const { dataDir, distDir } = setup();
    const { canonical, metaText } = fixtureWithReplacementChar(dataDir);
    writeFileSync(join(dataDir, STARS_FILE), canonical);
    const rewritten = metaText.replace('2026-06-19T00:00:00', '2027-01-01T00:00:00');
    expect(rewritten).not.toBe(metaText);
    expect(() =>
      stageDashboardData(
        { dataDir, distDir },
        {
          afterPublish: () => writeFileSync(join(distDir, DATASET_META_FILE), rewritten),
        },
      ),
    ).toThrow(/does not match the validated bytes/);
  });

  it('BYTES-META: the published canonical meta is the source file EXACT bytes, never a re-encoding', () => {
    // Round-9 finding (luna@ultra, author-reproduced): the canonical meta was
    // decoded to text and re-encoded on publish, so a malformed byte inside an
    // unconstrained string field (dataset_generated_at is z.string()) was
    // silently NORMALIZED to U+FFFD — the landed file differed from the source
    // while the read-back compared against the same normalized snapshot and
    // reported success. Owner charter question I says BOTH halves must be the
    // exact validated bytes of THIS invocation: publish the source bytes.
    const { dataDir, distDir } = setup();
    writeFixtureDataset(dataDir, new Date('2026-06-19T00:00:00Z'));
    const metaPath = join(dataDir, DATASET_META_FILE);
    const clean = readFileSync(metaPath);
    const at = clean.indexOf(Buffer.from('"dataset_generated_at": "', 'utf8')) + 25;
    expect(at).toBeGreaterThan(24);
    const source = Buffer.concat([clean.subarray(0, at), Buffer.from([0xff]), clean.subarray(at)]);
    writeFileSync(metaPath, source);
    stageDashboardData({ dataDir, distDir });
    expect(readFileSync(join(distDir, DATASET_META_FILE)).equals(source)).toBe(true);
  });

  it('CONTROL: the unmutated bytes stage, and the PUBLISHED bytes are the validated ones', () => {
    const { dataDir, distDir } = setup();
    const { canonical } = fixtureWithReplacementChar(dataDir);
    writeFileSync(join(dataDir, STARS_FILE), canonical);
    stageDashboardData({ dataDir, distDir });
    expect(readFileSync(join(distDir, STARS_FILE)).equals(canonical)).toBe(true);
  });

  it('throws on a byte mutation that decodes to identical text', () => {
    const { dataDir, distDir } = setup();
    const { canonical } = fixtureWithReplacementChar(dataDir);
    const at = canonical.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      canonical.subarray(0, at),
      Buffer.from([0xff]),
      canonical.subarray(at + 3),
    ]);
    expect(mutated.equals(canonical)).toBe(false);
    expect(mutated.toString('utf8')).toBe(canonical.toString('utf8'));

    writeFileSync(join(dataDir, STARS_FILE), mutated);
    expect(() => stageDashboardData({ dataDir, distDir })).toThrow();
    expect(existsSync(join(distDir, STARS_FILE))).toBe(false);
  });
});
