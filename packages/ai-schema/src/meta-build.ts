import { AI_SCHEMA_VERSION } from './artifact';
import { sha256 } from './hash';
import { AiAnnotationsMetaSchema, type AiAnnotationsMeta } from './meta';
import { TAXONOMY_VERSION } from './taxonomy';

export interface BuildAiAnnotationsMetaInput {
  /**
   * The EXACT serialized `ai-annotations.json` string (from
   * `serializeAnnotations`), which the caller writes verbatim as UTF-8 — so the
   * recorded digest equals the byte digest of the file that lands. This is the
   * GENERATION-side digest of freshly canonicalized content; verifying an
   * EXISTING artifact hashes exact bytes instead (`verifyAiArtifacts`).
   */
  annotationsBytes: string;
  annotationCount: number;
  /** SHA-256 of the canonical `stars.json` the annotations were computed against. */
  datasetSha256: string;
  generatedAt: string;
}

/**
 * Build the meta fingerprint. Node-only: it hashes the exact annotation bytes
 * (`sha256`), which is why it lives apart from the crypto-free {@link
 * AiAnnotationsMetaSchema} so a browser can validate meta without `node:crypto`.
 */
export function buildAiAnnotationsMeta(input: BuildAiAnnotationsMetaInput): AiAnnotationsMeta {
  return AiAnnotationsMetaSchema.parse({
    schema_version: AI_SCHEMA_VERSION,
    annotations_sha256: sha256(input.annotationsBytes),
    annotation_count: input.annotationCount,
    taxonomy_version: TAXONOMY_VERSION,
    dataset_sha256: input.datasetSha256,
    generated_at: input.generatedAt,
  });
}
