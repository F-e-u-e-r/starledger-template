import {
  AiAnnotationsSchema,
  AiAnnotationsMetaSchema,
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
  sha256Bytes,
  type Annotation,
  type AiAnnotationsMeta,
} from '@starred/ai-schema';
import { candidateToAnnotation, type ValidatedCandidate } from './validate-candidate';

export interface AssembleAiArtifactsInput {
  currentAnnotations: readonly Annotation[];
  validatedCandidates: readonly ValidatedCandidate[];
  /** node_ids of the VERIFIED canonical dataset (loadCanonicalDataset). Existing
   * annotations outside this set are pruned (Merge rules: "a removed star prunes
   * its annotation"), and a candidate outside it is a hard failure. */
  canonicalNodeIds: ReadonlySet<string>;
  datasetSha256: string;
  generatedAt: string;
}

export interface AssembledAiArtifacts {
  annotations: Annotation[];
  annotationsBytes: string;
  meta: AiAnnotationsMeta | null;
  metaBytes: string | null;
  changed: boolean;
  /** node_ids removed because their repository left the canonical dataset. */
  prunedNodeIds: string[];
}

function annotationWithoutGeneratedAt(annotation: Annotation): Record<string, unknown> {
  return {
    node_id: annotation.node_id,
    category: annotation.category,
    tags: annotation.tags,
    summary: annotation.summary,
    source: annotation.source,
    generation: {
      executor_kind: annotation.generation.executor_kind,
      execution_profile_version: annotation.generation.execution_profile_version,
      model_label: annotation.generation.model_label,
      prompt_version: annotation.generation.prompt_version,
    },
  };
}

function sameAnnotationContent(left: Annotation, right: Annotation): boolean {
  return (
    JSON.stringify(annotationWithoutGeneratedAt(left)) ===
    JSON.stringify(annotationWithoutGeneratedAt(right))
  );
}

/**
 * Deterministically merges validated candidates. Existing annotations survive
 * unless a fresh, matching candidate changes them or their repository left the
 * verified canonical dataset (removed-star prune); no agent-controlled field
 * can bypass the shared artifact schema.
 */
export function assembleAiArtifacts(input: AssembleAiArtifactsInput): AssembledAiArtifacts {
  const currentBytes = serializeAnnotations(input.currentAnnotations);
  const byNodeId = new Map<string, Annotation>();
  for (const annotation of input.currentAnnotations) {
    if (byNodeId.has(annotation.node_id)) {
      throw new Error(`current annotations contain duplicate node_id ${annotation.node_id}`);
    }
    byNodeId.set(annotation.node_id, annotation);
  }

  // Merge rules: "a removed star prunes its annotation" — drop every record whose
  // repository is no longer in the VERIFIED canonical dataset. The provenance
  // gate (PROV-6) accepts exactly this prune and rejects pruning a repository
  // still present in the dataset.
  const prunedNodeIds = [...byNodeId.keys()]
    .filter((nodeId) => !input.canonicalNodeIds.has(nodeId))
    .sort();
  for (const nodeId of prunedNodeIds) byNodeId.delete(nodeId);

  for (const validated of input.validatedCandidates) {
    const next = candidateToAnnotation(validated, input.generatedAt);
    if (!input.canonicalNodeIds.has(next.node_id)) {
      // A candidate outside the canonical set must never (re-)enter the artifact
      // — not even in the same run that prunes it.
      throw new Error(
        `validated candidate ${next.node_id} is not in the canonical dataset — refusing to assemble`,
      );
    }
    const previous = byNodeId.get(next.node_id);
    // Preserve the original per-record timestamp when the candidate is a true no-op.
    byNodeId.set(
      next.node_id,
      previous !== undefined && sameAnnotationContent(previous, next) ? previous : next,
    );
  }

  const annotations = [...byNodeId.values()].sort((a, b) =>
    a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0,
  );
  const annotationsBytes = serializeAnnotations(annotations);
  const changed = annotationsBytes !== currentBytes;
  if (!changed) {
    return {
      annotations,
      annotationsBytes,
      meta: null,
      metaBytes: null,
      changed: false,
      prunedNodeIds,
    };
  }
  const meta = buildAiAnnotationsMeta({
    annotationsBytes,
    annotationCount: annotations.length,
    datasetSha256: input.datasetSha256,
    generatedAt: input.generatedAt,
  });
  return {
    annotations,
    annotationsBytes,
    meta,
    metaBytes: serializeAiAnnotationsMeta(meta),
    changed: true,
    prunedNodeIds,
  };
}

/**
 * Validate the two public files together, including the exact-byte hash.
 *
 * `annotationsBytes` is BYTES, not text (round-9 closure of the decoded-text
 * digest class): the recorded `annotations_sha256` is a byte digest, and
 * hashing a lossy DECODING would accept a byte-different, decode-alike
 * artifact that the byte-strict deploy stager and runtime loader then reject.
 * The meta half stays TEXT deliberately — it carries no self-digest; its
 * acceptance check is canonical-form equality (re-serialize and compare), a
 * SEMANTIC check on which any decode loss surfaces as a mismatch and fails
 * closed.
 */
export function verifyAiArtifacts(annotationsBytes: Uint8Array, metaText: string): void {
  const annotationsText = Buffer.from(annotationsBytes).toString('utf8');
  const annotations = AiAnnotationsSchema.parse(JSON.parse(annotationsText));
  const meta = zodMetaParse(metaText);
  // Canonical form is a BYTE contract too (round-9 finding): comparing the
  // DECODED text accepted artifact bytes that are not the serializer's output
  // — a decode-alike byte mutation whose meta was re-stamped with the mutated
  // bytes' correct digest passed the hash check AND a text-level form check.
  // The artifact's exact bytes must BE the canonical serialization's bytes.
  if (
    !Buffer.from(annotationsBytes).equals(
      Buffer.from(serializeAnnotations(annotations.annotations), 'utf8'),
    )
  ) {
    throw new Error('ai-annotations.json is not deterministically serialized');
  }
  if (metaText !== serializeAiAnnotationsMeta(meta)) {
    throw new Error('ai-annotations-meta.json is not deterministically serialized');
  }
  if (meta.annotations_sha256 !== sha256Bytes(annotationsBytes)) {
    throw new Error('ai-annotations-meta.json hash does not match ai-annotations.json bytes');
  }
  if (meta.annotation_count !== annotations.annotations.length) {
    throw new Error('ai-annotations-meta.json count does not match ai-annotations.json');
  }
  if (meta.taxonomy_version !== annotations.taxonomy_version) {
    throw new Error('AI artifact taxonomy versions do not match');
  }
}

function zodMetaParse(metaText: string): AiAnnotationsMeta {
  // Keep JSON parsing and strict schema validation on the deterministic side of
  // the boundary; raw agent output is never written before this succeeds.
  return AiAnnotationsMetaSchema.parse(JSON.parse(metaText));
}
