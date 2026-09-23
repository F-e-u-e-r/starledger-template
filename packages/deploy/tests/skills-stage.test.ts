import { createHash } from 'node:crypto';
import type { openSync } from 'node:fs';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeSkillsClassification,
  serializeSkillsClassificationMeta,
  type SkillsClassificationMeta,
} from '@starred/skills-schema';
import { describe, expect, it } from 'vitest';
import {
  SKILLS_CLASSIFICATION_FILE,
  SKILLS_CLASSIFICATION_META_FILE,
  formatSkillsStageReport,
  stageSkillsArtifacts,
} from '../src/stage';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validPair(summary = 'Stage fixture entry.'): { artifact: string; meta: string } {
  const artifact = serializeSkillsClassification({
    scope: {
      id: 'coding-agent-skills-ecosystem',
      label: 'Coding-agent skills ecosystem',
      description: 'A curated subset; absence is not a classification.',
    },
    categories: [
      {
        id: 'verification-qa',
        label: 'Verification & QA',
        kind: 'domain',
        definition: 'Correctness-checking skills.',
        order: 0,
        target_pack: 'opus-pack',
      },
    ],
    entries: [
      {
        source_name_with_owner: 'alpha/one',
        node_id: 'R_kgDOstage001',
        resolution: 'resolved',
        primary_category_id: 'verification-qa',
        secondary_category_ids: [],
        summary,
      },
    ],
  });
  const meta: SkillsClassificationMeta = {
    schema_version: '1.0',
    taxonomy_version: 'skills-1',
    classification_sha256: sha256(artifact),
    source_sha256: 'b'.repeat(64),
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
  return { artifact, meta: serializeSkillsClassificationMeta(meta) };
}

function dirs(): { dataDir: string; distDir: string } {
  return {
    dataDir: mkdtempSync(join(tmpdir(), 'skills-stage-data-')),
    distDir: mkdtempSync(join(tmpdir(), 'skills-stage-dist-')),
  };
}

describe('skills-classification staging (fail-soft publication, P7 §4.10)', () => {
  it('stages a valid pair into the dist', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result).toEqual({ staged: true });
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_FILE))).toBe(true);
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE))).toBe(true);
  });

  it('is fail-soft when both artifacts are absent (canonical deploy proceeds)', () => {
    const { dataDir, distDir } = dirs();
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('no skills-classification artifacts');
  });

  it('skips an incomplete pair without staging either file', () => {
    const { dataDir, distDir } = dirs();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), validPair().artifact);
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('incomplete');
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_FILE))).toBe(false);
  });

  it('skips on byte-hash mismatch', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(
      join(dataDir, SKILLS_CLASSIFICATION_FILE),
      pair.artifact.replace('Stage fixture entry.', 'Tampered fixture entry.'),
    );
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('hash mismatch');
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_FILE))).toBe(false);
  });

  it('skips on a schema violation (whole pair, no partial staging)', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), '{"schema_version":"9.9"}');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE))).toBe(false);
  });

  it('K5: a blocked destination aborts with the dist untouched — never a partial pair, no temp residue', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    mkdirSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE));
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('pre-existing pair restored');
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_FILE))).toBe(false);
    // Every residue class this invocation can create: temporaries, the
    // rollback backups, and the publication lock.
    expect(
      readdirSync(distDir).filter(
        (name) =>
          name.includes('.staging-tmp') ||
          name.includes('.staging-bak') ||
          name.includes('.stage-lock'),
      ),
    ).toEqual([]);
  });

  it('L1: a valid re-stage onto a BLOCKED destination leaves the old artifact byte-identical (discriminating pin)', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair();
    const newPair = validPair('Different summary for the new pair.');
    // A previously staged artifact lives in the dist; its meta destination is
    // now occupied by a directory (the injected STAGING-phase failure — the
    // §4.10 pre-check catches it after both temp copies succeeded).
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    mkdirSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE));
    // The NEW pair is fully valid — validation passes, so the failure cannot
    // hide in the read/parse phase (the R3 finding against the earlier pin).
    // The round-2 destructive implementation copies the new artifact STRAIGHT
    // over the old one before its meta copy fails (EISDIR on the directory),
    // then rmSync-deletes it — either way the old bytes are gone and this
    // test fails on it.
    //
    // SCOPE OF THIS PIN, stated honestly (re-review finding): it discriminates
    // the ROUND-2 destructive implementation, and nothing newer. Every
    // temp-file-based version — including the one that later proved to lose the
    // old artifact when a MOVE-ASIDE failed — passes this scenario, because the
    // directory destination is rejected before anything is moved. Do not read a
    // green L1 as evidence that rollback works; that guarantee belongs to
    // F1-ROLLBACK and F1-MOVEASIDE, each proven by deleting the mechanism it
    // guards.
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('pre-existing pair restored');
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(oldPair.artifact);
    // Every residue class this invocation can create: temporaries, the
    // rollback backups, and the publication lock.
    expect(
      readdirSync(distDir).filter(
        (name) =>
          name.includes('.staging-tmp') ||
          name.includes('.staging-bak') ||
          name.includes('.stage-lock'),
      ),
    ).toEqual([]);
  });

  it('R4: a FOREIGN regular file at a .staging-tmp-suffixed path survives both a successful stage and an abort', () => {
    const foreignName = `${SKILLS_CLASSIFICATION_META_FILE}.staging-tmp`;
    // Successful stage: the unique-token temporaries never collide with the
    // foreign file, and cleanup touches only what this invocation created.
    {
      const { dataDir, distDir } = dirs();
      const pair = validPair();
      writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
      writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
      writeFileSync(join(distDir, foreignName), 'foreign bytes');
      const result = stageSkillsArtifacts({ dataDir, distDir });
      expect(result.staged).toBe(true);
      expect(readFileSync(join(distDir, foreignName), 'utf8')).toBe('foreign bytes');
    }
    // Aborted stage (blocked destination): the foreign file still survives.
    {
      const { dataDir, distDir } = dirs();
      const pair = validPair();
      writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
      writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
      writeFileSync(join(distDir, foreignName), 'foreign bytes');
      mkdirSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE));
      const result = stageSkillsArtifacts({ dataDir, distDir });
      expect(result.staged).toBe(false);
      expect(readFileSync(join(distDir, foreignName), 'utf8')).toBe('foreign bytes');
    }
  });

  it('skips on a meta↔artifact cross-invariant breach, naming the check', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    const badMeta = pair.meta
      .replace('"category_count": 1', '"category_count": 2')
      .replace('"source_entry_count": 1', '"source_entry_count": 2')
      .replace('"resolved_entry_count": 1', '"resolved_entry_count": 2')
      .replace('"present_repo_count": 1', '"present_repo_count": 2')
      .replace('"unclassified_repo_count": 699', '"unclassified_repo_count": 698');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), badMeta);
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('meta↔artifact mismatch');
    expect(result.reason).toContain('C-1');
  });

  /**
   * F1 — the commit section is transactional. Before the rewrite the two
   * renames ran back to back: a failure of the SECOND one left the new artifact
   * beside the old meta, the function returned `staged: false` while admitting
   * "dist may hold a mixed pair", and the CLI published it anyway.
   */
  it('F1-ROLLBACK: a failure at the second commit step leaves the OLD pair byte-identical', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('Old published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);

    const newPair = validPair('New candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);
    // Precondition: the two pairs really are different bytes, so "unchanged"
    // below cannot be satisfied trivially.
    expect(newPair.artifact).not.toBe(oldPair.artifact);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeCommitStep: (step) => {
          if (step === 'meta') throw new Error('injected commit failure');
        },
      },
    );

    expect(result.staged).toBe(false);
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(oldPair.artifact);
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), 'utf8')).toBe(oldPair.meta);
    expect(
      readdirSync(distDir).filter(
        (name) =>
          name.includes('.staging-tmp') ||
          name.includes('.staging-bak') ||
          name.includes('.stage-lock'),
      ),
    ).toEqual([]);
  });

  /**
   * F1 (re-review) — moving the old pair aside is itself a multi-step mutation.
   * An earlier amendment performed those two renames OUTSIDE the rollback
   * region, so a failure between them stranded the old artifact under its
   * backup name while the reason still claimed the pair had been restored.
   */
  it('F1-MOVEASIDE: a failure while moving the old pair aside leaves it byte-identical', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('Old published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);

    const newPair = validPair('New candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);
    expect(newPair.artifact).not.toBe(oldPair.artifact);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeMoveAside: (step) => {
          // Fail AFTER the artifact has been moved aside, BEFORE the meta is.
          if (step === 'meta') throw new Error('injected move-aside failure');
        },
      },
    );

    expect(result.staged).toBe(false);
    expect(result.reason).not.toContain('could NOT be fully restored');
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(oldPair.artifact);
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), 'utf8')).toBe(oldPair.meta);
    expect(
      readdirSync(distDir).filter(
        (name) =>
          name.includes('.staging-tmp') ||
          name.includes('.staging-bak') ||
          name.includes('.stage-lock'),
      ),
    ).toEqual([]);
  });

  /**
   * Round-3 finding: `existsSync` resolves symlink targets, so a DANGLING
   * symlink at a destination reported "absent" and was left out of the rollback
   * ledger — the commit then replaced it and the undo could not put it back,
   * while the reason still claimed a restore. The ledger keys on the directory
   * ENTRY (lstat) instead.
   */
  it('F1-DANGLING: a dangling symlink destination is restored, not silently destroyed', () => {
    const { dataDir, distDir } = dirs();
    const oldMeta = validPair('Old meta entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldMeta.meta);
    // A destination whose entry exists but whose target does not.
    symlinkSync(join(distDir, 'NO_SUCH_TARGET'), join(distDir, SKILLS_CLASSIFICATION_FILE));
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_FILE))).toBe(false);
    expect(lstatSync(join(distDir, SKILLS_CLASSIFICATION_FILE)).isSymbolicLink()).toBe(true);

    const newPair = validPair('New candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeCommitStep: (step) => {
          if (step === 'meta') throw new Error('injected commit failure');
        },
      },
    );

    expect(result.staged).toBe(false);
    // The pre-existing ENTRY must be back, still a symlink — not replaced by
    // the candidate artifact and not deleted.
    expect(lstatSync(join(distDir, SKILLS_CLASSIFICATION_FILE)).isSymbolicLink()).toBe(true);
    expect(result.reason).not.toContain('could NOT be fully restored');
  });

  /**
   * Round-3 finding: the honest-failure branch was claimed but never pinned —
   * deleting `restoreFailed = true` left the suite green. Making the dist
   * read-only mid-commit forces both the undo and the restore to fail.
   */
  it('F1-HONEST: a restore that cannot complete says so instead of claiming success', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('Old published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);
    const newPair = validPair('New candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeCommitStep: (step) => {
          if (step !== 'meta') return;
          // Destroy the artifact's backup, then fail the commit. The undo can
          // no longer put the old artifact back, so the result MUST say so.
          // Deterministic and portable — unlike a permissions trick, which
          // root would ignore.
          const backup = readdirSync(distDir).find((name) => name.includes('.staging-bak'));
          expect(backup, 'a backup must exist for this injection to mean anything').toBeDefined();
          rmSync(join(distDir, backup!));
          throw new Error('injected commit failure');
        },
      },
    );

    expect(result.staged).toBe(false);
    expect(result.reason).toContain('could NOT be fully restored');
    // Round-11: unremovable/unrestorable content in the dist is a structured
    // RESIDUE the CLI must escalate on — a truthful reason alone still shipped.
    expect(result.residue).toBe(true);
  });

  /**
   * Round-4 finding: F1-HONEST proves the RESTORE branch sets the flag, but not
   * the other branch — failing to remove a destination this invocation
   * published. On an initially EMPTY dist there is nothing to restore, so only
   * that branch can report. Reverting it to a swallowed removal must redden
   * here even though F1-HONEST stays green.
   */
  it('F1-DISCARD-HONEST: a published destination that cannot be removed is reported, not swallowed', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeCommitStep: (step) => {
          if (step !== 'meta') return;
          // The artifact is already published. Turn it into a DIRECTORY so the
          // undo's `rmSync` (non-recursive) fails — deterministic, and unlike a
          // permissions trick root cannot bypass it.
          rmSync(join(distDir, SKILLS_CLASSIFICATION_FILE));
          mkdirSync(join(distDir, SKILLS_CLASSIFICATION_FILE));
          throw new Error('injected commit failure');
        },
      },
    );

    expect(result.staged).toBe(false);
    // The message must name THIS run's residue, not a restore that never
    // applied — on an empty dist there are no backups to inspect.
    expect(result.reason).toContain('partly-published file could NOT be removed');
    expect(result.reason).not.toContain('.staging-bak');
    expect(result.residue).toBe(true);
  });

  /**
   * Round-4 finding: `entryExists` originally read EVERY `lstat` failure as
   * absence. Only ENOENT proves absence — a transient EIO/ESTALE would drop a
   * real pre-existing file from the rollback ledger, let the commit replace it,
   * and then lose it while still reporting a restore. A real filesystem cannot
   * be made to return EIO on demand, so the errno is injected (the seam
   * precedent from the generator's prior-artifact read).
   */
  it('F1-ENOENT-ONLY: a non-ENOENT lstat error aborts staging instead of assuming absence', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('Old published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);
    const newPair = validPair('New candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        // Scoped to the DIST path only. Throwing for every path would abort at
        // the SOURCE probe long before the destination ledger is consulted, so
        // the test would pass with destination handling reverted to a catch-all
        // — it would pin the wrong step entirely (review finding).
        lstatImpl: ((path: string) => {
          if (String(path).startsWith(distDir)) {
            const error = new Error('simulated device failure') as NodeJS.ErrnoException;
            error.code = 'EIO';
            throw error;
          }
          return lstatSync(path);
        }) as typeof lstatSync,
      },
    );

    expect(result.staged).toBe(false);
    // The decisive part: the OLD pair is still there, byte-identical. Treating
    // EIO as absence would have let the candidate replace it unrecorded.
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(oldPair.artifact);
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), 'utf8')).toBe(oldPair.meta);
  });

  /**
   * Round-4 finding: the unremovable-lock warning was produced and printed but
   * never pinned, so deleting either side left the suite green — and a stuck
   * lock silently disables every later stage in that dist.
   */
  it('LOCK-WARN: a lock that cannot be removed is surfaced on an otherwise successful stage', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeCommitStep: (step) => {
          if (step !== 'meta') return;
          // Replace the lock FILE with a directory and let the commit finish:
          // publication succeeds, only its cleanup fails.
          const lock = readdirSync(distDir).find((name) => name.includes('.stage-lock'));
          expect(lock, 'the lock must exist during the commit section').toBeDefined();
          rmSync(join(distDir, lock!));
          mkdirSync(join(distDir, lock!));
        },
      },
    );

    expect(result.staged).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('.stage-lock');
    expect(result.warning).toContain('could not be removed');

    // A warning nobody prints is invisible, so pin the operator-facing text
    // too. The formatter returns ONE string precisely so a caller has no index
    // to drop — printing it is all-or-nothing, and the CLI test covers that.
    const report = formatSkillsStageReport(result);
    expect(report).toContain('staged');
    expect(report).toContain('WARNING skills-classification');
    expect(report.split('\n')).toHaveLength(2);
  });

  it('LOCK-WARN: a clean stage reports no warning line', () => {
    // The negative half: without this, a formatter that ALWAYS emits a warning
    // would satisfy the assertions above.
    const report = formatSkillsStageReport({ staged: true });
    expect(report).not.toContain('WARNING');
    expect(report.split('\n')).toHaveLength(1);
  });

  /**
   * Round-5 finding: the SUCCESS path removed both derived `.staging-bak`
   * paths unconditionally, so a foreign file that merely happened to sit at
   * one of them was deleted by a stage that never created it — the ownership
   * defect the ledger exists to prevent, reintroduced on the happy path.
   */
  it('F1-FOREIGN-BAK: a foreign file at a derived .staging-bak path survives a successful stage', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);

    let foreign = '';
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeMoveAside: (step) => {
          if (step !== 'artifact' || foreign) return;
          // Learn this invocation's token from its own temporary, then plant a
          // foreign file at the backup path it would derive. The dist is empty,
          // so this invocation never creates a backup of its own.
          const tmp = readdirSync(distDir).find((name) => name.includes('.staging-tmp'));
          expect(tmp, 'a temporary must exist by now').toBeDefined();
          const token = tmp!.split('.').slice(-2, -1)[0];
          foreign = join(distDir, `${SKILLS_CLASSIFICATION_FILE}.${token}.staging-bak`);
          writeFileSync(foreign, 'FOREIGN CONTENT');
        },
      },
    );

    expect(result.staged).toBe(true);
    expect(existsSync(foreign)).toBe(true);
    expect(readFileSync(foreign, 'utf8')).toBe('FOREIGN CONTENT');
  });

  /**
   * Round-5 finding: F4-SNAPSHOT's seam is implementation-invoked, so the thing
   * that ACTUALLY guarantees "published bytes == validated bytes" is the
   * read-back check — and nothing pinned it. Corrupting the temporary between
   * the write and the read-back must abort the stage.
   */
  it('F4-READBACK: a temporary corrupted before the read-back never reaches the dist', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        afterStageWrite: () => {
          const tmp = readdirSync(distDir).find(
            (name) => name.startsWith(SKILLS_CLASSIFICATION_FILE) && name.includes('.staging-tmp'),
          );
          expect(tmp, 'the artifact temporary must exist by now').toBeDefined();
          writeFileSync(join(distDir, tmp!), 'CORRUPTED AFTER WRITE');
        },
      },
    );

    expect(result.staged).toBe(false);
    expect(result.reason).toContain('does not match the validated snapshot');
    expect(existsSync(join(distDir, SKILLS_CLASSIFICATION_FILE))).toBe(false);
  });

  /**
   * F1 — publication is serialized. Driving a second stage from INSIDE the
   * first one's commit section is the interleaving the reviewers described
   * (A-artifact → B-artifact → B-meta → A-meta, both reporting success). The
   * lock must turn the inner invocation away, so the dist ends as one
   * self-consistent pair — never a mix of the two.
   */
  it('F1-SERIAL: a concurrent stage cannot interleave into a mixed pair', () => {
    const { dataDir, distDir } = dirs();
    const pairA = validPair('Stager A entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pairA.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pairA.meta);

    const otherData = mkdtempSync(join(tmpdir(), 'skills-stage-data-b-'));
    const pairB = validPair('Stager B entry.');
    writeFileSync(join(otherData, SKILLS_CLASSIFICATION_FILE), pairB.artifact);
    writeFileSync(join(otherData, SKILLS_CLASSIFICATION_META_FILE), pairB.meta);
    expect(pairB.artifact).not.toBe(pairA.artifact);

    let inner: { staged: boolean; reason?: string } | null = null;
    const outer = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeCommitStep: (step) => {
          // Re-enter exactly between A's two commit steps.
          if (step === 'meta' && inner === null) {
            inner = stageSkillsArtifacts({ dataDir: otherData, distDir });
          }
        },
      },
    );

    expect(outer.staged).toBe(true);
    expect(inner).not.toBeNull();
    expect(inner!.staged).toBe(false);
    expect(inner!.reason).toContain('another stage');
    // Pin the stale-lock diagnostic itself: a contended skip must tell an
    // operator which file to remove if no stage is actually running. Without
    // this the wording could regress to a bare "another stage" and the
    // recovery hint would vanish unnoticed (round-3 evidence finding).
    expect(inner!.reason).toContain('stale');
    expect(inner!.reason).toContain('.stage-lock');

    // The decisive assertion: the published pair is wholly A, never A/B or B/A.
    const publishedArtifact = readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8');
    const publishedMeta = readFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), 'utf8');
    expect(publishedArtifact).toBe(pairA.artifact);
    expect(publishedMeta).toBe(pairA.meta);
  });

  /**
   * F4 — the bytes published are the bytes validated. The source is read once;
   * re-opening it at copy time let a generator rewrite land unvalidated.
   *
   * WHAT THIS PIN DOES AND DOES NOT PROVE (re-review finding, recorded rather
   * than papered over). The injection point is a seam the implementation itself
   * invokes, so this test cannot bind an arbitrary implementation: one that
   * re-read both sources immediately BEFORE calling the seam would still pass,
   * and the pre-amendment code ignores the hooks argument entirely, so against
   * that exact predecessor this test passes vacuously. Its real evidentiary
   * weight comes from the mutation proof — replacing the validated-buffer write
   * with `copyFileSync` from the source turns it red — plus the seam-independent
   * read-back check in the implementation, which compares the staged temporary
   * against the validated buffer and so fails any path that publishes different
   * bytes. Treat those two as the guarantee; treat this test as the scenario.
   */
  it('F4-SNAPSHOT: a source rewritten mid-stage cannot reach the dist', () => {
    const { dataDir, distDir } = dirs();
    const validated = validPair('Validated snapshot entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), validated.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), validated.meta);

    const sneaky = validPair('Rewritten after validation.');
    expect(sneaky.artifact).not.toBe(validated.artifact);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        // Injected BEFORE the staging write — the only point that discriminates.
        // An implementation re-opening the source here publishes the rewrite;
        // one writing the validated buffers ignores it. Injecting after the
        // write would pass against both and pin nothing.
        beforeStageWrite: () => {
          writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), sneaky.artifact);
          writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), sneaky.meta);
        },
      },
    );

    expect(result.staged).toBe(true);
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(
      validated.artifact,
    );
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), 'utf8')).toBe(
      validated.meta,
    );
  });
});

