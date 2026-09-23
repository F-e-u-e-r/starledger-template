import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AiAnnotationsSchema } from '@starred/ai-schema';
import { assembleAiArtifacts } from './assemble';
import { loadCanonicalDataset } from './dataset';

export interface PruneOrphansInput {
  /** Canonical stars.json path (verified against dataset-meta before any prune). */
  starsPath: string;
  /** dataset-meta.json path. */
  datasetMetaPath: string;
  /** Existing ai-annotations.json path (must exist and schema-validate). */
  currentPath: string;
  /** Timestamp for the rebuilt meta when a prune writes a new pair. */
  generatedAt: string;
  /** Directory receiving the pruned artifact pair (written only when changed). */
  outDir: string;
}

export interface PruneOrphansReceipt {
  datasetSha256: string;
  canonicalCount: number;
  beforeCount: number;
  prunedNodeIds: string[];
  afterCount: number;
  changed: boolean;
  annotationsPath: string | null;
  metaPath: string | null;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/**
 * Deterministic maintenance path for the removed-star lifecycle (Merge rules:
 * "a removed star prunes its annotation"): remove annotations whose repository
 * left the VERIFIED canonical dataset and rebuild the meta — with ZERO
 * candidates, so it can run when the planner has no jobs (the zero-job,
 * extra-only case). The provenance gate (PROV-6) independently re-validates
 * every prune on the resulting PR; this command performs no classification.
 */
export function runPruneOrphans(input: PruneOrphansInput): PruneOrphansReceipt {
  const dataset = loadCanonicalDataset(
    readFileSync(input.starsPath),
    readFileSync(input.datasetMetaPath, 'utf8'),
  );
  const current = AiAnnotationsSchema.parse(
    JSON.parse(readFileSync(input.currentPath, 'utf8')),
  ).annotations;
  const result = assembleAiArtifacts({
    currentAnnotations: current,
    validatedCandidates: [],
    canonicalNodeIds: new Set(dataset.repos.map((repo) => repo.node_id)),
    datasetSha256: dataset.datasetSha256,
    generatedAt: input.generatedAt,
  });
  if (result.changed !== result.prunedNodeIds.length > 0) {
    // With zero candidates the ONLY legitimate change is a prune; anything else
    // means the inputs (or this tool) are broken — never write in that state.
    throw new Error('prune-orphans invariant violated: changed flag and prunedNodeIds disagree');
  }
  const receipt: PruneOrphansReceipt = {
    datasetSha256: dataset.datasetSha256,
    canonicalCount: dataset.repos.length,
    beforeCount: current.length,
    prunedNodeIds: result.prunedNodeIds,
    afterCount: result.annotations.length,
    changed: result.changed,
    annotationsPath: null,
    metaPath: null,
  };
  if (!result.changed || result.metaBytes === null) return receipt;
  const annotationsPath = join(input.outDir, 'ai-annotations.json');
  const metaPath = join(input.outDir, 'ai-annotations-meta.json');
  writeText(annotationsPath, result.annotationsBytes);
  writeText(metaPath, result.metaBytes);
  return { ...receipt, annotationsPath, metaPath };
}
