import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * OPERATOR-FACING ACCEPTANCE IS A BYTE CONTRACT (round-9 owner ruling, closing
 * the sixth surface of the decoded-text digest class). `stars-discover verify`
 * tells an operator whether the on-disk pair is sound; under the old
 * decoded-text hash it called "Valid" a byte-corrupted artifact that the
 * byte-strict deploy stager and runtime loader then refuse — the exact
 * build/runtime divergence this project keeps re-closing. The trap is the
 * usual one: a literal U+FFFD's three UTF-8 bytes swapped for a bare 0xFF
 * decode back to identical text.
 *
 * Subprocess-driven: the check lives inline in the CLI action, so the pin
 * exercises the real command, exit code and message included.
 */
function runVerify(dir: string): { status: number; output: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'packages/discovery/src/cli.ts', 'verify', '--dir', dir],
      { cwd: root, encoding: 'utf8' },
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function fixturePair(): { candidatesBytes: Buffer; meta: string } {
  const candidatesText =
    JSON.stringify(
      {
        schema_version: 1,
        candidates: [
          {
            node_id: 'R_1',
            owner: 'owner',
            name: 'repo',
            full_name: 'owner/repo',
            html_url: 'https://github.com/owner/repo',
            description: 'A test repo \uFFFD here',
            homepage_url: null,
            primary_language: 'TypeScript',
            stargazer_count: 100,
            archived: false,
            disabled: false,
            fork: false,
            pushed_at: '2026-01-01T00:00:00.000Z',
            discovered_at: '2026-01-15T00:00:00.000Z',
            first_seen_source: {
              kind: 'manual',
              source_id: 'owner/repo',
              source_url: 'https://github.com/owner/repo',
              observed_at: '2026-01-15T00:00:00.000Z',
            },
            sources: [
              {
                kind: 'manual',
                source_id: 'owner/repo',
                source_url: 'https://github.com/owner/repo',
                observed_at: '2026-01-15T00:00:00.000Z',
              },
            ],
            status: 'candidate',
          },
        ],
      },
      null,
      2,
    ) + '\n';
  const candidatesBytes = Buffer.from(candidatesText, 'utf8');
  const meta =
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: '2026-01-15T00:00:00.000Z',
        dataset_sha: createHash('sha256').update(candidatesBytes).digest('hex'),
        candidate_count: 1,
        source_count: 1,
        generator_version: '0.1.0',
      },
      null,
      2,
    ) + '\n';
  return { candidatesBytes, meta };
}

describe('stars-discover verify is a BYTE contract', () => {
  it('CONTROL: the unmutated pair verifies (exit 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discovery-verify-'));
    try {
      const { candidatesBytes, meta } = fixturePair();
      writeFileSync(join(dir, 'discovery-candidates.json'), candidatesBytes);
      writeFileSync(join(dir, 'discovery-candidates-meta.json'), meta);
      const result = runVerify(dir);
      expect(result.output).toContain('Valid');
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('BYTES: a byte mutation that decodes to identical text FAILS verification (exit 1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discovery-verify-'));
    try {
      const { candidatesBytes, meta } = fixturePair();
      const at = candidatesBytes.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
      expect(at).toBeGreaterThan(-1);
      const mutated = Buffer.concat([
        candidatesBytes.subarray(0, at),
        Buffer.from([0xff]),
        candidatesBytes.subarray(at + 3),
      ]);
      // Preconditions of the trap: bytes differ, decoded text does not.
      expect(mutated.equals(candidatesBytes)).toBe(false);
      expect(mutated.toString('utf8')).toBe(candidatesBytes.toString('utf8'));

      writeFileSync(join(dir, 'discovery-candidates.json'), mutated);
      writeFileSync(join(dir, 'discovery-candidates-meta.json'), meta);
      const result = runVerify(dir);
      expect(result.output).toContain('Integrity check failed');
      expect(result.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
