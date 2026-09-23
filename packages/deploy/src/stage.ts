import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { AiAnnotationsMetaSchema, AiAnnotationsSchema } from '@starred/ai-schema';
import {
  DiscoveryCandidatesFileSchema,
  DiscoveryCandidatesMetaSchema,
} from '@starred/discovery/contracts';
import {
  SkillsClassificationMetaSchema,
  SkillsClassificationSchema,
  checkSkillsMetaConsistency,
} from '@starred/skills-schema/contracts';
import { verifyDatasetIntegrity } from './dataset';

export const STARS_FILE = 'stars.json';
export const DATASET_META_FILE = 'dataset-meta.json';
export const AI_ANNOTATIONS_FILE = 'ai-annotations.json';
export const AI_ANNOTATIONS_META_FILE = 'ai-annotations-meta.json';
export const DISCOVERY_CANDIDATES_FILE = 'discovery-candidates.json';
export const DISCOVERY_CANDIDATES_META_FILE = 'discovery-candidates-meta.json';
export const SKILLS_CLASSIFICATION_FILE = 'skills-classification.json';
export const SKILLS_CLASSIFICATION_META_FILE = 'skills-classification-meta.json';

/** Files that must never reach the public Pages artifact (telemetry / secrets). */
export const FORBIDDEN_IN_DIST = ['run-meta.json', 'config.yaml', '.env'] as const;

export interface StageOptions {
  /** Directory holding the canonical stars.json + dataset-meta.json (repo root). */
  dataDir: string;
  /** The built dashboard output directory to stage data INTO. */
  distDir: string;
}

export interface StageResult {
  repoCount: number;
  sha256: string;
}

export function assertNoForbiddenFiles(distDir: string): void {
  for (const name of FORBIDDEN_IN_DIST) {
    if (existsSync(resolve(distDir, name))) {
      throw new Error(`forbidden file present in Pages artifact: ${name}`);
    }
  }
}

/**
 * Stage the canonical data files into the built dist, AFTER verifying integrity.
 * The canonical files are only ever READ here, so a failure cannot corrupt them
 * (DEPLOY-3/DEPLOY-4); verification throws before any copy, so invalid data is
 * never staged. Refuses to proceed if a secret/telemetry file is in the dist
 * (BUILD-DATA-3).
 */
export interface DashboardStageHooks {
  /**
   * Invoked after validation and immediately BEFORE the validated buffers are
   * published. The only point from which snapshot fidelity is testable: an
   * implementation that re-opens the sources here publishes whatever a
   * generator has since written, one that publishes the validated buffers does
   * not. Injecting later would pass against both and pin nothing.
   */
  beforePublish?: () => void;
  /**
   * Invoked after the buffers are written and BEFORE the published bytes are
   * re-hashed. The guard is a DETECTOR, and a detector nobody has seen fire is
   * not evidence — this is the only point from which its firing can be driven.
   */
  afterPublish?: () => void;
}

export function stageDashboardData(
  opts: StageOptions,
  hooks: DashboardStageHooks = {},
): StageResult {
  const { dataDir, distDir } = opts;
  if (!existsSync(distDir)) {
    throw new Error(`dist directory not found: ${distDir} (build the dashboard first)`);
  }
  const starsPath = resolve(dataDir, STARS_FILE);
  const metaPath = resolve(dataDir, DATASET_META_FILE);
  if (!existsSync(starsPath) || !existsSync(metaPath)) {
    throw new Error(
      `canonical data not found in ${dataDir} (expected ${STARS_FILE} + ${DATASET_META_FILE})`,
    );
  }

  // BYTES, not decoded text — for BOTH halves. The stars digest is generated
  // over the file's bytes and the runtime loader verifies it that way; the
  // meta is read as bytes too, because a decode→re-encode roundtrip silently
  // NORMALIZES malformed sequences to U+FFFD inside unconstrained string
  // fields — the landed file then differs from the source while a read-back
  // against the re-encoded snapshot still reports success (round-9 finding,
  // reproduced: 190-byte source, 192-byte publication, staged OK). Validation
  // parses the decoded text; publication uses the exact source bytes.
  const starsBytes = readFileSync(starsPath);
  const metaBytes = readFileSync(metaPath);
  const verified = verifyDatasetIntegrity(starsBytes, metaBytes.toString('utf8')); // throws BEFORE any publish
  assertNoForbiddenFiles(distDir); // never ship secrets/telemetry, even if the build emitted them

  hooks.beforePublish?.();
  // Publish the VALIDATED buffers. Re-opening the sources here would re-read
  // bytes nobody checked — a generator rewriting stars.json between validation
  // and publication would ship unvalidated data under the verified hash, and
  // for the CANONICAL dataset that is the base dashboard's ground truth.
  const distStars = resolve(distDir, STARS_FILE);
  writeFileSync(distStars, starsBytes);
  writeFileSync(resolve(distDir, DATASET_META_FILE), metaBytes);

  // STRUCTURAL guard, not a test seam. Review showed that ANY injection point
  // the implementation itself invokes can be defeated by re-reading the source
  // just before it — including re-assigning the validated buffer, which also
  // defeats a read-back comparing against that buffer. So compare what actually
  // LANDED against the digest recorded in META, which no rewrite of the source
  // can influence. "Published == verified" is now enforced, not asserted.
  hooks.afterPublish?.();
  const distMeta = resolve(distDir, DATASET_META_FILE);
  if (!readFileSync(distMeta).equals(metaBytes)) {
    // Meta carries no self-digest, so this is a read-back rather than a digest
    // guard — weaker, and named as such: it catches a re-read regression on the
    // meta half, which the stars digest guard cannot see. Compared against the
    // SOURCE bytes, not a re-encoding, so a normalization can never hide here.
    throw new Error(`published ${DATASET_META_FILE} does not match the validated bytes`);
  }
  const publishedSha = createHash('sha256').update(readFileSync(distStars)).digest('hex');
  if (publishedSha !== verified.meta.stars_sha256) {
    throw new Error(
      `published ${STARS_FILE} does not match the verified digest ` +
        `(published ${publishedSha.slice(0, 12)}…, expected ${verified.meta.stars_sha256.slice(0, 12)}…)`,
    );
  }

  return { repoCount: verified.meta.repo_count, sha256: verified.sha256 };
}

export interface AiStageResult {
  staged: boolean;
  reason?: string;
  /** Set when this run left content in the dist it tried and FAILED to
   * remove. A truthful reason alone was not a consequence (round-11): the
   * CLI exits non-zero on this flag so `bash -e` keeps the dist from
   * shipping rejected bytes. */
  residue?: boolean;
}

/**
 * Stage the OPTIONAL AI artifacts into the dist, FAIL-SOFT: a missing, malformed,
 * or hash-mismatched pair is skipped (never throws), so an AI problem can never
 * block the canonical Pages deployment. The dashboard validates again at runtime.
 */
