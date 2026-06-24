import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DeferredError, ValidationFailedError } from '@starred/github-client';
import { DatasetMetaSchema, SCHEMA_VERSION, StarsFileSchema } from '@starred/schema';
import type { GitPublisher } from './git';
import { sha256 } from './serialize';

const COMMIT_MESSAGE = 'chore(data): update starred repositories';

/**
 * Empty-result safety guard (F2). Refuses to publish an empty dataset over a
 * non-empty previous one unless `allow_empty`. The "previous valid count" comes
 * from the existing schema-valid stars.json (the canonical source), not just
 * dataset-meta. An existing-but-invalid stars.json is an untrusted prerequisite.
 */
export function checkEmptyGuard(opts: {
  outDir: string;
  starsFileName: string;
  exportedCount: number;
  allowEmpty: boolean;
}): void {
  if (opts.exportedCount > 0 || opts.allowEmpty) return;

  const path = resolve(opts.outDir, opts.starsFileName);
  if (!existsSync(path)) return; // first run, no previous dataset → empty is allowed

  let previousCount: number;
  try {
    const parsed = StarsFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      throw new DeferredError(
        'existing stars.json is schema-invalid; publication prerequisite is untrusted',
        'PREREQUISITE_INVALID',
      );
    }
    previousCount = parsed.data.repos.length;
  } catch (err) {
    if (err instanceof DeferredError) throw err;
    throw new DeferredError(
      'existing stars.json is unreadable; publication prerequisite is untrusted',
      'PREREQUISITE_INVALID',
    );
  }

  if (previousCount > 0) {
    throw new DeferredError(
      `refusing to publish an empty dataset over ${previousCount} existing repos (set allow_empty to override)`,
      'EMPTY_GUARD',
    );
  }
  // previous empty + current empty → unchanged, allowed
}

export interface PublishInput {
  outDir: string;
  starsFileName: string;
  datasetMetaFileName: string;
  /** Already-validated, canonical serialized bytes from serializeStars(). */
  starsJson: string;
  repoCount: number;
  now: Date;
  git: GitPublisher;
}

export interface PublishResult {
  datasetChanged: boolean;
  staged: boolean;
  commitCreated: boolean;
  pushSucceeded: boolean;
  sha256: string;
}

/**
 * Validate the artifacts that are about to be published. Runs BEFORE any
 * working-tree mutation, so a failure leaves the official files untouched.
 */
export function validateArtifacts(starsJson: string, datasetMetaJson: string): void {
  let starsParsed: unknown;
  let metaParsed: unknown;
  try {
    starsParsed = JSON.parse(starsJson);
    metaParsed = JSON.parse(datasetMetaJson);
  } catch (err) {
    throw new ValidationFailedError(`artifact is not valid JSON: ${(err as Error).message}`);
  }

  const stars = StarsFileSchema.safeParse(starsParsed);
  if (!stars.success) throw new ValidationFailedError(`stars.json failed schema validation`);
  const meta = DatasetMetaSchema.safeParse(metaParsed);
  if (!meta.success) throw new ValidationFailedError(`dataset-meta.json failed schema validation`);

  const seen = new Set<string>();
  for (const repo of stars.data.repos) {
    if (seen.has(repo.node_id))
      throw new ValidationFailedError(`duplicate node_id ${repo.node_id}`);
    seen.add(repo.node_id);
  }

  const hash = sha256(starsJson);
  if (meta.data.stars_sha256 !== hash) {
    throw new ValidationFailedError('dataset-meta stars_sha256 does not match stars.json bytes');
  }
  if (meta.data.repo_count !== stars.data.repos.length) {
    throw new ValidationFailedError('dataset-meta repo_count does not match stars.json');
  }
}

function readPreviousSha(datasetMetaPath: string): string | null {
  if (!existsSync(datasetMetaPath)) return null;
  try {
    const parsed = DatasetMetaSchema.safeParse(JSON.parse(readFileSync(datasetMetaPath, 'utf8')));
    return parsed.success ? parsed.data.stars_sha256 : null;
  } catch {
    return null;
  }
}

/**
 * Validated, staged, single-commit publication.
 *
 *  - validate artifacts first (working tree untouched on failure);
 *  - commit-on-change: unchanged hash ⇒ no write, no commit;
 *  - stage to temp, copy into working tree, then ONE commit + push;
 *  - the remote last-known-good is whatever is already pushed: this function
 *    never pushes on validation failure, and reports commit/push status so the
 *    caller can fail closed (exit 20) without touching the remote.
 *
 * Throws only ValidationFailedError (before any mutation). Commit/push failures
 * are reported via the result flags.
 */
export async function publishDataset(input: PublishInput): Promise<PublishResult> {
  const starsPath = resolve(input.outDir, input.starsFileName);
  const datasetMetaPath = resolve(input.outDir, input.datasetMetaFileName);
  const hash = sha256(input.starsJson);

  const datasetMeta = {
    schema_version: SCHEMA_VERSION,
    dataset_generated_at: input.now.toISOString(),
    stars_sha256: hash,
    repo_count: input.repoCount,
  };
  const datasetMetaJson = JSON.stringify(datasetMeta, null, 2) + '\n';

  validateArtifacts(input.starsJson, datasetMetaJson);

  const previousSha = readPreviousSha(datasetMetaPath);
  if (previousSha === hash) {
    return {
      datasetChanged: false,
      staged: false,
      commitCreated: false,
      pushSucceeded: false,
      sha256: hash,
    };
  }

  // Stage to temp, then copy into the working tree.
  const stagingDir = mkdtempSync(join(tmpdir(), 'stars-stage-'));
  writeFileSync(join(stagingDir, input.starsFileName), input.starsJson);
  writeFileSync(join(stagingDir, input.datasetMetaFileName), datasetMetaJson);
  copyFileSync(join(stagingDir, input.starsFileName), starsPath);
  copyFileSync(join(stagingDir, input.datasetMetaFileName), datasetMetaPath);

  let commitCreated = false;
  try {
    await input.git.commit([input.starsFileName, input.datasetMetaFileName], COMMIT_MESSAGE);
    commitCreated = true;
  } catch {
    return {
      datasetChanged: true,
      staged: true,
      commitCreated: false,
      pushSucceeded: false,
      sha256: hash,
    };
  }

  let pushSucceeded = false;
  try {
    await input.git.push();
    pushSucceeded = true;
  } catch {
    pushSucceeded = false;
  }

  return { datasetChanged: true, staged: true, commitCreated, pushSucceeded, sha256: hash };
}
