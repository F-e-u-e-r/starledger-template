import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFixtureDataset } from '../src/fixture';
import { DATASET_META_FILE, STARS_FILE, stageDashboardData } from '../src/stage';
import { staticSmoke, verifyBuiltArtifact } from '../src/verify';

// Mirror the production index.html CSP meta so the fixture exercises SEC-B.
const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'\" />";

function builtDist(base = '/repo/') {
  const root = mkdtempSync(join(tmpdir(), 'verify-'));
  const dataDir = join(root, 'data');
  const distDir = join(root, 'dist');
  mkdirSync(dataDir);
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)\n');
  writeFileSync(
    join(distDir, 'index.html'),
    `<!doctype html><html><head>${CSP_META}<script type="module" src="${base}assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`,
  );
  writeFixtureDataset(dataDir);
  stageDashboardData({ dataDir, distDir });
  return { distDir, base };
}

describe('verifyBuiltArtifact / staticSmoke (DEPLOY-1/2, PATH-2)', () => {
  it('DEPLOY-1: a well-formed staged dist verifies under its base path', () => {
    const { distDir, base } = builtDist();
    const r = verifyBuiltArtifact({ distDir, base });
    expect(r.repoCount).toBe(1);
    expect(r.base).toBe(base);
  });

  it('PATH-2: assets that are not under the base path are rejected', () => {
    const { distDir } = builtDist('/'); // index references root-absolute /assets/...
    expect(() => verifyBuiltArtifact({ distDir, base: '/repo/' })).toThrow(/base/);
  });

  it('rejects a dist that is missing the staged data', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-'));
    const distDir = join(root, 'dist');
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'a.js'), 'x');
    writeFileSync(join(distDir, 'index.html'), '<script src="/assets/a.js"></script>');
    expect(() => verifyBuiltArtifact({ distDir })).toThrow(/staged data/);
  });

  it('DEPLOY-2: data + assets resolve over a static server at the base path', async () => {
    const { distDir, base } = builtDist();
    const r = await staticSmoke({ distDir, base });
    expect(r.repoCount).toBe(1);
  });

  it('SEC-B: a built dist whose index.html dropped the CSP meta is rejected', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-'));
    const dataDir = join(root, 'data');
    const distDir = join(root, 'dist');
    mkdirSync(dataDir);
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)\n');
    // Same well-formed dist as builtDist(), but WITHOUT the CSP meta.
    writeFileSync(
      join(distDir, 'index.html'),
      '<!doctype html><html><head><script type="module" src="/repo/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>',
    );
    writeFixtureDataset(dataDir);
    stageDashboardData({ dataDir, distDir });
    expect(() => verifyBuiltArtifact({ distDir, base: '/repo/' })).toThrow(
      /Content-Security-Policy/,
    );
  });

  it('SEC-B: a CSP that reintroduces the meta-ineffective frame-ancestors is rejected', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-'));
    const dataDir = join(root, 'data');
    const distDir = join(root, 'dist');
    mkdirSync(dataDir);
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)\n');
    const cspWithFrameAncestors =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; frame-ancestors 'none'\" />";
    writeFileSync(
      join(distDir, 'index.html'),
      `<!doctype html><html><head>${cspWithFrameAncestors}<script type="module" src="/repo/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`,
    );
    writeFixtureDataset(dataDir);
    stageDashboardData({ dataDir, distDir });
    expect(() => verifyBuiltArtifact({ distDir, base: '/repo/' })).toThrow(/frame-ancestors/);
  });

  it('SEC-B: a commented-out CSP meta is rejected (the browser does not enforce it)', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-'));
    const dataDir = join(root, 'data');
    const distDir = join(root, 'dist');
    mkdirSync(dataDir);
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)\n');
    // Well-formed except the CSP meta is commented out — an inert, unenforced policy.
    writeFileSync(
      join(distDir, 'index.html'),
      `<!doctype html><html><head><!-- ${CSP_META} --><script type="module" src="/repo/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`,
    );
    writeFixtureDataset(dataDir);
    stageDashboardData({ dataDir, distDir });
    expect(() => verifyBuiltArtifact({ distDir, base: '/repo/' })).toThrow(
      /Content-Security-Policy/,
    );
  });

  it('SEC-B: directives cannot be borrowed from a later meta tag (split-tag bypass)', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-'));
    const dataDir = join(root, 'data');
    const distDir = join(root, 'dist');
    mkdirSync(dataDir);
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)\n');
    // The CSP meta itself has NO content; a later decoy meta carries directives.
    // The browser enforces nothing from the empty CSP meta, so this must fail.
    const splitTag =
      '<meta http-equiv="Content-Security-Policy"><meta name="decoy" content="default-src \'none\'; script-src \'self\'" />';
    writeFileSync(
      join(distDir, 'index.html'),
      `<!doctype html><html><head>${splitTag}<script type="module" src="/repo/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`,
    );
    writeFixtureDataset(dataDir);
    stageDashboardData({ dataDir, distDir });
    expect(() => verifyBuiltArtifact({ distDir, base: '/repo/' })).toThrow(/content attribute/);
  });

  // Build a staged dist whose <head> contains exactly `headHtml`, for CSP tests.
  function distWithHead(headHtml: string): string {
    const root = mkdtempSync(join(tmpdir(), 'verify-'));
    const dataDir = join(root, 'data');
    const distDir = join(root, 'dist');
    mkdirSync(dataDir);
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)\n');
    writeFileSync(
      join(distDir, 'index.html'),
      `<!doctype html><html><head>${headHtml}<script type="module" src="/repo/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`,
    );
    writeFixtureDataset(dataDir);
    stageDashboardData({ dataDir, distDir });
    return distDir;
  }

  it('SEC-B: a non-enforcing Content-Security-Policy-Report-Only meta is rejected', () => {
    const reportOnly = CSP_META.replace(
      'http-equiv="Content-Security-Policy"',
      'http-equiv="Content-Security-Policy-Report-Only"',
    );
    expect(() =>
      verifyBuiltArtifact({ distDir: distWithHead(reportOnly), base: '/repo/' }),
    ).toThrow(/enforcing Content-Security-Policy/);
  });

  it("SEC-B: a weakened script-src (adds 'unsafe-inline') is rejected", () => {
    const weakened = CSP_META.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    expect(() => verifyBuiltArtifact({ distDir: distWithHead(weakened), base: '/repo/' })).toThrow(
      /unsafe-inline/,
    );
  });

  it('SEC-B: decoy data-* attributes do not satisfy the CSP check', () => {
    const decoy = CSP_META.replace('http-equiv=', 'data-http-equiv=').replace(
      'content=',
      'data-content=',
    );
    expect(() => verifyBuiltArtifact({ distDir: distWithHead(decoy), base: '/repo/' })).toThrow(
      /enforcing Content-Security-Policy/,
    );
  });

  it('SEC-B: a duplicate directive (weakened first, pinned second) is rejected', () => {
    const dup = CSP_META.replace(
      "script-src 'self'",
      "script-src 'self' 'unsafe-inline'; script-src 'self'",
    );
    expect(() => verifyBuiltArtifact({ distDir: distWithHead(dup), base: '/repo/' })).toThrow(
      /duplicate "script-src"/,
    );
  });
});

