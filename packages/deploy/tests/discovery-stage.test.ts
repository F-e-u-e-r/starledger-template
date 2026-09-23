import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_CANDIDATES_FILE,
  DISCOVERY_CANDIDATES_META_FILE,
  stageDiscoveryArtifacts,
} from '../src/stage';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validArtifactPair(): { candidates: string; meta: string } {
  const candidates =
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
            description: 'A test repo',
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

  const meta =
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: '2026-01-15T00:00:00.000Z',
        dataset_sha: sha256Hex(candidates),
        candidate_count: 1,
        source_count: 1,
        generator_version: '0.1.0',
      },
      null,
      2,
    ) + '\n';

  return { candidates, meta };
}

function dirs(): { dataDir: string; distDir: string } {
  return {
    dataDir: mkdtempSync(join(tmpdir(), 'discovery-stage-data-')),
    distDir: mkdtempSync(join(tmpdir(), 'discovery-stage-dist-')),
  };
}

describe('Discovery artifact staging (fail-soft publication)', () => {
  it('stages a valid discovery artifact pair into the dist', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(true);
    expect(existsSync(join(distDir, DISCOVERY_CANDIDATES_FILE))).toBe(true);
    expect(existsSync(join(distDir, DISCOVERY_CANDIDATES_META_FILE))).toBe(true);
  });

  it('is fail-soft when discovery artifacts are absent', () => {
    const { dataDir, distDir } = dirs();
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, DISCOVERY_CANDIDATES_FILE))).toBe(false);
  });

  it('is fail-soft when only one discovery artifact is present', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toMatch(/incomplete/);
  });

  it('is fail-soft on a hash mismatch', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(
      join(dataDir, DISCOVERY_CANDIDATES_META_FILE),
      pair.meta.replace(/[0-9a-f]{64}/, '0'.repeat(64)),
    );
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, DISCOVERY_CANDIDATES_FILE))).toBe(false);
  });

  it('is fail-soft on a count mismatch', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(
      join(dataDir, DISCOVERY_CANDIDATES_META_FILE),
      pair.meta.replace('"candidate_count": 1', '"candidate_count": 2'),
    );
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, DISCOVERY_CANDIDATES_FILE))).toBe(false);
  });
});

/**
 * BUILD/RUNTIME BYTE AGREEMENT (owner ruling, round-5 class closure).
 *
 * The runtime loader verifies the exact received bytes. If the build hashed
 * DECODED text instead, an artifact whose bytes differ but decode identically
 * would pass staging and then be rejected at runtime — the layer going
 * unavailable after a deploy the build called sound.
 *
 * The trap is deliberately NOT a BOM: a literal U+FFFD's three UTF-8 bytes are
 * replaced by a bare 0xFF, which a decoder maps straight back to U+FFFD. This
 * kills the whole `hash(decode(bytes))` mutant, not just one prefix special
 * case — a "string hash plus a BOM check" fix still fails here.
 */
describe('discovery build-side integrity is a BYTE contract', () => {
  function pairWithReplacementChar(): { candidatesBytes: Buffer; meta: string } {
    const pair = validArtifactPair();
    const doc = JSON.parse(pair.candidates) as {
      candidates: { description: string }[];
    };
    doc.candidates[0]!.description = 'A test repo \uFFFD here';
    const candidatesText = JSON.stringify(doc, null, 2) + '\n';
    const candidatesBytes = Buffer.from(candidatesText, 'utf8');
    const metaDoc = JSON.parse(pair.meta) as Record<string, unknown>;
    metaDoc.dataset_sha = createHash('sha256').update(candidatesBytes).digest('hex');
    return { candidatesBytes, meta: JSON.stringify(metaDoc, null, 2) + '\n' };
  }

  it('CONTROL: the unmutated bytes stage', () => {
    const { dataDir, distDir } = dirs();
    const { candidatesBytes, meta } = pairWithReplacementChar();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), candidatesBytes);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), meta);
    expect(stageDiscoveryArtifacts({ dataDir, distDir }).staged).toBe(true);
  });

  it('skips a byte mutation that decodes to identical text', () => {
    const { dataDir, distDir } = dirs();
    const { candidatesBytes, meta } = pairWithReplacementChar();
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

    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), mutated);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), meta);
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('hash mismatch');
    expect(existsSync(join(distDir, DISCOVERY_CANDIDATES_FILE))).toBe(false);
  });
});

