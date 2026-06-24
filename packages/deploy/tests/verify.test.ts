import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFixtureDataset } from '../src/fixture';
import { stageDashboardData } from '../src/stage';
import { staticSmoke, verifyBuiltArtifact } from '../src/verify';

function builtDist(base = '/repo/') {
  const root = mkdtempSync(join(tmpdir(), 'verify-'));
  const dataDir = join(root, 'data');
  const distDir = join(root, 'dist');
  mkdirSync(dataDir);
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'assets', 'index-abc.js'), 'console.log(1)\n');
  writeFileSync(
    join(distDir, 'index.html'),
    `<!doctype html><html><head><script type="module" src="${base}assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`,
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
});