/** Minimal seams so the post-publish guard below can be shown to FIRE, and so
 * "only ENOENT proves absence" is pinnable (a real filesystem cannot produce
 * EIO/EACCES on demand — same precedent as SkillsStageHooks.lstatImpl). */
export interface OptionalPairHooks {
  /** Invoked after the temporaries are renamed into place and BEFORE the
   * post-publish read-back — the point from which that read-back can be shown
   * to FIRE on a landed-byte mismatch. */
  afterPublish?: () => void;
  lstatImpl?: typeof lstatSync;
  /**
   * Injectable `writeFileSync` for the TEMPORARY writes only: a real filesystem
   * cannot be made to fail a write PARTWAY (ENOSPC/EFBIG after the exclusive
   * create) on demand, so "a partial temp is still cleaned/reported" is
   * otherwise unpinnable (round-13/14). Same precedent as `lstatImpl`.
   */
  writeTempImpl?: typeof writeFileSync;
  /**
   * Injectable `renameSync` for the publish step: a real filesystem cannot be
   * made to fail the SECOND rename (after the first succeeded, without the
   * first also failing in the same directory) on demand, so the torn-pair
   * safety net is otherwise unpinnable (round-15). Same precedent as
   * `writeTempImpl`.
   */
  renameImpl?: typeof renameSync;
}

interface OptionalPublishResult {
  staged: boolean;
  reason?: string;
  residue?: boolean;
}

/**
 * Publish a validated optional pair via OWNERSHIP-SAFE temp+rename (round-14
 * owner ruling A). Writes THIS invocation's validated artifact/meta bytes to
 * uniquely-named temporaries, verifies them, then publishes by renaming each
 * into place.
 *
 * A rename SWAPS the destination directory entry, which is why it is correct
 * where an in-place `writeFileSync(dest, …)` was not (round-14, all three
 * legs): it never follows a destination SYMLINK to corrupt the link's external
 * target (the link entry is replaced, its target untouched); it never truncates
 * a READ-ONLY destination file in place (the entry is swapped, needing dir
 * write, not file write); and it never destroys a pre-existing pair before the
 * swap, so a write/copy FAILURE leaves the existing canonical files intact.
 *
 * Cleanup removes ONLY the temporaries THIS invocation created (a stuck temp is
 * reported as `residue`, which the CLI escalates on). Deliberately NOT a
 * transaction, per the owner's narrow authorization: no pair-level lock, no
 * move-aside/backup ledger, no rollback machinery, no broad stale-temp glob
 * cleanup, no concurrency serialization — concurrent stagers still race under
 * the ACCEPTED last-write-wins residual (a coherent later writer may win; an
 * incoherent interleave is refused by runtime validation). The only residual
 * of the rename itself is a crash BETWEEN the two renames (POSIX has no atomic
 * two-file rename) leaving a torn pair the runtime rejects fail-soft.
 */
function publishOptionalPairAtomically(
  label: string,
  destArtifact: string,
  destMeta: string,
  artifactBytes: Buffer,
  metaBytes: Buffer,
  hooks: OptionalPairHooks,
): OptionalPublishResult {
  const token = randomUUID();
  const tmpArtifact = `${destArtifact}.${token}.staging-tmp`;
  const tmpMeta = `${destMeta}.${token}.staging-tmp`;
  /** ONLY paths THIS invocation exclusively created are ever removed. */
  const ownedTemps: string[] = [];
  const writeTemp = hooks.writeTempImpl ?? writeFileSync;
  const writeOwnedTemp = (path: string, bytes: Buffer): void => {
    try {
      writeTemp(path, bytes, { flag: 'wx' });
      ownedTemps.push(path);
    } catch (error) {
      // The exclusive create having succeeded proves a partial write left OUR
      // temp (register it for cleanup); only `EEXIST` created nothing and is
      // never ours to remove (a randomUUID collision is effectively
      // impossible — this only refuses to touch a planted file).
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') ownedTemps.push(path);
      throw error;
    }
  };
  const cleanupOwnedTemps = (): boolean => {
    let stuck = false;
    for (const path of ownedTemps) {
      try {
        rmSync(path, { force: true });
      } catch {
        stuck = true; // our temp remains in the dist ⇒ residue
      }
    }
    return stuck;
  };
  const failed = (base: string, stuck: boolean): OptionalPublishResult =>
    stuck
      ? {
          staged: false,
          reason: `${base} — this run's temporary could NOT be removed (residue remains)`,
          residue: true,
        }
      : { staged: false, reason: base };
  try {
    writeOwnedTemp(tmpArtifact, artifactBytes);
    writeOwnedTemp(tmpMeta, metaBytes);
    // Verify the temporaries hold this invocation's validated bytes BEFORE the
    // rename, so a mismatch never reaches the destination.
    if (
      !readFileSync(tmpArtifact).equals(artifactBytes) ||
      !readFileSync(tmpMeta).equals(metaBytes)
    ) {
      return failed(
        `${label} staged temporaries do not match the validated snapshot`,
        cleanupOwnedTemps(),
      );
    }
    // A DIRECTORY at a destination cannot be replaced by a rename
    // (ENOTEMPTY/EISDIR). If it obstructs the SECOND rename after the FIRST has
    // already swapped its half, it strands a torn pair (round-15 finding, all
    // three legs) — so REFUSE before publishing anything. Nothing is renamed,
    // the pre-existing pair (if any) is untouched, and the layer simply does
    // not update this run. A symlink is fine (rename replaces the link entry),
    // so only a directory is refused.
    for (const dest of [destArtifact, destMeta]) {
      let entry;
      try {
        entry = lstatSync(dest);
      } catch {
        continue; // absent ⇒ the rename will create it
      }
      if (entry.isDirectory()) {
        return failed(
          `${label} destination is a directory: ${dest} — skipped`,
          cleanupOwnedTemps(),
        );
      }
    }
    // PUBLISH by rename — the pre-existing pair is untouched until each swap.
    const rename = hooks.renameImpl ?? renameSync;
    rename(tmpArtifact, destArtifact);
    ownedTemps.splice(ownedTemps.indexOf(tmpArtifact), 1);
    // The two renames are not one atomic step (POSIX has no two-file rename).
    // If the SECOND fails after the FIRST swapped — a crash, a concurrent
    // perm/obstruction change slipping past the pre-check — the artifact is
    // published but the meta is not: a torn pair we cannot restore (no backup,
    // per ruling A). FLAG it as residue so the CLI FAILS the deploy (exit 4)
    // rather than shipping a torn half-pair. (My round-14 note that this could
    // only follow a crash was wrong — a rename FAILURE reaches it too.)
    try {
      rename(tmpMeta, destMeta);
    } catch (metaRenameError) {
      cleanupOwnedTemps();
      return {
        staged: false,
        reason: `${label} published its artifact but could NOT publish its meta — the dist holds a torn pair (residue remains): ${
          metaRenameError instanceof Error ? metaRenameError.message : 'meta rename failed'
        }`,
        residue: true,
      };
    }
    ownedTemps.splice(ownedTemps.indexOf(tmpMeta), 1);
    hooks.afterPublish?.();
    // Preserve the post-publish exact-byte verification on what LANDED. In a
    // single invocation this always holds (we just renamed our validated
    // temps); a mismatch means a concurrent writer replaced our bytes — the
    // accepted last-write-wins residual — so never claim success for bytes
    // that are not ours. The destination is NOT removed (it is not a temp we
    // own, and it may be another valid stager's pair).
    if (
      !readFileSync(destArtifact).equals(artifactBytes) ||
      !readFileSync(destMeta).equals(metaBytes)
    ) {
      return {
        staged: false,
        reason: `${label} published bytes do not match the validated snapshot (a concurrent writer won)`,
      };
    }
    return { staged: true };
  } catch (error) {
    const stuck = cleanupOwnedTemps();
    const detail = error instanceof Error ? error.message : `${label} staging skipped`;
    return failed(detail, stuck);
  }
}