describe('stageDiscoveryArtifacts — source probing (round 10)', () => {
  it('PROBE-ENOENT-ONLY: a non-ENOENT probe error is surfaced, never read as absence', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const eio = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      {
        lstatImpl: (() => {
          throw eio;
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('could not probe its sources');
    expect(result.reason).toContain('EIO');
  });
});

describe('stageDiscoveryArtifacts — ownership-safe temp+rename publication (round 14)', () => {
  function distinctPair(): { candidates: string; meta: string } {
    const base = validArtifactPair();
    const doc = JSON.parse(base.candidates) as { candidates: { description: string }[] };
    doc.candidates[0]!.description = 'A DISTINCT candidate for round-14 tests';
    const candidates = JSON.stringify(doc, null, 2) + '\n';
    const metaDoc = JSON.parse(base.meta) as Record<string, unknown>;
    metaDoc.dataset_sha = createHash('sha256').update(candidates, 'utf8').digest('hex');
    return { candidates, meta: JSON.stringify(metaDoc, null, 2) + '\n' };
  }

  it('PIN-1 write-failure never partially overwrites a pre-existing valid pair', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validArtifactPair();
    const distC = join(distDir, DISCOVERY_CANDIDATES_FILE);
    const distM = join(distDir, DISCOVERY_CANDIDATES_META_FILE);
    writeFileSync(distC, oldPair.candidates);
    writeFileSync(distM, oldPair.meta);
    const newPair = distinctPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), newPair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), newPair.meta);
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      {
        writeTempImpl: (() => {
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    expect(readFileSync(distC, 'utf8')).toBe(oldPair.candidates);
    expect(readFileSync(distM, 'utf8')).toBe(oldPair.meta);
  });

  it("PIN-2 a successful publication lands EXACTLY this invocation's validated bytes", () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(true);
    expect(readFileSync(join(distDir, DISCOVERY_CANDIDATES_FILE), 'utf8')).toBe(pair.candidates);
    expect(readFileSync(join(distDir, DISCOVERY_CANDIDATES_META_FILE), 'utf8')).toBe(pair.meta);
    expect(readdirSync(distDir).filter((n) => n.includes('.staging-tmp'))).toEqual([]);
  });

  it("PIN-3 cleanup removes only THIS run's temp; a foreign temp-suffixed file survives", () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const foreign = join(distDir, `${DISCOVERY_CANDIDATES_FILE}.deadbeef.staging-tmp`);
    writeFileSync(foreign, 'FOREIGN');
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      {
        writeTempImpl: (() => {
          throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    expect(existsSync(foreign)).toBe(true);
    expect(readFileSync(foreign, 'utf8')).toBe('FOREIGN');
  });

  it('SYMLINK: a symlinked destination is replaced by rename; the external target is not corrupted', () => {
    const { dataDir, distDir } = dirs();
    const targetDir = mkdtempSync(join(tmpdir(), 'disc-target-'));
    const cTarget = join(targetDir, 'external-candidates.json');
    const mTarget = join(targetDir, 'external-meta.json');
    writeFileSync(cTarget, 'EXTERNAL CANDIDATES CONTENT');
    writeFileSync(mTarget, 'EXTERNAL META CONTENT');
    symlinkSync(cTarget, join(distDir, DISCOVERY_CANDIDATES_FILE));
    symlinkSync(mTarget, join(distDir, DISCOVERY_CANDIDATES_META_FILE));
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(true);
    expect(readFileSync(cTarget, 'utf8')).toBe('EXTERNAL CANDIDATES CONTENT');
    expect(readFileSync(mTarget, 'utf8')).toBe('EXTERNAL META CONTENT');
    expect(lstatSync(join(distDir, DISCOVERY_CANDIDATES_FILE)).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(distDir, DISCOVERY_CANDIDATES_FILE), 'utf8')).toBe(pair.candidates);
  });

  it('READONLY-DEST: a read-only destination pair is replaced by rename (no EACCES, no data loss)', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validArtifactPair();
    const distC = join(distDir, DISCOVERY_CANDIDATES_FILE);
    const distM = join(distDir, DISCOVERY_CANDIDATES_META_FILE);
    writeFileSync(distC, oldPair.candidates);
    writeFileSync(distM, oldPair.meta);
    chmodSync(distM, 0o444);
    const newPair = distinctPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), newPair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), newPair.meta);
    let result;
    try {
      result = stageDiscoveryArtifacts({ dataDir, distDir });
    } finally {
      if (existsSync(distM)) chmodSync(distM, 0o644);
    }
    expect(result.staged).toBe(true);
    expect(readFileSync(distC, 'utf8')).toBe(newPair.candidates);
    expect(readFileSync(distM, 'utf8')).toBe(newPair.meta);
  });

  it('PARTIAL-TEMP: a temp write that fails PARTWAY leaves no leftover temp', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      {
        writeTempImpl: ((path: string) => {
          writeFileSync(path, 'PARTIAL');
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    expect(readdirSync(distDir).filter((n) => n.includes('.staging-tmp'))).toEqual([]);
  });

  it('STUCK-TEMP-RESIDUE: an owned temp that cannot be removed is reported as residue', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      {
        writeTempImpl: ((path: string) => {
          mkdirSync(path);
          writeFileSync(join(path, 'squatter'), 'x');
          throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('could NOT be removed');
    expect(result.residue).toBe(true);
  });

  it('GUARD: a post-publish mismatch (a concurrent writer/tamper) is never reported staged', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      { afterPublish: () => writeFileSync(join(distDir, DISCOVERY_CANDIDATES_FILE), 'CORRUPTED') },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('do not match the validated snapshot');
  });

  it('GUARD-META: a post-publish meta rewrite is never reported staged', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    const rewritten = pair.meta.replace('2026-01-15T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    expect(rewritten).not.toBe(pair.meta);
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      {
        afterPublish: () => writeFileSync(join(distDir, DISCOVERY_CANDIDATES_META_FILE), rewritten),
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('do not match the validated snapshot');
  });

  it('TORN-PRECHECK: a DIRECTORY at a destination is refused BEFORE any rename — no torn pair', () => {
    // Round-15 (luna@max + luna@ultra): the two renames are not atomic, so a
    // directory obstructing the meta destination let the artifact rename land
    // and the meta rename fail, stranding a torn pair. Refuse up front: nothing
    // is published, the artifact destination is never touched.
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    mkdirSync(join(distDir, DISCOVERY_CANDIDATES_META_FILE)); // directory obstructs the meta rename
    const result = stageDiscoveryArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('is a directory');
    // The artifact was NOT published — no torn half-pair.
    expect(existsSync(join(distDir, DISCOVERY_CANDIDATES_FILE))).toBe(false);
    expect(result.residue).toBeUndefined();
  });

  it('TORN-SAFETY-NET: a second-rename failure after the first leaves residue (CLI fails the deploy)', () => {
    // The crash/race residual: the first rename swapped, the second throws. We
    // cannot restore the old pair (no backup, ruling A), so flag residue so the
    // deploy fails rather than shipping a torn pair. Injected because a real
    // filesystem cannot fail only the second rename on demand.
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_FILE), pair.candidates);
    writeFileSync(join(dataDir, DISCOVERY_CANDIDATES_META_FILE), pair.meta);
    let n = 0;
    const result = stageDiscoveryArtifacts(
      { dataDir, distDir },
      {
        renameImpl: ((from: string, to: string) => {
          n += 1;
          if (n === 2) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
          renameSync(from, to);
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('torn pair');
    expect(result.residue).toBe(true);
  });
});