/**
 * BYTE CONTRACT AT THE VERIFICATION BOUNDARY (review finding).
 *
 * `verifyBuiltArtifact` is a third call site of the canonical byte contract,
 * alongside staging and the shared helper. Its own tests used ordinary UTF-8
 * fixtures only, so replacing its call with decoded-text hashing would have
 * passed them all. The trap is the decode-invariant one: a literal U+FFFD's
 * bytes replaced by a bare 0xFF decodes identically and only the bytes differ.
 */
describe('verifyBuiltArtifact enforces the byte contract at its own call site', () => {
  function distWithReplacementChar(): { distDir: string; canonical: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), 'verify-bytes-'));
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1);');
    writeFileSync(
      join(dir, 'index.html'),
      `<html><head>${CSP_META}</head><body><script type="module" src="/assets/index-abc123.js"></script></body></html>`,
    );
    const src = mkdtempSync(join(tmpdir(), 'verify-bytes-src-'));
    writeFixtureDataset(src, new Date('2026-06-19T00:00:00Z'));
    const stars = JSON.parse(readFileSync(join(src, STARS_FILE), 'utf8')) as {
      repos: { description: string | null }[];
    };
    stars.repos[0]!.description = 'contains \uFFFD replacement';
    const canonical = Buffer.from(JSON.stringify(stars, null, 2) + '\n', 'utf8');
    const meta = JSON.parse(readFileSync(join(src, DATASET_META_FILE), 'utf8')) as Record<
      string,
      unknown
    >;
    meta.stars_sha256 = createHash('sha256').update(canonical).digest('hex');
    writeFileSync(join(dir, DATASET_META_FILE), JSON.stringify(meta, null, 2) + '\n');
    return { distDir: dir, canonical };
  }

  it('CONTROL: a dist whose bytes match the digest verifies', () => {
    const { distDir, canonical } = distWithReplacementChar();
    writeFileSync(join(distDir, STARS_FILE), canonical);
    expect(() => verifyBuiltArtifact({ distDir, base: '/' })).not.toThrow();
  });

  it('rejects a byte mutation that decodes to identical text', () => {
    const { distDir, canonical } = distWithReplacementChar();
    const at = canonical.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      canonical.subarray(0, at),
      Buffer.from([0xff]),
      canonical.subarray(at + 3),
    ]);
    expect(mutated.toString('utf8')).toBe(canonical.toString('utf8'));
    writeFileSync(join(distDir, STARS_FILE), mutated);
    expect(() => verifyBuiltArtifact({ distDir, base: '/' })).toThrow();
  });
});