/**
 * Round-6 findings — the remediation claims that had no discriminating pin, and
 * the build-side byte agreement for the skills pair itself (every other pair
 * had a collision trap; this one did not).
 */
describe('skills staging — round-6 closure pins', () => {
  it('BUILD-BYTES: a decode-invariant byte mutation is skipped at BUILD time', () => {
    const { dataDir, distDir } = dirs();
    // The fixture carries a literal U+FFFD so its three UTF-8 bytes can be
    // replaced by a bare 0xFF, which decodes straight back to U+FFFD. Byte
    // string differs, decoded text does not — this kills hash(decode(bytes)),
    // not just a BOM special case.
    const pair = validPair('Stage fixture \uFFFD entry.');
    const canonical = Buffer.from(pair.artifact, 'utf8');
    const at = canonical.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      canonical.subarray(0, at),
      Buffer.from([0xff]),
      canonical.subarray(at + 3),
    ]);
    expect(mutated.equals(canonical)).toBe(false);
    expect(mutated.toString('utf8')).toBe(pair.artifact);

    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), mutated);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('hash mismatch');
  });

  it('GUARD: the post-publish digest check fires AND leaves the old pair restored', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('OLD published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);
    const pair = validPair('NEW candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        afterCommit: () =>
          writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'CORRUPTED AFTER COMMIT'),
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('does not match the verified digest');
    // CONSEQUENCE, not just detection: the pre-existing pair must be BACK, the
    // corrupt bytes gone, no residue, and the report must be true. A guard that
    // fires outside the rollback region detects the mismatch and still leaves
    // the bad pair live while claiming a restore (reproduced in review).
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(oldPair.artifact);
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), 'utf8')).toBe(oldPair.meta);
    expect(result.reason).toContain('any pre-existing pair restored');
    expect(
      readdirSync(distDir).filter(
        (name) =>
          name.includes('.staging-tmp') ||
          name.includes('.staging-bak') ||
          name.includes('.stage-lock'),
      ),
    ).toEqual([]);
  });

  it('PARTIAL-TEMP: a temporary write that fails PARTWAY is still discarded (not left unreported)', () => {
    // Round-13 finding (all three legs): the temp path was recorded only AFTER
    // writeFileSync returned, so a mid-write ENOSPC/EFBIG left OUR partial
    // temp on disk unrecorded — the abort path never discarded it, `residue`
    // stayed unset, and the CLI (exit 0) uploaded the leftover. A real
    // filesystem cannot fail a write partway on demand, so inject it: create a
    // partial file at the exclusive path, then throw (the lstatImpl/openImpl
    // seam precedent).
    const { dataDir, distDir } = dirs();
    const pair = validPair('Partial temp entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    let firstWrite = true;
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        writeTempImpl: ((path: string) => {
          if (firstWrite) {
            firstWrite = false;
            // The exclusive create succeeded and the WRITE then failed partway:
            // OUR partial temp exists on disk.
            writeFileSync(path, 'PARTIAL');
            throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
          }
          throw new Error('unexpected second temp write');
        }) as never,
      },
    );
    expect(result.staged).toBe(false);
    // The partial temp must be GONE — the abort path discarded it because the
    // path was registered on the throw, not merely after a clean return.
    expect(readdirSync(distDir).filter((n) => n.includes('.staging-tmp'))).toEqual([]);
  });

  it('CLEANUP-RESIDUE-SUCCESS: an owned .staging-bak that cannot be removed after commit is reported as residue', () => {
    // Round-12 finding (sol + luna@max): on the SUCCESS path a failed backup
    // discard was swallowed — staged:true, no residue, a stale copy of the old
    // artifact left in the public dist. Learn this run's token from its own
    // backup and replace each .staging-bak with a NON-EMPTY directory, which
    // the non-recursive force-rm cannot remove.
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('OLD published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);
    const newPair = validPair('NEW candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        afterCommit: () => {
          for (const name of readdirSync(distDir).filter((n) => n.includes('.staging-bak'))) {
            const bak = join(distDir, name);
            rmSync(bak);
            mkdirSync(bak);
            writeFileSync(join(bak, 'squatter'), 'x'); // non-empty ⇒ force-rm fails
          }
        },
      },
    );
    // Publication SUCCEEDED — the new pair is live — but the run left a backup
    // it could not expunge, so it must report residue, not a clean staged:true.
    expect(result.staged).toBe(true);
    expect(result.residue).toBe(true);
    expect(result.reason).toContain('.staging-bak backup could NOT be removed');
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(newPair.artifact);
  });

  it('CLEANUP-RESIDUE-ABORT: an owned .staging-tmp that cannot be removed on abort is reported as residue', () => {
    // The abort-path twin: a temporary this run created and could not remove.
    const { dataDir, distDir } = dirs();
    const pair = validPair('Abort residue entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        // Replace the temporaries with non-empty directories right after they
        // are written: the very next step (the read-back) then throws EISDIR,
        // aborting the stage, and the abort-path discard cannot remove the
        // directories — a cleanup-residue.
        afterStageWrite: () => {
          for (const name of readdirSync(distDir).filter((n) => n.includes('.staging-tmp'))) {
            const tmp = join(distDir, name);
            rmSync(tmp);
            mkdirSync(tmp);
            writeFileSync(join(tmp, 'squatter'), 'x');
          }
        },
      },
    );
    expect(result.staged).toBe(false);
    expect(result.residue).toBe(true);
    expect(result.reason).toContain('.staging-tmp temporary could NOT be removed');
  });

  it('GUARD-META: a meta rewritten after commit is refused AND the old pair is restored', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('OLD published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);
    const pair = validPair('NEW candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    // The round-8 reproduction: ONLY generated_at changes, so the rewritten
    // meta stays internally coherent with the artifact — classification_sha256
    // still matches — and neither the artifact digest guard nor any runtime
    // validation can reject the pair. Only the meta read-back can, and it must
    // fire INSIDE the protected region so the consequence is a true rollback.
    const rewritten = pair.meta.replace('2026-08-14T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(rewritten).not.toBe(pair.meta);
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        afterCommit: () => writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), rewritten),
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain(
      'published skills-classification meta does not match the validated snapshot',
    );
    // CONSEQUENCE, not just detection: the pre-existing pair is BACK, no
    // residue survives, and the reason's restore claim is true.
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), 'utf8')).toBe(oldPair.artifact);
    expect(readFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), 'utf8')).toBe(oldPair.meta);
    expect(result.reason).toContain('any pre-existing pair restored');
    expect(
      readdirSync(distDir).filter(
        (name) =>
          name.includes('.staging-tmp') ||
          name.includes('.staging-bak') ||
          name.includes('.stage-lock'),
      ),
    ).toEqual([]);
  });

  it('BUILD-BYTES CONTROL: the unmutated fixture stages', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair('Stage fixture \uFFFD entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    expect(stageSkillsArtifacts({ dataDir, distDir }).staged).toBe(true);
  });

  it('SOURCE-ENOENT-ONLY: a non-ENOENT error probing the SOURCES aborts, not "no artifacts"', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        lstatImpl: ((_path: string) => {
          const error = new Error('simulated device failure') as NodeJS.ErrnoException;
          error.code = 'EIO';
          throw error;
        }) as typeof lstatSync,
      },
    );
    expect(result.staged).toBe(false);
    // The actionable failure must survive; reporting "no artifacts present"
    // would hide it forever behind an expected-looking skip.
    expect(result.reason).toContain('simulated device failure');
    expect(result.reason).not.toContain('no skills-classification artifacts present');
  });

  it('LOCK-EEXIST-ONLY: a non-EEXIST lock failure is not reported as contention', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        openImpl: (() => {
          const error = new Error('permission denied') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }) as typeof openSync,
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('could not acquire its lock');
    // Advising an operator to delete a stale lock that never existed is worse
    // than useless.
    expect(result.reason).not.toContain('stale');
  });

  it('LOCK-LEAK: a throwing lstatImpl accessor does not leave the lock behind', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const hooks = {} as { lstatImpl?: typeof lstatSync };
    let reads = 0;
    Object.defineProperty(hooks, 'lstatImpl', {
      get() {
        // The FIRST read is the source probe; the second happens after the lock
        // exists, which is the window this pins.
        reads += 1;
        if (reads > 1) throw new Error('getter exploded');
        return undefined;
      },
    });
    const result = stageSkillsArtifacts({ dataDir, distDir }, hooks);
    expect(result.staged).toBe(false);
    expect(readdirSync(distDir).filter((name) => name.includes('.stage-lock'))).toEqual([]);
  });

  it('BOTH-PROBLEMS: a failed restore AND a stuck published file are BOTH reported', () => {
    const { dataDir, distDir } = dirs();
    const oldPair = validPair('Old published entry.');
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_FILE), oldPair.artifact);
    writeFileSync(join(distDir, SKILLS_CLASSIFICATION_META_FILE), oldPair.meta);
    const newPair = validPair('New candidate entry.');
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), newPair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), newPair.meta);

    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        beforeCommitStep: (step) => {
          if (step !== 'meta') return;
          // Make BOTH failures true at once: the published artifact becomes a
          // directory (its removal will fail) and its backup is destroyed (its
          // restore will fail). Reporting only one drops a real failure, and
          // each sends an operator somewhere different.
          rmSync(join(distDir, SKILLS_CLASSIFICATION_FILE));
          mkdirSync(join(distDir, SKILLS_CLASSIFICATION_FILE));
          const backup = readdirSync(distDir).find(
            (name) => name.startsWith(SKILLS_CLASSIFICATION_FILE) && name.includes('.staging-bak'),
          );
          expect(backup, 'the artifact backup must exist').toBeDefined();
          rmSync(join(distDir, backup!));
          throw new Error('injected commit failure');
        },
      },
    );

    expect(result.staged).toBe(false);
    expect(result.reason).toContain('could NOT be fully restored');
    expect(result.reason).toContain('could NOT be removed');
  });

  it('READBACK-META: corrupting the META temporary is caught too, not just the artifact', () => {
    const { dataDir, distDir } = dirs();
    const pair = validPair();
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_FILE), pair.artifact);
    writeFileSync(join(dataDir, SKILLS_CLASSIFICATION_META_FILE), pair.meta);
    const result = stageSkillsArtifacts(
      { dataDir, distDir },
      {
        afterStageWrite: () => {
          const tmp = readdirSync(distDir).find(
            (name) =>
              name.startsWith(SKILLS_CLASSIFICATION_META_FILE) && name.includes('.staging-tmp'),
          );
          expect(tmp, 'the meta temporary must exist by now').toBeDefined();
          writeFileSync(join(distDir, tmp!), 'CORRUPTED META');
        },
      },
    );
    expect(result.staged).toBe(false);
    expect(result.reason).toContain('does not match the validated snapshot');
  });
});
