import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeSkillsClassificationMeta,
  type SkillsClassificationMeta,
} from '@starred/skills-schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SKILLS_CLASSIFICATION_FILE,
  SKILLS_CLASSIFICATION_META_FILE,
  SKILLS_SOURCE_FILE,
  formatSkillsSourceStageReport,
  stageSkillsSourceDocument,
} from '../src/stage';

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A schema-valid meta whose `source_sha256` is the only field under test. */
function metaWithSource(sourceSha256: string): string {
  const meta: SkillsClassificationMeta = {
    schema_version: '1.0',
    taxonomy_version: 'skills-1',
    classification_sha256: 'a'.repeat(64),
    source_sha256: sourceSha256,
    aliases_sha256: null,
    prior_classification_sha256: null,
    generated_against_stars_sha256: 'c'.repeat(64),
    generated_at: '2026-08-14T00:00:00Z',
    category_count: 1,
    source_entry_count: 1,
    resolved_entry_count: 1,
    present_repo_count: 1,
    absent_repo_count: 0,
    unresolved_entry_count: 0,
    canonical_repo_count: 700,
    unclassified_repo_count: 699,
  };
  return serializeSkillsClassificationMeta(meta);
}

const MD = '# Skills\n\nfixture source document\n';
const OLD_MD = '# Skills\n\nOLD generation source\n';
const LOCK = `${SKILLS_CLASSIFICATION_FILE}.stage-lock`;

const cleanups: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}
afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

/** dataDir with the vendored `.md`; distDir optionally holding a served meta
 *  and/or a pre-existing destination copy. */
function fixture(
  opts: { md?: string | null; distMeta?: string | null; distMd?: string | null } = {},
) {
  const dataDir = tempDir('skills-src-data-');
  const distDir = tempDir('skills-src-dist-');
  const md = opts.md === undefined ? MD : opts.md;
  if (md !== null) writeFileSync(join(dataDir, SKILLS_SOURCE_FILE), md);
  const distMeta = opts.distMeta === undefined ? metaWithSource(sha256(md ?? '')) : opts.distMeta;
  if (distMeta !== null) writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), distMeta);
  if (opts.distMd != null) writeFileSync(join(distDir, SKILLS_SOURCE_FILE), opts.distMd);
  return { dataDir, distDir };
}

const tempLitter = (distDir: string) =>
  readdirSync(distDir).filter((f) => f.includes('.staging-tmp-'));

