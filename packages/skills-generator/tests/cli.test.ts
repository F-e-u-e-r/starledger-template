import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/hash';
import { FIXTURE_STARS, makeSourceText, makeStarsText } from './helpers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliRun {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'packages/skills-generator/src/cli.ts', ...args],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failed.status ?? 1,
      stdout: failed.stdout?.toString() ?? '',
      stderr: failed.stderr?.toString() ?? '',
    };
  }
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'starledger-skills-cli-'));
}

function seed(dir: string): { source: string; stars: string } {
  const source = join(dir, 'skills-classified.md');
  const stars = join(dir, 'stars.json');
  writeFileSync(source, makeSourceText(), 'utf8');
  writeFileSync(stars, makeStarsText(FIXTURE_STARS), 'utf8');
  return { source, stars };
}

function baseArgs(dir: string, source: string, stars: string): string[] {
  return [
    '--source',
    source,
    '--stars',
    stars,
    '--aliases',
    join(dir, 'skills-aliases.json'),
    '--prior',
    join(dir, 'skills-classification.json'),
    '--out-dir',
    dir,
  ];
}

describe('CLI prior-input modes (owner gate 4 — wiring, not just the library)', () => {
  it('first generation: absent prior ⇒ success with null lineage', () => {
    const dir = makeDir();
    try {
      const { source, stars } = seed(dir);
      const run = runCli(baseArgs(dir, source, stars));
      expect(run.status).toBe(0);
      const meta = JSON.parse(readFileSync(join(dir, 'skills-classification-meta.json'), 'utf8'));
      expect(meta.prior_classification_sha256).toBeNull();
      expect(run.stdout).toContain('none consumed (null)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a consumed prior is lineage-bearing; --regenerate-without-prior explicitly records null', () => {
    const dir = makeDir();
    try {
      const { source, stars } = seed(dir);
      expect(runCli(baseArgs(dir, source, stars)).status).toBe(0);
      const priorBytes = readFileSync(join(dir, 'skills-classification.json'), 'utf8');

      const second = runCli(baseArgs(dir, source, stars));
      expect(second.status).toBe(0);
      const consumedMeta = JSON.parse(
        readFileSync(join(dir, 'skills-classification-meta.json'), 'utf8'),
      );
      expect(consumedMeta.prior_classification_sha256).toBe(sha256(priorBytes));

      const third = runCli([...baseArgs(dir, source, stars), '--regenerate-without-prior']);
      expect(third.status).toBe(0);
      const bypassMeta = JSON.parse(
        readFileSync(join(dir, 'skills-classification-meta.json'), 'utf8'),
      );
      expect(bypassMeta.prior_classification_sha256).toBeNull();
      expect(third.stdout).toContain('none consumed (null)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GATE-4: a prior that exists but cannot be read is FATAL, never a silent no-prior fallback', () => {
    const dir = makeDir();
    try {
      const { source, stars } = seed(dir);
      // A directory at the prior path: read fails with EISDIR (not ENOENT) on
      // every platform — the "exists but unreadable" class.
      mkdirSync(join(dir, 'skills-classification.json'));
      const run = runCli(baseArgs(dir, source, stars));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('refusing to continue');
      expect(existsSync(join(dir, 'skills-classification-meta.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GATE-4 edge: a DANGLING SYMLINK prior is fatal, not a silent first generation', () => {
    const dir = makeDir();
    try {
      const { source, stars } = seed(dir);
      symlinkSync(join(dir, 'no-such-target.json'), join(dir, 'skills-classification.json'));
      const run = runCli(baseArgs(dir, source, stars));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('refusing to continue');
      expect(existsSync(join(dir, 'skills-classification-meta.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a prior failing the current schema fails loudly with the §4.6 escape named', () => {
    const dir = makeDir();
    try {
      const { source, stars } = seed(dir);
      writeFileSync(join(dir, 'skills-classification.json'), '{"schema_version":"0.1"}', 'utf8');
      const run = runCli(baseArgs(dir, source, stars));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('regenerate-without-prior');
      expect(existsSync(join(dir, 'skills-classification-meta.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--dry-run validates fully but writes nothing', () => {
    const dir = makeDir();
    try {
      const { source, stars } = seed(dir);
      const run = runCli([...baseArgs(dir, source, stars), '--dry-run']);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('dry-run');
      expect(existsSync(join(dir, 'skills-classification.json'))).toBe(false);
      expect(existsSync(join(dir, 'skills-classification-meta.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
