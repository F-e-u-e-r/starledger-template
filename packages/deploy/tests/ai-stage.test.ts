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
import {
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
} from '@starred/ai-schema';
import { describe, expect, it } from 'vitest';
import { AI_ANNOTATIONS_FILE, AI_ANNOTATIONS_META_FILE, stageAiArtifacts } from '../src/stage';

function validArtifactPair(): { annotations: string; meta: string } {
  const annotations = serializeAnnotations([]);
  const meta = serializeAiAnnotationsMeta(
    buildAiAnnotationsMeta({
      annotationsBytes: annotations,
      annotationCount: 0,
      datasetSha256: 'd'.repeat(64),
      generatedAt: '2026-06-21T00:00:00Z',
    }),
  );
  return { annotations, meta };
}

function dirs(): { dataDir: string; distDir: string } {
  return {
    dataDir: mkdtempSync(join(tmpdir(), 'ai-stage-data-')),
    distDir: mkdtempSync(join(tmpdir(), 'ai-stage-dist-')),
  };
}

describe('AI artifact staging (fail-soft publication)', () => {
  it('PUB-7: stages a valid AI artifact pair into the dist', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(true);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(true);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_META_FILE))).toBe(true);
  });

  it('is fail-soft when AI artifacts are absent (canonical deploy proceeds)', () => {
    const { dataDir, distDir } = dirs();
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
  });

  it('is fail-soft (skips, never throws) on a hash mismatch', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(
      join(dataDir, AI_ANNOTATIONS_META_FILE),
      pair.meta.replace(/[0-9a-f]{64}/, '0'.repeat(64)),
    );
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
  });

  it('is fail-soft when a hash-matching artifact fails the strict AI schemas', () => {
    const { dataDir, distDir } = dirs();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), '{"schema_version":"1.0"}\n');
    writeFileSync(
      join(dataDir, AI_ANNOTATIONS_META_FILE),
      JSON.stringify({
        annotations_sha256: '4fde2c62eaeb82fe10581324384d0af72f965f0cc1d8375b234453bbd24c1857',
      }),
    );
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
  });
});

/**
 * BUILD/RUNTIME BYTE AGREEMENT (owner ruling, round-5 class closure).
 *
 * Same contract as the discovery pair: the runtime loader verifies the exact
 * received bytes, so the build must too. The trap is deliberately NOT a BOM —
 * a literal U+FFFD's three UTF-8 bytes become a bare 0xFF, which decodes back
 * to U+FFFD. That kills the whole `hash(decode(bytes))` mutant rather than one
 * prefix special case.
 */
describe('AI build-side integrity is a BYTE contract', () => {
  function pairWithReplacementChar(): { annotationsBytes: Buffer; meta: string } {
    const annotationsText = serializeAnnotations([
      {
        node_id: 'R_1',
        category: 'developer-tools',
        tags: ['automation', 'cli'],
        summary:
          'A concise, factual description \uFFFD of what this repository does, who it is for, and why it is useful to developers.',
        source: {
          kind: 'metadata',
          readme_path: null,
          readme_oid: null,
          repo_metadata_sha256: 'b'.repeat(64),
          fingerprint: 'c'.repeat(64),
        },
        generation: {
          executor_kind: 'claude-routine',
          execution_profile_version: 'agent-v1',
          model_label: 'informational-only',
          prompt_version: 'classify-v1',
          generated_at: '2026-06-20T00:00:00Z',
        },
      },
    ]);
    const annotationsBytes = Buffer.from(annotationsText, 'utf8');
    const meta = serializeAiAnnotationsMeta(
      buildAiAnnotationsMeta({
        annotationsBytes: annotationsText,
        annotationCount: 1,
        datasetSha256: 'd'.repeat(64),
        generatedAt: '2026-06-21T00:00:00Z',
      }),
    );
    return { annotationsBytes, meta };
  }

  it('CONTROL: the unmutated bytes stage', () => {
    const { dataDir, distDir } = dirs();
    const { annotationsBytes, meta } = pairWithReplacementChar();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), annotationsBytes);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), meta);
    expect(stageAiArtifacts({ dataDir, distDir }).staged).toBe(true);
  });

  it('skips a byte mutation that decodes to identical text', () => {
    const { dataDir, distDir } = dirs();
    const { annotationsBytes, meta } = pairWithReplacementChar();
    const at = annotationsBytes.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      annotationsBytes.subarray(0, at),
      Buffer.from([0xff]),
      annotationsBytes.subarray(at + 3),
    ]);
    expect(mutated.equals(annotationsBytes)).toBe(false);
    expect(mutated.toString('utf8')).toBe(annotationsBytes.toString('utf8'));

    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), mutated);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), meta);
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('hash mismatch');
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
  });
});