describe('stageSkillsSourceDocument (P7 §4.12 — same-origin `.md` download)', () => {
  it('MD-1: stages the source byte-exactly on a served-meta hash match, OVERWRITING a stale pre-existing destination (destination overwrite IS the publish), and releases its lock', () => {
    const { dataDir, distDir } = fixture({ distMd: OLD_MD });
    const result = stageSkillsSourceDocument({ dataDir, distDir });
    expect(result).toEqual({ staged: true });
    expect(readFileSync(join(distDir, SKILLS_SOURCE_FILE), 'utf8')).toBe(MD);
    expect(tempLitter(distDir)).toEqual([]);
    expect(existsSync(join(distDir, LOCK))).toBe(false); // lock released
    // lock lifecycle: an immediate second run is not turned away
    expect(stageSkillsSourceDocument({ dataDir, distDir })).toEqual({ staged: true });
  });

  it('MD-2: hash mismatch ⇒ named skip; a MISMATCHED pre-existing destination is REMOVED (never left to serve bytes that are not the served artifact’s source), a matching one is untouched-equivalent', () => {
    // no pre-existing destination: nothing written, nothing to converge
    const bare = fixture({ distMeta: metaWithSource('f'.repeat(64)) });
    const bareResult = stageSkillsSourceDocument(bare);
    expect(bareResult.staged).toBe(false);
    expect(bareResult.reason).toContain('does not match the served meta source_sha256');
    expect(bareResult.residue).toBeUndefined();
    expect(readdirSync(bare.distDir)).toEqual([SKILLS_CLASSIFICATION_META_FILE]);

    // R1 3/3-convergent finding: a stale pre-existing destination must not
    // survive the skip — the download honestly degrades to 404.
    const stale = fixture({ distMeta: metaWithSource('f'.repeat(64)), distMd: OLD_MD });
    const staleResult = stageSkillsSourceDocument(stale);
    expect(staleResult.staged).toBe(false);
    expect(staleResult.reason).toContain('stale dist copy removed');
    expect(existsSync(join(stale.distDir, SKILLS_SOURCE_FILE))).toBe(false);
  });

  it('MD-3: the coherence target is the meta IN DIST, never the working tree — a matching root meta cannot rescue a dist mismatch', () => {
    const { dataDir, distDir } = fixture({ distMeta: metaWithSource('f'.repeat(64)) });
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), metaWithSource(sha256(MD)));
    const result = stageSkillsSourceDocument({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('does not match the served meta source_sha256');
  });

  it('MD-4: absent source ⇒ named skip; a pre-existing destination MATCHING the served meta is RETAINED (a still-coherent earlier stage), a mismatched one is removed', () => {
    const bare = fixture({ md: null, distMeta: metaWithSource('a'.repeat(64)) });
    const bareResult = stageSkillsSourceDocument(bare);
    expect(bareResult.staged).toBe(false);
    expect(bareResult.reason).toBe('no skills-classified.md source present');

    // retained: the dist copy is exactly what the served meta certifies
    const coherent = fixture({
      md: null,
      distMeta: metaWithSource(sha256(OLD_MD)),
      distMd: OLD_MD,
    });
    const coherentResult = stageSkillsSourceDocument(coherent);
    expect(coherentResult.staged).toBe(false);
    expect(coherentResult.reason).toContain('existing dist copy retained');
    expect(readFileSync(join(coherent.distDir, SKILLS_SOURCE_FILE), 'utf8')).toBe(OLD_MD);

    // removed: the dist copy matches nothing the dist serves
    const stale = fixture({ md: null, distMeta: metaWithSource('a'.repeat(64)), distMd: OLD_MD });
    const staleResult = stageSkillsSourceDocument(stale);
    expect(staleResult.staged).toBe(false);
    expect(staleResult.reason).toContain('stale dist copy removed');
    expect(existsSync(join(stale.distDir, SKILLS_SOURCE_FILE))).toBe(false);
  });

  it('MD-5: no served meta in dist ⇒ named skip, and an uncertifiable pre-existing destination is removed (nothing served that the download could be the source OF)', () => {
    const bare = fixture({ distMeta: null });
    const bareResult = stageSkillsSourceDocument(bare);
    expect(bareResult.staged).toBe(false);
    expect(bareResult.reason).toContain('no served skills-classification meta in dist');
    expect(readdirSync(bare.distDir)).toEqual([]);

    const orphan = fixture({ distMeta: null, distMd: OLD_MD });
    const orphanResult = stageSkillsSourceDocument(orphan);
    expect(orphanResult.staged).toBe(false);
    expect(orphanResult.reason).toContain('stale dist copy removed');
    expect(existsSync(join(orphan.distDir, SKILLS_SOURCE_FILE))).toBe(false);
  });

  it('MD-6: unparsable / schema-invalid served meta ⇒ named skip, never a crash, never a stage — and a pre-existing destination is removed (uncertifiable)', () => {
    for (const bad of ['{not json', JSON.stringify({ schema_version: '1.0' })]) {
      const { dataDir, distDir } = fixture({ distMeta: bad, distMd: OLD_MD });
      const result = stageSkillsSourceDocument({ dataDir, distDir });
      expect(result.staged).toBe(false);
      expect(result.reason).toContain('served skills-classification meta unreadable/invalid');
      expect(existsSync(join(distDir, SKILLS_SOURCE_FILE))).toBe(false);
    }
  });

  it('MD-7: a failed publish (destination blocked by a directory) funnels to cleanup — temp removed, no residue flag, failure named', () => {
    const { dataDir, distDir } = fixture();
    mkdirSync(join(distDir, SKILLS_SOURCE_FILE)); // rename target blocked
    const result = stageSkillsSourceDocument({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('skills-classified.md publish failed');
    expect(result.residue).toBeUndefined();
    expect(tempLitter(distDir)).toEqual([]);
    expect(existsSync(join(distDir, LOCK))).toBe(false); // lock released on failure too
  });

  it('MD-8: a held stage lock turns the run away with the pair protocol’s named reason — nothing staged, nothing converged, the FOREIGN lock untouched (R1 race closure)', () => {
    const { dataDir, distDir } = fixture({
      distMd: OLD_MD,
      distMeta: metaWithSource('f'.repeat(64)),
    });
    writeFileSync(join(distDir, LOCK), ''); // another stage holds the dist
    const result = stageSkillsSourceDocument({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('locked by another stage');
    // the other stage owns the dist right now: even a stale copy is not touched
    expect(readFileSync(join(distDir, SKILLS_SOURCE_FILE), 'utf8')).toBe(OLD_MD);
    expect(existsSync(join(distDir, LOCK))).toBe(true); // foreign lock NOT removed
  });

  it('MD-9: residue-SETTING pins (injected rm — a real fs cannot fail these deterministically): an unremovable own temp after a failed publish, and an unremovable adjudicated-stale destination, each set residue:true', () => {
    // own-temp residue: publish fails (dest is a directory), temp rm injected to fail
    const tempCase = fixture();
    mkdirSync(join(tempCase.distDir, SKILLS_SOURCE_FILE));
    const failTmp = ((path: string, opts?: { force?: boolean }) => {
      if (String(path).includes('.staging-tmp-')) throw new Error('EACCES injected');
      return rmSync(path, opts);
    }) as typeof rmSync;
    const tempResult = stageSkillsSourceDocument(
      { dataDir: tempCase.dataDir, distDir: tempCase.distDir },
      { rmImpl: failTmp },
    );
    expect(tempResult.staged).toBe(false);
    expect(tempResult.residue).toBe(true);
    expect(tempResult.reason).toContain('own temp could not be removed');

    // stale-destination residue: skip path adjudicates the dist copy stale,
    // removal fails ⇒ the dist would ship bytes that are not the served
    // artifact's source ⇒ residue (deploy must fail rather than serve them)
    const staleCase = fixture({ distMeta: metaWithSource('f'.repeat(64)), distMd: OLD_MD });
    const failDest = ((path: string, opts?: { force?: boolean }) => {
      if (String(path).endsWith(SKILLS_SOURCE_FILE)) throw new Error('EACCES injected');
      return rmSync(path, opts);
    }) as typeof rmSync;
    const staleResult = stageSkillsSourceDocument(
      { dataDir: staleCase.dataDir, distDir: staleCase.distDir },
      { rmImpl: failDest },
    );
    expect(staleResult.staged).toBe(false);
    expect(staleResult.residue).toBe(true);
    expect(staleResult.reason).toContain('stale dist copy could NOT be removed');
  });

  it('MD-11: a publish FAILURE converges the destination like a named skip (R2b sol #1) — a stale pre-existing copy is removed, a coherent one retained', () => {
    const failWrite = (() => {
      throw new Error('ENOSPC injected');
    }) as unknown as typeof writeFileSync;

    // stale pre-existing copy + mid-write failure: the old bytes must not
    // outlive the failed publish (they mismatch the served meta)
    const stale = fixture({ distMd: OLD_MD });
    const staleResult = stageSkillsSourceDocument(
      { dataDir: stale.dataDir, distDir: stale.distDir },
      { writeImpl: failWrite },
    );
    expect(staleResult.staged).toBe(false);
    expect(staleResult.reason).toContain('skills-classified.md publish failed');
    expect(staleResult.reason).toContain('stale dist copy removed');
    expect(existsSync(join(stale.distDir, SKILLS_SOURCE_FILE))).toBe(false);
    expect(tempLitter(stale.distDir)).toEqual([]);
    expect(staleResult.residue).toBeUndefined();

    // coherent pre-existing copy (bytes == served meta source): RETAINED —
    // the failed publish must not demote a still-valid download to 404
    const coherent = fixture({ distMd: MD });
    const coherentResult = stageSkillsSourceDocument(
      { dataDir: coherent.dataDir, distDir: coherent.distDir },
      { writeImpl: failWrite },
    );
    expect(coherentResult.staged).toBe(false);
    expect(coherentResult.reason).toContain('existing dist copy retained');
    expect(readFileSync(join(coherent.distDir, SKILLS_SOURCE_FILE), 'utf8')).toBe(MD);
  });

  it('MD-12: a closeSync throw funnels like any publish failure — temp removed, failure named, no litter, no residue (R2b sol #4: the R1 CLOSE-FUNNEL pin itself)', () => {
    const failClose = (() => {
      throw new Error('EIO injected');
    }) as unknown as typeof closeSync;
    const { dataDir, distDir } = fixture();
    const result = stageSkillsSourceDocument({ dataDir, distDir }, { closeImpl: failClose });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('skills-classified.md publish failed — EIO injected');
    expect(result.residue).toBeUndefined();
    expect(tempLitter(distDir)).toEqual([]);
    expect(existsSync(join(distDir, SKILLS_SOURCE_FILE))).toBe(false); // nothing published
  });

  it('MD-13: an inner hard failure (temp open) still converges with the sha it read AND preserves the stuck-lock warning (R2b sol #3 — the generic catch lives inside the lock scope)', () => {
    const failOpen = (() => {
      throw new Error('EMFILE injected');
    }) as unknown as typeof openSync;
    const failLockRm = ((path: string, opts?: { force?: boolean }) => {
      if (String(path).endsWith('.stage-lock')) throw new Error('EACCES injected');
      return rmSync(path, opts);
    }) as typeof rmSync;

    // stale pre-existing copy: the hard failure still converges (removes it)
    const stale = fixture({ distMd: OLD_MD });
    const staleResult = stageSkillsSourceDocument(
      { dataDir: stale.dataDir, distDir: stale.distDir },
      { openImpl: failOpen, rmImpl: failLockRm },
    );
    expect(staleResult.staged).toBe(false);
    expect(staleResult.reason).toContain('skills-classified.md staging failed — EMFILE injected');
    expect(staleResult.reason).toContain('stale dist copy removed');
    expect(existsSync(join(stale.distDir, SKILLS_SOURCE_FILE))).toBe(false);
    // the stuck-lock warning survives the inner throw
    expect(staleResult.warning).toContain('stage lock could not be removed');

    // coherent pre-existing copy: the hard failure retains it (the hoisted
    // served sha keeps retain-if-coherent working on this path too)
    const coherent = fixture({ distMd: MD });
    const coherentResult = stageSkillsSourceDocument(
      { dataDir: coherent.dataDir, distDir: coherent.distDir },
      { openImpl: failOpen },
    );
    expect(coherentResult.staged).toBe(false);
    expect(coherentResult.reason).toContain('existing dist copy retained');
    expect(readFileSync(join(coherent.distDir, SKILLS_SOURCE_FILE), 'utf8')).toBe(MD);
  });

  it('MD-10: an own lock that cannot be removed is surfaced as a WARNING on an otherwise successful stage, and the formatter renders it (a later stage would skip on the stuck lock)', () => {
    const { dataDir, distDir } = fixture();
    const failLock = ((path: string, opts?: { force?: boolean }) => {
      if (String(path).endsWith('.stage-lock')) throw new Error('EACCES injected');
      return rmSync(path, opts);
    }) as typeof rmSync;
    const result = stageSkillsSourceDocument({ dataDir, distDir }, { rmImpl: failLock });
    expect(result.staged).toBe(true);
    expect(result.warning).toContain('stage lock could not be removed');
    const report = formatSkillsSourceStageReport(result);
    expect(report).toContain('Skills source document: staged');
    expect(report).toContain('WARNING skills source document: stage lock could not be removed');
    // and a skip result formats without a warning line
    expect(formatSkillsSourceStageReport({ staged: false, reason: 'x' })).toBe(
      '[deploy] Skills source document: skipped (x)',
    );
  });
});
