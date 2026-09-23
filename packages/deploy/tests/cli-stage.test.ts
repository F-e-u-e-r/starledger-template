import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SKILLS_CLASSIFICATION_FILE,
  SKILLS_CLASSIFICATION_META_FILE,
  SKILLS_SOURCE_FILE,
  STARS_FILE,
} from '../src/stage';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * CLI-level staging regression (review finding K7): the direct
 * stageSkillsArtifacts tests cannot see whether cli.ts actually CALLS it —
 * deleting the wiring would leave them green. This drives the real `stage`
 * command against the repo's own committed data (stars + the M2.2 artifacts)
 * and asserts the skills pair lands in the dist with its log line.
 */
describe.skipIf(!existsSync(join(root, SKILLS_CLASSIFICATION_FILE)))(
  'deploy CLI stage command — skills wiring',
  () => {
    it('K7: `stage` stages the skills pair and reports it', () => {
      const dist = mkdtempSync(join(tmpdir(), 'deploy-cli-dist-'));
      try {
        const stdout = execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            'packages/deploy/src/cli.ts',
            'stage',
            '--dist',
            dist,
            '--data',
            root,
          ],
          { cwd: root, encoding: 'utf8' },
        );
        expect(stdout).toContain('Skills-classification artifacts: staged');
        // §4.12 download wiring: the vendored source ships beside the pair it
        // produced (the committed repo state IS the hash-coherent steady state).
        expect(stdout).toContain('Skills source document: staged');
        expect(existsSync(join(dist, STARS_FILE))).toBe(true);
        expect(existsSync(join(dist, SKILLS_CLASSIFICATION_FILE))).toBe(true);
        expect(existsSync(join(dist, SKILLS_CLASSIFICATION_META_FILE))).toBe(true);
        expect(existsSync(join(dist, SKILLS_SOURCE_FILE))).toBe(true);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });

    it('K7b: a skills-less dataDir stays FAIL-SOFT through the real CLI — exit 0, named skip lines, canonical deploy proceeds (pre-commit R1 sol: a mutant escalating a mere skip must fail here)', () => {
      const dist = mkdtempSync(join(tmpdir(), 'deploy-cli-dist-'));
      const data = mkdtempSync(join(tmpdir(), 'deploy-cli-data-'));
      try {
        // A valid canonical dataset with NO optional artifacts at all.
        execFileSync(
          process.execPath,
          ['--import', 'tsx', 'packages/deploy/src/cli.ts', 'fixture', '--out', data],
          { cwd: root, encoding: 'utf8' },
        );
        // exit != 0 would throw here — the skip must never block the deploy
        const stdout = execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            'packages/deploy/src/cli.ts',
            'stage',
            '--dist',
            dist,
            '--data',
            data,
          ],
          { cwd: root, encoding: 'utf8' },
        );
        expect(stdout).toContain('Skills-classification artifacts: skipped');
        expect(stdout).toContain('Skills source document: skipped');
        expect(existsSync(join(dist, STARS_FILE))).toBe(true); // canonical deploy proceeded
        expect(existsSync(join(dist, SKILLS_SOURCE_FILE))).toBe(false);
      } finally {
        rmSync(dist, { recursive: true, force: true });
        rmSync(data, { recursive: true, force: true });
      }
    });
  },
);