export function stageAiArtifacts(opts: StageOptions, hooks: OptionalPairHooks = {}): AiStageResult {
  const annPath = resolve(opts.dataDir, AI_ANNOTATIONS_FILE);
  const metaPath = resolve(opts.dataDir, AI_ANNOTATIONS_META_FILE);
  const distAnn = resolve(opts.distDir, AI_ANNOTATIONS_FILE);
  const distAnnMeta = resolve(opts.distDir, AI_ANNOTATIONS_META_FILE);
  // Only ENOENT proves a source is absent (round-10 finding — the same
  // fail-open shape closed for the skills pair in round 6 had been left on
  // both siblings): `existsSync` reports false for EACCES/EIO too, so a
  // transient error read as "no artifacts present" and staging proceeded as
  // if that were the truth.
  const lstat = hooks.lstatImpl ?? lstatSync;
  const present = (path: string): boolean => {
    try {
      lstat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
      throw error;
    }
  };
  let hasAnn: boolean;
  let hasMeta: boolean;
  try {
    hasAnn = present(annPath);
    hasMeta = present(metaPath);
  } catch (error) {
    return {
      staged: false,
      reason: `AI staging could not probe its sources — ${
        error instanceof Error ? error.message : 'source probe failed'
      }`,
    };
  }
  if (!hasAnn && !hasMeta) {
    return { staged: false, reason: 'no AI artifacts present' };
  }
  if (!hasAnn || !hasMeta) {
    return { staged: false, reason: 'incomplete AI artifact pair — skipped' };
  }
  let annBytes: Buffer;
  let metaBytes: Buffer;
  try {
    // BYTES, read once. Build-side acceptance must agree with the runtime
    // loader's, which verifies the exact received bytes: hashing decoded text
    // here would accept an artifact the runtime then rejects, and the layer
    // would go unavailable after a deploy the build called sound.
    annBytes = readFileSync(annPath);
    metaBytes = readFileSync(metaPath);
    const annotations = AiAnnotationsSchema.parse(JSON.parse(annBytes.toString('utf8')));
    const meta = AiAnnotationsMetaSchema.parse(JSON.parse(metaBytes.toString('utf8')));
    if (meta.annotations_sha256 !== createHash('sha256').update(annBytes).digest('hex')) {
      return { staged: false, reason: 'AI artifact hash mismatch — skipped' };
    }
    if (meta.annotation_count !== annotations.annotations.length) {
      return { staged: false, reason: 'AI artifact count mismatch — skipped' };
    }
    if (meta.taxonomy_version !== annotations.taxonomy_version) {
      return { staged: false, reason: 'AI artifact taxonomy mismatch — skipped' };
    }
  } catch (error) {
    return { staged: false, reason: error instanceof Error ? error.message : 'AI staging skipped' };
  }
  // Publish the VALIDATED buffers via ownership-safe temp+rename (round-14
  // ruling A). The in-place `writeFileSync(dest, …)` this replaces followed a
  // destination symlink to corrupt its target, truncated a read-only
  // destination, and destroyed a pre-existing pair on a partial failure.
  return publishOptionalPairAtomically('AI', distAnn, distAnnMeta, annBytes, metaBytes, hooks);
}

export interface DiscoveryStageResult {
  staged: boolean;
  reason?: string;
  /** Same round-11 contract as {@link AiStageResult.residue}. */
  residue?: boolean;
}

export interface SkillsStageResult {
  staged: boolean;
  reason?: string;
  /** Same round-11 contract as {@link AiStageResult.residue}: set when a
   * failed restore or a stuck published destination leaves content this run
   * could not expunge. The lock is NOT residue — it is never served. */
  residue?: boolean;
  /**
   * Set when the publication itself is sound but the dist was left in a state
   * a later run must know about — currently only an unremovable lock file,
   * which would make every subsequent stage skip. Surfaced by the CLI: a
   * cleanup failure that silently disables future staging is exactly the kind
   * of degradation that must be visible.
   */
  warning?: string;
}

/**
 * The operator-facing lines for a skills staging result.
 *
 * Extracted as a pure function so the WARNING path is pinnable: a warning that
 * is produced but never printed is invisible, and a subprocess CLI test cannot
 * force a lock-removal failure from the outside.
 *
 * It returns ONE string rather than a list of lines, deliberately. A list gives
 * a caller an index to drop — a CLI printing only `[0]` would suppress every
 * real warning while the formatter's own tests stayed green (observed in
 * review). With a single value the caller can print it or not, and the existing
 * CLI test already fails if it does not.
 */
export function formatSkillsStageReport(result: SkillsStageResult): string {
  const head = `[deploy] Skills-classification artifacts: ${
    result.staged ? 'staged' : `skipped (${result.reason})`
  }`;
  return result.warning
    ? `${head}\n[deploy] WARNING skills-classification: ${result.warning}`
    : head;
}

