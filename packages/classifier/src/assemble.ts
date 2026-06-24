import {
  AiAnnotationsSchema,
  AiAnnotationsMetaSchema,
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
  sha256,
  type Annotation,
  type AiAnnotationsMeta,
} from '@starred/ai-schema';
import { candidateToAnnotation, type ValidatedCandidate } from './validate-candidate';

export interface AssembleAiArtifactsInput {
  currentAnnotations: readonly Annotation[];
  validatedCandidates: readonly ValidatedCandidate[];
  datasetSha256: string;
  generatedAt: string;
}

export interface AssembledAiArtifacts {
  annotations: Annotation[];
  annotationsBytes: string;
  meta: AiAnnotationsMeta | null;
  metaBytes: string | null;
  changed: boolean;
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
 * unless a fresh, matching candidate changes them; no agent-controlled field
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

  for (const validated of input.validatedCandidates) {
    const next = candidateToAnnotation(validated, input.generatedAt);
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
    return { annotations, annotationsBytes, meta: null, metaBytes: null, changed: false };
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
  };
}

/** Validate the two public files together, including the exact-byte hash. */
export function verifyAiArtifacts(annotationsBytes: string, metaBytes: string): void {
  const annotations = AiAnnotationsSchema.parse(JSON.parse(annotationsBytes));
  const meta = zodMetaParse(metaBytes);
  if (annotationsBytes !== serializeAnnotations(annotations.annotations)) {
    throw new Error('ai-annotations.json is not deterministically serialized');
  }
  if (metaBytes !== serializeAiAnnotationsMeta(meta)) {
    throw new Error('ai-annotations-meta.json is not deterministically serialized');
  }
  if (meta.annotations_sha256 !== sha256(annotationsBytes)) {
    throw new Error('ai-annotations-meta.json hash does not match ai-annotations.json bytes');
  }
  if (meta.annotation_count !== annotations.annotations.length) {
    throw new Error('ai-annotations-meta.json count does not match ai-annotations.json');
  }
  if (meta.taxonomy_version !== annotations.taxonomy_version) {
    throw new Error('AI artifact taxonomy versions do not match');
  }
}

function zodMetaParse(metaBytes: string): AiAnnotationsMeta {
  // Keep JSON parsing and strict schema validation on the deterministic side of
  // the boundary; raw agent output is never written before this succeeds.
  return AiAnnotationsMetaSchema.parse(JSON.parse(metaBytes));
}
