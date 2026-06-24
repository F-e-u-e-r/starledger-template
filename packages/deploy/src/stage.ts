import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AiAnnotationsMetaSchema, AiAnnotationsSchema } from '@starred/ai-schema';
import { sha256Hex, verifyDatasetIntegrity } from './dataset';

export const STARS_FILE = 'stars.json';
export const DATASET_META_FILE = 'dataset-meta.json';
export const AI_ANNOTATIONS_FILE = 'ai-annotations.json';
export const AI_ANNOTATIONS_META_FILE = 'ai-annotations-meta.json';

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
export function stageDashboardData(opts: StageOptions): StageResult {
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

  const starsText = readFileSync(starsPath, 'utf8');
  const metaText = readFileSync(metaPath, 'utf8');
  const verified = verifyDatasetIntegrity(starsText, metaText); // throws BEFORE any copy
  assertNoForbiddenFiles(distDir); // never ship secrets/telemetry, even if the build emitted them

  copyFileSync(starsPath, resolve(distDir, STARS_FILE));
  copyFileSync(metaPath, resolve(distDir, DATASET_META_FILE));

  return { repoCount: verified.meta.repo_count, sha256: verified.sha256 };
}

export interface AiStageResult {
  staged: boolean;
  reason?: string;
}

/**
 * Stage the OPTIONAL AI artifacts into the dist, FAIL-SOFT: a missing, malformed,
 * or hash-mismatched pair is skipped (never throws), so an AI problem can never
 * block the canonical Pages deployment. The dashboard validates again at runtime.
 */
export function stageAiArtifacts(opts: StageOptions): AiStageResult {
  const annPath = resolve(opts.dataDir, AI_ANNOTATIONS_FILE);
  const metaPath = resolve(opts.dataDir, AI_ANNOTATIONS_META_FILE);
  if (!existsSync(annPath) || !existsSync(metaPath)) {
    return { staged: false, reason: 'no AI artifacts present' };
  }
  try {
    const annText = readFileSync(annPath, 'utf8');
    const metaText = readFileSync(metaPath, 'utf8');
    const annotations = AiAnnotationsSchema.parse(JSON.parse(annText));
    const meta = AiAnnotationsMetaSchema.parse(JSON.parse(metaText));
    if (meta.annotations_sha256 !== sha256Hex(annText)) {
      return { staged: false, reason: 'AI artifact hash mismatch — skipped' };
    }
    if (meta.annotation_count !== annotations.annotations.length) {
      return { staged: false, reason: 'AI artifact count mismatch — skipped' };
    }
    if (meta.taxonomy_version !== annotations.taxonomy_version) {
      return { staged: false, reason: 'AI artifact taxonomy mismatch — skipped' };
    }
    copyFileSync(annPath, resolve(opts.distDir, AI_ANNOTATIONS_FILE));
    copyFileSync(metaPath, resolve(opts.distDir, AI_ANNOTATIONS_META_FILE));
    return { staged: true };
  } catch (error) {
    return { staged: false, reason: error instanceof Error ? error.message : 'AI staging skipped' };
  }
}