/** Seams for the F1/F4 regressions to inject failures and races at exact points. */
export interface SkillsStageHooks {
  /**
   * Invoked after validation, immediately BEFORE the snapshot bytes are written
   * to temporaries. This is where a source rewrite must be injected: an
   * implementation that re-opens the source at this point publishes the rewrite,
   * one that writes the validated buffers does not. Injecting any later would
   * pass against both, and pin nothing.
   */
  beforeStageWrite?: () => void;
  /**
   * Invoked after the snapshot bytes are written to temporaries and BEFORE they
   * are read back. This is the only point from which the read-back check —
   * which is what actually guarantees the published bytes are the validated
   * ones, independently of any seam — can be driven and therefore pinned.
   */
  afterStageWrite?: () => void;
  /**
   * Invoked immediately before each move-aside of a pre-existing destination.
   * Moving the old pair aside is a MULTI-STEP mutation of its own, so it needs
   * its own injection point: a failure between the two moves must still leave
   * the old pair intact.
   */
  beforeMoveAside?: (step: 'artifact' | 'meta') => void;
  /** Invoked immediately before each `rename` of the commit section. */
  beforeCommitStep?: (step: 'artifact' | 'meta') => void;
  /**
   * Invoked after both commit renames and BEFORE the published digest check.
   * The guard is a DETECTOR; a detector nobody has seen fire is not evidence.
   */
  afterCommit?: () => void;
  /**
   * Injectable `lstat`, following the precedent set when the generator's
   * prior-artifact read needed an errno seam: a real filesystem cannot be made
   * to return `EIO`/`ESTALE` on demand, so the only way to pin "any errno other
   * than ENOENT aborts" is to inject it.
   */
  lstatImpl?: typeof lstatSync;
  /**
   * Injectable `open`, for the same reason as `lstatImpl`: a real filesystem
   * cannot be made to fail lock creation with `EACCES`/`ENOTDIR` on demand, so
   * "only EEXIST proves contention" is otherwise unpinnable.
   */
  openImpl?: typeof openSync;
  /**
   * Injectable `writeFileSync` for the TEMPORARY writes only, same precedent:
   * a real filesystem cannot be made to fail a write PARTWAY (ENOSPC/EFBIG
   * after the exclusive create) on demand, so "a partial temp is still
   * cleaned/reported" is otherwise unpinnable (round-13 finding).
   */
  writeTempImpl?: typeof writeFileSync;
}

/**
 * Stage the OPTIONAL M2 skills-classification artifacts into the dist,
 * FAIL-SOFT like AI/discovery (P7 §4.10): absent pair → skipped; incomplete
 * pair, schema violation, byte-hash mismatch, or a meta↔artifact
 * cross-invariant breach (C-1..C-4/A-1..A-3, stars-independent) → skipped
 * with the reason named; never throws, so a classification problem can never
 * block the canonical Pages deployment. The dashboard re-validates the same
 * contract at runtime. NOTE deliberately absent: any comparison of
 * `generated_against_stars_sha256` to the live dataset — provenance is not a
 * staging gate (§2.1).
 *
 * PUBLICATION IS TRANSACTIONAL (review findings F1/F4). The previous
 * copy-then-rename version lacked all three of these:
 *
 *   SNAPSHOT FIDELITY — each source file is read EXACTLY ONCE and every later
 *     step uses those same in-memory bytes. Re-opening the sources to copy them
 *     let a generator rewriting a file mid-stage publish bytes that were never
 *     validated, while still reporting success.
 *   SERIALIZATION — the commit section runs under an exclusive lock, so two
 *     concurrent stagers cannot interleave (A-artifact → B-artifact → B-meta →
 *     A-meta) into a mixed pair that both invocations call `staged: true`.
 *   ROLLBACK — a pre-existing pair is moved aside before the commit and put
 *     back if any step fails, so a failed re-stage leaves it byte-identical
 *     instead of half-replaced.
 *
 * `staged: true` therefore means BOTH files of this invocation's validated
 * snapshot are in place — never a mixed pair.
 *
 * BOUNDED, NOT CLOSED — crash atomicity. The guarantees above are
 * exception-safe, not crash-safe: POSIX offers no atomic rename of two
 * independent files, so a process killed between the two commit renames leaves
 * a new artifact beside no meta (plus the lock and backups), and no `finally`
 * can run to report or undo it. What bounds the consequence is the layer's own
 * design rather than this function: the runtime loader verifies the pair's
 * digest, so a torn pair fails soft to `unavailable` and the base browser is
 * unaffected, and the next stage skips with a NAMED stale-lock reason instead
 * of silently doing nothing. Closing it properly would mean publishing the pair
 * as one unit (a single file, or a directory swapped atomically) — an artifact
 * layout change, not a staging change, and out of this slice's scope.
 *
 * Residual, deliberately not closed (review finding F2, owner-accepted): the
 * temporaries are exclusive-CREATED and their contents verified before use, but
 * `rename` still resolves by path, so an adversary who can write into the dist
 * directory retains a narrow window. Closing it needs fd-relative renames Node
 * does not expose; a glob/sweep "fix" is explicitly forbidden — that is how the
 * earlier foreign-file ownership defect entered.
 */