describe('stageAiArtifacts — source probing (round 10)', () => {
  it('INCOMPLETE: a half pair is named incomplete, not "no artifacts present"', () => {
    const { dataDir, distDir } = dirs();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), validArtifactPair().annotations);
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('incomplete AI artifact pair');
  });

  it('PROBE-ENOENT-ONLY: a non-ENOENT probe error is surfaced, never read as absence', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const eio = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    const result = stageAiArtifacts(
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

describe('stageAiArtifacts — ownership-safe temp+rename publication (round 14)', () => {
  // Owner ruling A: publish this invocation's validated bytes via unique temps
  // + rename, never an in-place overwrite. These pin the three discriminating
  // cases the owner required, plus the R14 root-defect variants.

  it('PIN-1 write-failure never partially overwrites a pre-existing valid pair', () => {
    // An existing valid destination + a write/copy FAILURE must leave the
    // existing canonical files byte-identical (the write goes to a temp).
    const { dataDir, distDir } = dirs();
    const oldPair = validArtifactPair();
    const distAnn = join(distDir, AI_ANNOTATIONS_FILE);
    const distMeta = join(distDir, AI_ANNOTATIONS_META_FILE);
    writeFileSync(distAnn, oldPair.annotations);
    writeFileSync(distMeta, oldPair.meta);
    const newPair = validArtifactPair();
    // make newPair distinct so a partial overwrite would be observable
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), newPair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), newPair.meta);
    const result = stageAiArtifacts(
      { dataDir, distDir },
      {
        // The temp write throws before anything is renamed into place.
        writeTempImpl: (() => {
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    // The pre-existing pair is untouched — no in-place overwrite happened.
    expect(readFileSync(distAnn, 'utf8')).toBe(oldPair.annotations);
    expect(readFileSync(distMeta, 'utf8')).toBe(oldPair.meta);
  });

  it("PIN-2 a successful publication lands EXACTLY this invocation's validated bytes", () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(true);
    expect(readFileSync(join(distDir, AI_ANNOTATIONS_FILE), 'utf8')).toBe(pair.annotations);
    expect(readFileSync(join(distDir, AI_ANNOTATIONS_META_FILE), 'utf8')).toBe(pair.meta);
    // No temporaries survive a clean publication.
    expect(readdirSync(distDir).filter((n) => n.includes('.staging-tmp'))).toEqual([]);
  });

  it("PIN-3 cleanup removes only THIS run's temp; a foreign temp-suffixed file survives", () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    // A FOREIGN file that merely shares the .staging-tmp suffix (a different
    // token) must never be touched by this invocation's cleanup.
    const foreign = join(distDir, `${AI_ANNOTATIONS_FILE}.deadbeef.staging-tmp`);
    writeFileSync(foreign, 'FOREIGN');
    const result = stageAiArtifacts(
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
    // Round-14 (sol): the old in-place write FOLLOWED a destination symlink and
    // corrupted its external target. A rename replaces the link ENTRY, leaving
    // the target untouched.
    const { dataDir, distDir } = dirs();
    const targetDir = mkdtempSync(join(tmpdir(), 'ai-target-'));
    const annTarget = join(targetDir, 'external-ann.json');
    const metaTarget = join(targetDir, 'external-meta.json');
    writeFileSync(annTarget, 'EXTERNAL ARTIFACT CONTENT');
    writeFileSync(metaTarget, 'EXTERNAL META CONTENT');
    symlinkSync(annTarget, join(distDir, AI_ANNOTATIONS_FILE));
    symlinkSync(metaTarget, join(distDir, AI_ANNOTATIONS_META_FILE));
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(true);
    // The EXTERNAL targets are UNTOUCHED — the write never followed the link.
    expect(readFileSync(annTarget, 'utf8')).toBe('EXTERNAL ARTIFACT CONTENT');
    expect(readFileSync(metaTarget, 'utf8')).toBe('EXTERNAL META CONTENT');
    // The dist now holds regular files with this invocation's bytes.
    expect(lstatSync(join(distDir, AI_ANNOTATIONS_FILE)).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(distDir, AI_ANNOTATIONS_FILE), 'utf8')).toBe(pair.annotations);
  });

  it('READONLY-DEST: a read-only destination pair is replaced by rename (no EACCES, no data loss)', () => {
    // Round-14 (luna): the old in-place write hit EACCES truncating a read-only
    // destination and left a torn pair. A rename swaps the entry and succeeds.
    const { dataDir, distDir } = dirs();
    const oldPair = validArtifactPair();
    const distAnn = join(distDir, AI_ANNOTATIONS_FILE);
    const distMeta = join(distDir, AI_ANNOTATIONS_META_FILE);
    writeFileSync(distAnn, oldPair.annotations);
    writeFileSync(distMeta, oldPair.meta);
    chmodSync(distMeta, 0o444);
    const newPair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), newPair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), newPair.meta);
    let result;
    try {
      result = stageAiArtifacts({ dataDir, distDir });
    } finally {
      if (existsSync(distMeta)) chmodSync(distMeta, 0o644);
    }
    expect(result.staged).toBe(true);
    // A COMPLETE new pair is published — never a torn old-meta + new-artifact.
    expect(readFileSync(distAnn, 'utf8')).toBe(newPair.annotations);
    expect(readFileSync(distMeta, 'utf8')).toBe(newPair.meta);
  });

  it('PARTIAL-TEMP: a temp write that fails PARTWAY leaves no leftover temp', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const result = stageAiArtifacts(
      { dataDir, distDir },
      {
        writeTempImpl: ((path: string) => {
          writeFileSync(path, 'PARTIAL'); // exclusive create succeeded, write then fails
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
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const result = stageAiArtifacts(
      { dataDir, distDir },
      {
        // Create a NON-EMPTY DIRECTORY at the temp path, then throw: the
        // exclusive-open ownership rule registers it, and a non-recursive
        // force-rm cannot remove it ⇒ residue.
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
    // The post-publish read-back (owner-required) fires on landed bytes that
    // are not ours. We report staged:false and do NOT remove the destination
    // (it is not a temp we own — it may be another valid stager's pair).
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const result = stageAiArtifacts(
      { dataDir, distDir },
      { afterPublish: () => writeFileSync(join(distDir, AI_ANNOTATIONS_FILE), 'CORRUPTED') },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('do not match the validated snapshot');
  });

  it('GUARD-META: a post-publish meta rewrite is never reported staged', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const rewritten = pair.meta.replace('2026-06-21T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(rewritten).not.toBe(pair.meta);
    const result = stageAiArtifacts(
      { dataDir, distDir },
      { afterPublish: () => writeFileSync(join(distDir, AI_ANNOTATIONS_META_FILE), rewritten) },
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
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    mkdirSync(join(distDir, AI_ANNOTATIONS_META_FILE)); // directory obstructs the meta rename
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('is a directory');
    // The artifact was NOT published — no torn half-pair.
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
    expect(result.residue).toBeUndefined();
  });

  it('TORN-SAFETY-NET: a second-rename failure after the first leaves residue (CLI fails the deploy)', () => {
    // The crash/race residual: the first rename swapped, the second throws. We
    // cannot restore the old pair (no backup, ruling A), so flag residue so the
    // deploy fails rather than shipping a torn pair. Injected because a real
    // filesystem cannot fail only the second rename on demand.
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    let n = 0;
    const result = stageAiArtifacts(
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
