import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTemplate } from '../src/build';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'starledger-tpl-'));
  dirs.push(d);
  return d;
}
function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const SYNC_STARS = `name: Sync stars
on:
  schedule:
    - cron: '23 5 * * *'
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
`;

/** A miniature repo tree exercising every allowlist rule. */
function fixtureRepo(): string {
  const src = tmp();
  write(src, 'README.template.md', '# StarLedger (template)\n');
  write(src, 'README.md', '# StarLedger (personal)\n'); // must NOT ship
  write(src, 'stars.json', '{"repos":[]}'); // must NOT ship
  write(src, 'dataset-meta.json', '{"repo_count":0}'); // must NOT ship
  write(src, 'config.example.yaml', '# exporter example\n');
  write(src, 'config/ai.example.yaml', '# ai example\n');
  write(src, 'config/ai.yaml', 'ai:\n  enabled: true\n'); // must NOT ship
  write(src, 'LICENSE', 'license\n');
  write(src, 'packages/foo/src/index.ts', 'export const x = 1;\n');
  write(src, 'packages/foo/dist/index.js', 'module.exports={}'); // must NOT ship
  write(src, '.github/workflows/ci.yml', 'name: CI\non:\n  pull_request:\n');
  write(src, '.github/workflows/sync-stars.yml', SYNC_STARS);
  write(src, '.github/workflows/ai-state.yml', SYNC_STARS.replace('Sync stars', 'AI state'));
  return src;
}

describe('buildTemplate', () => {
  it('ships the allowlist and excludes personal/generated files', () => {
    const src = fixtureRepo();
    const out = tmp();
    const m = buildTemplate({ srcRoot: src, outDir: out });

    // README swap: template content lands as README.md; neither personal file ships.
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toBe('# StarLedger (template)\n');
    expect(existsSync(join(out, 'README.template.md'))).toBe(false);

    // Personal data + live config excluded.
    for (const gone of [
      'stars.json',
      'dataset-meta.json',
      'config/ai.yaml',
      'packages/foo/dist/index.js',
    ]) {
      expect(existsSync(join(out, gone))).toBe(false);
    }
    // Reusable code + examples shipped.
    for (const kept of [
      'config.example.yaml',
      'config/ai.example.yaml',
      'packages/foo/src/index.ts',
      'LICENSE',
    ]) {
      expect(existsSync(join(out, kept))).toBe(true);
    }

    expect(m.copied).toContain('README.md');
    expect(m.skipped).toContain(join('config', 'ai.yaml'));
  });

  it('emits scheduled workflows as dispatch-only', () => {
    const src = fixtureRepo();
    const out = tmp();
    const m = buildTemplate({ srcRoot: src, outDir: out });

    const sync = readFileSync(join(out, '.github/workflows/sync-stars.yml'), 'utf8');
    expect(/^ {2}schedule:/m.test(sync)).toBe(false);
    expect(sync.includes('workflow_dispatch:')).toBe(true);
    expect(m.transformed).toContain(join('.github', 'workflows', 'sync-stars.yml'));

    const aiState = readFileSync(join(out, '.github/workflows/ai-state.yml'), 'utf8');
    expect(/^ {2}schedule:/m.test(aiState)).toBe(false);
    expect(m.transformed).toContain(join('.github', 'workflows', 'ai-state.yml'));

    // ci.yml has no schedule and is copied verbatim.
    expect(readFileSync(join(out, '.github/workflows/ci.yml'), 'utf8')).toBe(
      'name: CI\non:\n  pull_request:\n',
    );
  });

  it('dry-run writes nothing but reports the manifest', () => {
    const src = fixtureRepo();
    const out = tmp();
    const m = buildTemplate({ srcRoot: src, outDir: out, dryRun: true });
    expect(m.copied.length).toBeGreaterThan(0);
    expect(existsSync(join(out, 'README.md'))).toBe(false);
  });

  it('throws without README.template.md', () => {
    const src = tmp();
    write(src, 'LICENSE', 'x\n');
    expect(() => buildTemplate({ srcRoot: src, outDir: tmp() })).toThrow(/README\.template\.md/);
  });
});