export function stageSkillsArtifacts(
  opts: StageOptions,
  hooks: SkillsStageHooks = {},
): SkillsStageResult {
  const artifactPath = resolve(opts.dataDir, SKILLS_CLASSIFICATION_FILE);
  const metaPath = resolve(opts.dataDir, SKILLS_CLASSIFICATION_META_FILE);
  try {
    // Only ENOENT proves a source is absent. `existsSync` reports false for an
    // unreadable parent too, so the honest "nothing to stage" outcome and an
    // actionable EACCES/EIO would have been indistinguishable — the failure
    // would be reported as "no artifacts present" and quietly ignored forever.
    const sourceLstat = hooks.lstatImpl ?? lstatSync;
    const sourcePresent = (path: string): boolean => {
      try {
        sourceLstat(path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
        throw error;
      }
    };
    const hasArtifact = sourcePresent(artifactPath);
    const hasMeta = sourcePresent(metaPath);
    if (!hasArtifact && !hasMeta) {
      return { staged: false, reason: 'no skills-classification artifacts present' };
    }
    if (!hasArtifact || !hasMeta) {
      return { staged: false, reason: 'incomplete skills-classification artifact pair — skipped' };
    }
    // A. READ ONCE. These buffers are the snapshot: validated below, published
    //    below, never re-read from disk in between.
    const artifactBytes = readFileSync(artifactPath);
    const metaBytes = readFileSync(metaPath);

    const artifact = SkillsClassificationSchema.parse(JSON.parse(artifactBytes.toString('utf8')));
    const meta = SkillsClassificationMetaSchema.parse(JSON.parse(metaBytes.toString('utf8')));
    // Hashed over the snapshot BYTES, matching how the digest was generated.
    if (meta.classification_sha256 !== createHash('sha256').update(artifactBytes).digest('hex')) {
      return { staged: false, reason: 'skills-classification hash mismatch — skipped' };
    }
    const problems = checkSkillsMetaConsistency(meta, artifact);
    if (problems.length > 0) {
      return {
        staged: false,
        reason: `skills-classification meta↔artifact mismatch — skipped (${problems[0]})`,
      };
    }

    const distArtifact = resolve(opts.distDir, SKILLS_CLASSIFICATION_FILE);
    const distMeta = resolve(opts.distDir, SKILLS_CLASSIFICATION_META_FILE);
    const lockPath = resolve(opts.distDir, `${SKILLS_CLASSIFICATION_FILE}.stage-lock`);

    // B. SERIALIZE. Exclusive create IS the lock; a concurrent stager is turned
    //    away with a named reason rather than allowed to interleave. Skipping
    //    is the fail-soft outcome — the deploy is never blocked.
    let lockFd: number;
    try {
      lockFd = (hooks.openImpl ?? openSync)(lockPath, 'wx');
    } catch (lockError) {
      // Only EEXIST proves contention. Anything else (EACCES on a read-only
      // dist, ENOTDIR, EIO) is an actionable failure that must not be dressed
      // up as "someone else is publishing" — that reading sends an operator to
      // delete a lock file that was never the problem.
      if ((lockError as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        return {
          staged: false,
          reason: `skills-classification staging could not acquire its lock — ${
            lockError instanceof Error ? lockError.message : 'lock creation failed'
          }`,
        };
      }
      return {
        staged: false,
        reason: `skills-classification pair is locked by another stage — skipped (if no stage is running, ${lockPath} is stale and can be removed)`,
      };
    }

    /** Only paths THIS invocation created are ever removed. */
    const created: string[] = [];
    /** Set when a rollback could not put the pre-existing pair back. */
    let restoreFailed = false;
    /** Set when this invocation's own published file could not be removed. */
    let publishedResidue = false;
    /** Set when the lock survives cleanup — every later stage would then skip. */
    let lockStuck = false;
    /**
     * Set when a temporary or backup THIS invocation created could not be
     * removed (round-12 finding). These sit at non-served `.staging-tmp`/
     * `.staging-bak` names, so the runtime never fetches them — but they are
     * this run's own data left in a public dist, exactly the "content it tried
     * and FAILED to expunge" the residue contract covers. Swallowing the
     * failure let a successful stage report `staged:true` with a stale backup
     * still in the upload directory.
     */
    let cleanupResidue = false;
    let result: SkillsStageResult;
    /** Removal that REPORTS its outcome; the caller decides whether it matters. */
    const discardOk = (path: string): boolean => {
      try {
        rmSync(path, { force: true });
        return true;
      } catch {
        return false;
      }
    };
    /**
     * True when a directory ENTRY exists at `path`, symlinks included.
     *
     * `existsSync` resolves the target, so it reports FALSE for a dangling
     * symlink even though the entry is really there — which would leave that
     * entry out of the rollback ledger and let the commit destroy it
     * unrecorded (probed: existsSync false, lstat succeeds, rename over it
     * succeeds).
     *
     * ONLY `ENOENT` proves absence. A catch-all would read a transient `EIO`
     * or `ESTALE` as "nothing there", drop a real file from the ledger and lose
     * it on rollback while still reporting a restore — the same fail-open shape
     * this repo already fixed once in the generator's prior-artifact read. Any
     * other errno therefore aborts staging before anything is touched.
     */
    try {
      // EVERYTHING between acquiring the lock and installing its `finally`
      // lives in here, including the `hooks.lstatImpl` property READ — a
      // throwing accessor there previously escaped and leaked the lock,
      // reintroducing a window this function had already closed once.
      const lstat = hooks.lstatImpl ?? lstatSync;
      const entryExists = (path: string): boolean => {
        try {
          lstat(path);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
          throw error;
        }
      };
      const token = randomUUID();
      const tmpArtifact = `${distArtifact}.${token}.staging-tmp`;
      const tmpMeta = `${distMeta}.${token}.staging-tmp`;
      const bakArtifact = `${distArtifact}.${token}.staging-bak`;
      const bakMeta = `${distMeta}.${token}.staging-bak`;

      // Destination shape is re-checked INSIDE the lock: a plan-time check
      // would already be stale by the time the commit section runs.
      for (const destination of [distArtifact, distMeta]) {
        if (entryExists(destination) && lstatSync(destination).isDirectory()) {
          throw new Error(`destination is a directory: ${destination}`);
        }
      }

      // Write the VALIDATED bytes (not a re-read of the source), exclusively,
      // then read back to prove what landed is what was validated.
      //
      // A partial write (ENOSPC/EFBIG after the exclusive create succeeded)
      // leaves OUR temp on disk and then throws — register it for cleanup
      // BEFORE the write cannot see it (round-13 finding: recording only after
      // the write returned meant a mid-write throw left an unreported temp the
      // CLI then uploaded). `wx` makes ownership provable: an EEXIST throw
      // created nothing (foreign file, never ours to remove); ANY other throw
      // means the exclusive open succeeded and the WRITE failed, so the temp
      // is ours to discard.
      const writeTemp = hooks.writeTempImpl ?? writeFileSync;
      const writeTempExclusive = (path: string, bytes: Buffer): void => {
        try {
          writeTemp(path, bytes, { flag: 'wx' });
          created.push(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') created.push(path);
          throw error;
        }
      };
      hooks.beforeStageWrite?.();
      writeTempExclusive(tmpArtifact, artifactBytes);
      writeTempExclusive(tmpMeta, metaBytes);
      hooks.afterStageWrite?.();
      if (
        !readFileSync(tmpArtifact).equals(artifactBytes) ||
        !readFileSync(tmpMeta).equals(metaBytes)
      ) {
        throw new Error('staged temporary does not match the validated snapshot');
      }

      // C. PUBLISH UNDER ROLLBACK. Moving the old pair aside is itself part of
      //    the protected region: an earlier version left those two renames
      //    outside it, so a failure BETWEEN them stranded the old artifact
      //    under its backup name while the reason still claimed a restore.
      //
      //    Two ledgers make the undo exact. `movedAside` records what to put
      //    back; `published` records the destinations THIS invocation actually
      //    wrote — and only those are ever removed. Discarding destinations
      //    unconditionally would delete a pre-existing file that is still in
      //    place when the FIRST move-aside is what failed.
      const movedAside: Array<[backup: string, destination: string]> = [];
      const published: string[] = [];
      let committed = false;
      try {
        hooks.beforeMoveAside?.('artifact');
        if (entryExists(distArtifact)) {
          renameSync(distArtifact, bakArtifact);
          movedAside.push([bakArtifact, distArtifact]);
        }
        hooks.beforeMoveAside?.('meta');
        if (entryExists(distMeta)) {
          renameSync(distMeta, bakMeta);
          movedAside.push([bakMeta, distMeta]);
        }
        hooks.beforeCommitStep?.('artifact');
        renameSync(tmpArtifact, distArtifact);
        published.push(distArtifact);
        hooks.beforeCommitStep?.('meta');
        renameSync(tmpMeta, distMeta);
        published.push(distMeta);

        // STRUCTURAL guard, INSIDE the protected region and BEFORE `committed`.
        // Detecting a mismatch is only half the job: run it after the region
        // and a detected failure still leaves the bad pair live, the old pair
        // stranded under `.staging-bak`, and the reason claiming a restore that
        // never happened. Here the throw takes the normal rollback path, so the
        // pre-existing pair comes back and the report is true.
        hooks.afterCommit?.();
        const publishedSha = createHash('sha256').update(readFileSync(distArtifact)).digest('hex');
        if (publishedSha !== meta.classification_sha256) {
          throw new Error('published skills-classification does not match the verified digest');
        }
        // META read-back, inside the protected region for the same reason as
        // the digest guard above (a detection outside it leaves the bad pair
        // live while the reason claims a restore). The meta carries no
        // self-digest — generated_at differs per run — so this is a read-back
        // against THIS invocation's validated snapshot, and it is the ONLY
        // check that can catch a post-validation meta rewrite: such a pair
        // stays internally coherent, so neither the digest guard above nor any
        // runtime validation can reject it.
        if (!readFileSync(distMeta).equals(metaBytes)) {
          throw new Error(
            'published skills-classification meta does not match the validated snapshot',
          );
        }

        committed = true;
      } finally {
        if (!committed) {
          // Removing what WE published is part of the undo, not inert cleanup:
          // a failure here leaves a partial canonical artifact behind, so it
          // must reach the reason rather than be swallowed.
          for (const destination of published) {
            // Distinct from a failed RESTORE: here our own file is stuck in
            // place. Reporting it as "could not restore the pre-existing pair"
            // would send an operator hunting for backups that never existed.
            if (!discardOk(destination)) publishedResidue = true;
          }
          for (const [backup, destination] of movedAside.reverse()) {
            try {
              renameSync(backup, destination);
            } catch {
              // Report it rather than pretend; the reason below stops claiming
              // a restore that did not happen.
              restoreFailed = true;
            }
          }
        }
      }

      // Only reached on a committed publication — a failure above propagates
      // out of the `finally` to the abort handler below.
      //
      // Remove ONLY the backups this invocation actually made. Discarding both
      // derived `.staging-bak` paths unconditionally deletes a foreign file
      // that merely happens to sit at one of them — the very ownership defect
      // the ledger exists to prevent, reintroduced on the success path.

      for (const [backup] of movedAside) if (!discardOk(backup)) cleanupResidue = true;
      result = cleanupResidue
        ? {
            staged: true,
            reason:
              "staged, but this run's .staging-bak backup could NOT be removed — the dist holds a stale copy",
            residue: true,
          }
        : { staged: true };
    } catch (stageError) {
      for (const path of created) if (!discardOk(path)) cleanupResidue = true;
      const detail = stageError instanceof Error ? stageError.message : 'staging failed';
      // Never claim a restore that did not happen (acceptance item D).
      // BOTH can be true at once, and each sends an operator somewhere
      // different. Picking one silently drops a real failure from the report.
      const problems: string[] = [];
      if (restoreFailed) {
        problems.push(
          'the pre-existing pair could NOT be fully restored — inspect the .staging-bak files in the dist',
        );
      }
      if (publishedResidue) {
        problems.push(
          "this run's partly-published file could NOT be removed — the dist holds an unpaired artifact",
        );
      }
      if (cleanupResidue) {
        problems.push(
          "this run's .staging-tmp temporary could NOT be removed — the dist holds a leftover",
        );
      }
      const trailer = problems.length
        ? ` AND ${problems.join('; AND ')}`
        : ', any pre-existing pair restored';
      result = {
        staged: false,
        reason: `skills-classification staging aborted${trailer} — ${detail}`,
        ...(restoreFailed || publishedResidue || cleanupResidue ? { residue: true } : {}),
      };
    } finally {
      try {
        closeSync(lockFd);
      } catch {
        /* the descriptor is irrelevant once the file is gone */
      }
      // A lock that cannot be removed makes EVERY later stage skip. That is a
      // silent disable if it is only swallowed, so it rides out on the result.
      lockStuck = !discardOk(lockPath);
    }
    if (lockStuck) {
      result.warning = `the staging lock ${lockPath} could not be removed — later stages will skip until it is deleted`;
    }
    return result;
  } catch (error) {
    return {
      staged: false,
      reason: error instanceof Error ? error.message : 'skills-classification staging skipped',
    };
  }
}

/**
 * Stage OPTIONAL Discovery Inbox artifacts into the dist, FAIL-SOFT like AI
 * artifacts. The dashboard performs the same schema/hash/count checks at
 * runtime, but Pages should only publish artifacts that are internally coherent.
 */
export function stageDiscoveryArtifacts(
  opts: StageOptions,
  hooks: OptionalPairHooks = {},
): DiscoveryStageResult {
  const candidatesPath = resolve(opts.dataDir, DISCOVERY_CANDIDATES_FILE);
  const metaPath = resolve(opts.dataDir, DISCOVERY_CANDIDATES_META_FILE);
  const distCandidates = resolve(opts.distDir, DISCOVERY_CANDIDATES_FILE);
  const distCandidatesMeta = resolve(opts.distDir, DISCOVERY_CANDIDATES_META_FILE);
  // Only ENOENT proves absence — same round-10 closure as the AI pair above.
  const lstat = hooks.lstatImpl ?? lstatSync;
  const present = (path: string): boolean => {
    try {
      lstat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
      throw error;
    }
  };
  let hasCandidates: boolean;
  let hasMeta: boolean;
  try {
    hasCandidates = present(candidatesPath);
    hasMeta = present(metaPath);
  } catch (error) {
    return {
      staged: false,
      reason: `discovery staging could not probe its sources — ${
        error instanceof Error ? error.message : 'source probe failed'
      }`,
    };
  }
  if (!hasCandidates && !hasMeta) {
    return { staged: false, reason: 'no discovery artifacts present' };
  }
  if (!hasCandidates || !hasMeta) {
    return { staged: false, reason: 'incomplete discovery artifact pair — skipped' };
  }
  let candidatesBytes: Buffer;
  let metaBytes: Buffer;
  try {
    // BYTES, read once — same reasoning as the AI pair above: build-side
    // acceptance must agree with the runtime loader's byte-exact check.
    candidatesBytes = readFileSync(candidatesPath);
    metaBytes = readFileSync(metaPath);
    const candidates = DiscoveryCandidatesFileSchema.parse(
      JSON.parse(candidatesBytes.toString('utf8')),
    );
    const meta = DiscoveryCandidatesMetaSchema.parse(JSON.parse(metaBytes.toString('utf8')));
    if (meta.dataset_sha !== createHash('sha256').update(candidatesBytes).digest('hex')) {
      return { staged: false, reason: 'discovery artifact hash mismatch — skipped' };
    }
    if (meta.candidate_count !== candidates.candidates.length) {
      return { staged: false, reason: 'discovery artifact count mismatch — skipped' };
    }
  } catch (error) {
    return {
      staged: false,
      reason: error instanceof Error ? error.message : 'discovery staging skipped',
    };
  }
  // Publish via the same ownership-safe temp+rename as the AI pair (round-14
  // ruling A), applied to BOTH halves.
  return publishOptionalPairAtomically(
    'discovery',
    distCandidates,
    distCandidatesMeta,
    candidatesBytes,
    metaBytes,
    hooks,
  );
}

export const SKILLS_SOURCE_FILE = 'skills-classified.md';

export interface SkillsSourceStageResult {
  staged: boolean;
  reason?: string;
  /** Round-11 contract: set when bytes this run ADJUDICATED for the dist —
   * its own temp after a failed publish, or a pre-existing destination it
   * classified as stale — could not be removed, so the dist would ship
   * content the run tried and failed to expunge. The CLI exits 4 on it. */
  residue?: boolean;
  /** Non-fatal condition a later run must know about (the pair protocol's
   * `warning` semantics) — currently only a stage lock this run created and
   * could not remove, which would make every subsequent stage skip. */
  warning?: string;
}

/** Injectable seams, mirroring the pair protocol's precedent (the M2.2 R4
 * `readOptional` io-seam rationale): a real filesystem cannot deterministically
 * fail removal of THIS run's own unique-named temp (`rmImpl`), a mid-write
 * (`writeImpl`) or a descriptor close (`closeImpl`), and each of those paths
 * carries a pinned contract (residue-SETTING, the publish-failure funnel). */
export interface SkillsSourceStageHooks {
  rmImpl?: typeof rmSync;
  writeImpl?: typeof writeFileSync;
  closeImpl?: typeof closeSync;
  /** Temp-file open only — the LOCK always uses the real `openSync`, so the
   * seam can drive the inner hard-failure path without being able to fake
   * the serialization primitive itself. */
  openImpl?: typeof openSync;
}

/**
 * The operator-facing line(s) for a source-document staging result — ONE
 * string from a pure formatter for the same reason as
 * {@link formatSkillsStageReport}: a list would give the CLI an index to
 * drop, silently suppressing the warning while the formatter's tests pass.
 */
export function formatSkillsSourceStageReport(result: SkillsSourceStageResult): string {
  const head = `[deploy] Skills source document: ${
    result.staged ? 'staged' : `skipped (${result.reason})`
  }`;
  return result.warning
    ? `${head}\n[deploy] WARNING skills source document: ${result.warning}`
    : head;
}

/**
 * Stage the vendored classification source document for the §4.12 same-origin
 * `.md` download — SEPARATE from {@link stageSkillsArtifacts} by design: the
 * pair protocol's backup/rollback machinery exists for a two-file commit;
 * this is a single file whose `rename` is atomic on its own. What it DOES
 * share with the pair protocol is the LOCK: meta-coherence is a relationship
 * with the pair, so this stage serializes under the same
 * `skills-classification.json.stage-lock` (pre-commit R1, luna@ultra + sol
 * convergent) — a concurrent pair re-stage can no longer replace the meta
 * between this function's verification and its publish.
 *
 * Coherence target = the meta actually PRESENT IN DIST (whatever staged it,
 * this run or a pre-existing pair): the download is advertised as the source
 * of the SERVED artifact, so a root `.md` edited without regeneration must
 * never ship as the provenance of an artifact it did not produce. Every skip
 * is named and fail-soft — the canonical deploy proceeds; the download
 * degrades to 404, a deploy-log-visible condition, not a runtime state.
 *
 * EVERY under-lock outcome that is not a successful publish CONVERGES the
 * destination (pre-commit R1 3/3 + R2b sol: the publish-FAILURE arm and
 * inner hard failures owe the same duty as the named skips — an ENOSPC
 * mid-write beside a stale pre-existing copy must not leave those bytes to
 * ship next to a fresh meta): a pre-existing regular-file destination is
 * retained only when its bytes hash-match the served meta (a still-coherent
 * earlier stage) and removed otherwise; a DIRECTORY at the destination is an
 * obstruction — refused and left untouched with no residue, the pair
 * protocol's own R15 obstruction precedent (removal of directories was never
 * in contract, and the deploy stays fail-soft). Overwriting a regular-file
 * DESTINATION on publish is the intended convergence (the pair protocol does
 * the same at its canonical names); the never-overwrite-foreign-files
 * discipline applies to the unique TEMP name, which is exclusive-created.
 * Rejected bytes are never written: verification precedes the first write,
 * and every post-open publish failure funnels through one cleanup path. The
 * stuck-lock warning survives every path — including inner hard failures —
 * because the generic catch lives INSIDE the lock scope (R2b sol).
 */
export function stageSkillsSourceDocument(
  opts: StageOptions,
  hooks: SkillsSourceStageHooks = {},
): SkillsSourceStageResult {
  const rm = hooks.rmImpl ?? rmSync;
  const writeTemp = hooks.writeImpl ?? writeFileSync;
  const closeTemp = hooks.closeImpl ?? closeSync;
  const openTemp = hooks.openImpl ?? openSync;
  const destPath = resolve(opts.distDir, SKILLS_SOURCE_FILE);

  /** Converge a pre-existing destination this run cannot certify; returns a
   * reason suffix and flags `staleResidue` when adjudicated-stale bytes could
   * not be removed. Directories are obstructions, not adjudicable content. */
  let staleResidue = false;
  const convergeDestination = (servedSha256: string | null): string => {
    let entry;
    try {
      entry = lstatSync(destPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return ''; // nothing to converge
      entry = null; // unreadable entry ⇒ fall through to the uncertifiable arm
    }
    if (entry?.isDirectory()) {
      return '; destination obstructed by a directory — left untouched (fail-soft, the pair protocol’s obstruction precedent)';
    }
    let destBytes: Buffer | null = null;
    try {
      destBytes = readFileSync(destPath);
    } catch {
      destBytes = null; // unreadable ⇒ uncertifiable ⇒ must remove
    }
    if (
      destBytes !== null &&
      servedSha256 !== null &&
      createHash('sha256').update(destBytes).digest('hex') === servedSha256
    ) {
      // Still coherent with the served meta (an earlier stage's work) — keep it.
      return '; existing dist copy retained — it matches the served meta';
    }
    try {
      rm(destPath, { force: true });
      return '; stale dist copy removed — download degrades to 404';
    } catch {
      staleResidue = true;
      return `; stale dist copy could NOT be removed (${destPath}) — dist would serve bytes that are not the served artifact's source`;
    }
  };
  const skip = (reason: string, servedSha256: string | null): SkillsSourceStageResult => {
    const converged = convergeDestination(servedSha256);
    return {
      staged: false,
      reason: `${reason}${converged}`,
      ...(staleResidue ? { residue: true } : {}),
    };
  };

  // Only ENOENT proves a source is absent (the same rule as the pair stage:
  // an unreadable parent must surface as a failure, not "nothing to stage").
  let sourceBytes: Buffer | null;
  try {
    sourceBytes = readFileSync(resolve(opts.dataDir, SKILLS_SOURCE_FILE));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return {
        staged: false,
        reason: `skills-classified.md staging failed — ${
          error instanceof Error ? error.message : 'source unreadable'
        }`,
      };
    }
    sourceBytes = null; // absent source still owes destination convergence below
  }

  // SERIALIZE with pair staging: exclusive-create of the SAME lock the pair
  // protocol uses. While this run holds it, a concurrent pair stage is
  // turned away with its own named reason, so the meta read below cannot be
  // replaced before the rename — the platform primitive that CLOSES the
  // race a re-read could only narrow.
  const lockPath = resolve(opts.distDir, `${SKILLS_CLASSIFICATION_FILE}.stage-lock`);
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, 'wx');
  } catch (lockError) {
    // Only EEXIST proves contention (the pair protocol's own distinction):
    // anything else is an actionable failure, not "someone is publishing".
    if ((lockError as NodeJS.ErrnoException)?.code !== 'EEXIST') {
      return {
        staged: false,
        reason: `skills-classified.md staging could not acquire the stage lock — ${
          lockError instanceof Error ? lockError.message : 'lock creation failed'
        }`,
      };
    }
    return {
      staged: false,
      reason: `skills-classification pair is locked by another stage — skipped (if no stage is running, ${lockPath} is stale and can be removed)`,
    };
  }

  let lockWarning: string | undefined;
  let result: SkillsSourceStageResult;
  // Hoisted to the lock scope so the generic catch below can still converge
  // with the sha it DID read — a hard failure after a successful meta read
  // must not demote a coherent pre-existing copy to "uncertifiable".
  let servedSourceSha256: string | null = null;
  try {
    // Read the SERVED meta under the lock. Absent / unreadable / invalid ⇒
    // there is no certifiable served pair, so no download may stand.
    let metaProblem: string | null = null;
    try {
      const metaBytes = readFileSync(resolve(opts.distDir, SKILLS_CLASSIFICATION_META_FILE));
      servedSourceSha256 = SkillsClassificationMetaSchema.parse(
        JSON.parse(metaBytes.toString('utf8')),
      ).source_sha256;
    } catch (error) {
      metaProblem =
        (error as NodeJS.ErrnoException)?.code === 'ENOENT'
          ? 'no served skills-classification meta in dist — download not staged'
          : 'served skills-classification meta unreadable/invalid — download not staged';
    }

    if (servedSourceSha256 === null) {
      result = skip(metaProblem ?? 'served skills-classification meta unavailable', null);
    } else if (sourceBytes === null) {
      result = skip('no skills-classified.md source present', servedSourceSha256);
    } else {
      const actualSha256 = createHash('sha256').update(sourceBytes).digest('hex');
      if (actualSha256 !== servedSourceSha256) {
        result = skip(
          `skills-classified.md does not match the served meta source_sha256 — skipped (source ${actualSha256.slice(0, 12)}…, served ${servedSourceSha256.slice(0, 12)}…)`,
          servedSourceSha256,
        );
      } else {
        // PUBLISH: unique temp + exclusive create, then atomic rename onto
        // the destination. EVERY post-open failure — write, close, rename —
        // funnels through one cleanup path (pre-commit R1: a closeSync
        // throw previously escaped to the generic catch with the temp left
        // unflagged; R2b pinned via the writeImpl/closeImpl seams).
        const tempPath = resolve(opts.distDir, `${SKILLS_SOURCE_FILE}.staging-tmp-${randomUUID()}`);
        const fd = openTemp(tempPath, 'wx');
        let publishFailure: string | null = null;
        try {
          writeTemp(fd, sourceBytes);
        } catch (error) {
          publishFailure = error instanceof Error ? error.message : 'temp write failed';
        }
        // Exactly ONE close attempt on every path — a second close of a
        // possibly-already-closed descriptor could hit a reused fd.
        try {
          closeTemp(fd);
        } catch (error) {
          publishFailure ??= error instanceof Error ? error.message : 'temp close failed';
        }
        if (publishFailure === null) {
          try {
            renameSync(tempPath, destPath);
          } catch (error) {
            publishFailure = error instanceof Error ? error.message : 'rename failed';
          }
        }
        if (publishFailure !== null) {
          let tempResidue = false;
          try {
            rm(tempPath, { force: true });
          } catch {
            tempResidue = true;
          }
          // The failure arm owes the SAME convergence duty as a named skip
          // (R2b sol): a stale pre-existing copy must not outlive a failed
          // publish and ship beside the (possibly fresh) served meta.
          const converged = convergeDestination(servedSourceSha256);
          result = {
            staged: false,
            reason: `skills-classified.md publish failed — ${publishFailure}${
              tempResidue ? ` (own temp could not be removed: ${tempPath})` : ''
            }${converged}`,
            ...(tempResidue || staleResidue ? { residue: true } : {}),
          };
        } else {
          result = { staged: true };
        }
      }
    }
  } catch (error) {
    // Generic hard failure INSIDE the lock scope (e.g. the temp could not be
    // exclusive-created): still owes convergence — the destination is exactly
    // as uncertified as on a named skip — and still flows through the
    // warning-merge below, so a stuck lock is never silently dropped (R2b sol).
    result = skip(
      `skills-classified.md staging failed — ${
        error instanceof Error ? error.message : 'unexpected failure'
      }`,
      servedSourceSha256,
    );
  } finally {
    try {
      closeSync(lockFd);
    } catch {
      /* the lock file itself is what matters; removal is attempted next */
    }
    try {
      rm(lockPath, { force: true });
    } catch {
      lockWarning = `stage lock could not be removed (${lockPath}) — every later skills stage will skip until it is cleared`;
    }
  }
  return lockWarning ? { ...result, warning: lockWarning } : result;
}

/**
 * True when ANY staging result left REJECTED bytes it could not remove — the
 * deploy must fail rather than upload them (round-11 consequence; round-13
 * ownership). Extracted and exported so the escalation DECISION is unit-pinned
 * over every layer, independent of the CLI subprocess: after the round-13
 * ownership fix a stager only reports `residue` for its OWN un-removable
 * write, which requires a read-only dist directory that would already have
 * failed the canonical write — so an end-to-end residue can no longer be
 * constructed from a black box, and the per-layer decision is pinned here
 * instead (the stagers' residue-SETTING is pinned directly: STUCK-RESIDUE for
 * the optional pairs, CLEANUP-RESIDUE / PARTIAL-TEMP for the skills pair).
 */
export function distHasUnshippableResidue(results: ReadonlyArray<{ residue?: boolean }>): boolean {
  return results.some((result) => result.residue === true);
}
