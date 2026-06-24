import { z } from 'zod';
import { type Annotation, AnnotationSchema } from './annotation';
import { TAXONOMY_VERSION } from './taxonomy';

/**
 * Schema version for the AI artifacts. DELIBERATELY separate from
 * `@starred/schema`'s `SCHEMA_VERSION` (the canonical stars dataset) and from
 * `TAXONOMY_VERSION`: the artifact shape, the canonical dataset, and the
 * taxonomy each evolve independently.
 */
export const AI_SCHEMA_VERSION = '1.0';

/**
 * The optional enrichment artifact. It is fail-SOFT: the dashboard renders fully
 * without it. `annotations` are keyed by `node_id` (primary key) and stored in
 * canonical order — unique and sorted ascending — so the serialized bytes are
 * deterministic and the per-byte hash in the meta file is stable.
 */
export const AiAnnotationsSchema = z
  .object({
    schema_version: z.literal(AI_SCHEMA_VERSION),
    taxonomy_version: z.literal(TAXONOMY_VERSION),
    annotations: z.array(AnnotationSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    const ids = file.annotations.map((annotation) => annotation.node_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'annotation node_id must be unique (it is the primary key)',
        path: ['annotations'],
      });
    }
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (ids.some((id, i) => id !== sorted[i])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'annotations must be sorted by node_id ascending',
        path: ['annotations'],
      });
    }
  });
export type AiAnnotations = z.infer<typeof AiAnnotationsSchema>;

function compareNodeId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total, deterministic ordering by `node_id` ASC, independent of input order. */
export function sortAnnotations(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => compareNodeId(a.node_id, b.node_id));
}

export function buildAiAnnotations(annotations: readonly Annotation[]): AiAnnotations {
  return {
    schema_version: AI_SCHEMA_VERSION,
    taxonomy_version: TAXONOMY_VERSION,
    annotations: sortAnnotations(annotations),
  };
}

// Explicit key order — never rely on object-construction order surviving refactors.
function canonicalizeAnnotation(annotation: Annotation): Record<string, unknown> {
  return {
    node_id: annotation.node_id,
    category: annotation.category,
    tags: [...annotation.tags],
    summary: annotation.summary,
    source: {
      kind: annotation.source.kind,
      readme_path: annotation.source.readme_path,
      readme_oid: annotation.source.readme_oid,
      repo_metadata_sha256: annotation.source.repo_metadata_sha256,
      fingerprint: annotation.source.fingerprint,
    },
    generation: {
      executor_kind: annotation.generation.executor_kind,
      execution_profile_version: annotation.generation.execution_profile_version,
      model_label: annotation.generation.model_label,
      prompt_version: annotation.generation.prompt_version,
      generated_at: annotation.generation.generated_at,
    },
  };
}

/**
 * Validate (including the canonical-form invariants) then emit canonical bytes:
 * fixed key order, annotations sorted by `node_id`, 2-space indent, single
 * trailing newline. An unchanged annotation set serializes byte-identically, so
 * the publish step (P3.3) is genuinely commit-on-change.
 */
export function serializeAnnotations(annotations: readonly Annotation[]): string {
  const validated = AiAnnotationsSchema.parse(buildAiAnnotations(annotations));
  const canonical = {
    schema_version: validated.schema_version,
    taxonomy_version: validated.taxonomy_version,
    annotations: validated.annotations.map(canonicalizeAnnotation),
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}
