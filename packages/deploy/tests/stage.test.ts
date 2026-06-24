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
