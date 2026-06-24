import { z } from 'zod';
import { CategorySchema, MAX_TAGS, TagSchema } from './taxonomy';
import { AgentExecutorKindSchema } from './execution-profile';
import {
  CanonicalSummarySchema,
  GitObjectOidSchema,
  OptionalModelLabelSchema,
  UtcTimestampSchema,
} from './scalars';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Where the classification came from. `readme` carries the preferred README's
 * path + blob OID (so an unchanged OID skips reclassification in P3.1);
 * `metadata` means no README existed and canonical metadata was used instead. A
 * repository without a README is still classifiable — it is never blocked.
 */
export const AnnotationSourceKindSchema = z.enum(['readme', 'metadata']);
export type AnnotationSourceKind = z.infer<typeof AnnotationSourceKindSchema>;

export const AnnotationSourceSchema = z
  .object({
    kind: AnnotationSourceKindSchema,
    /** README blob path (`null` for a metadata-only source). */
    readme_path: z.string().min(1).nullable(),
    /** README blob OID (`null` for a metadata-only source). */
    readme_oid: GitObjectOidSchema.nullable(),
    repo_metadata_sha256: z.string().regex(HEX64, 'must be a lowercase hex sha256'),
    /** The composite source fingerprint (P3.1) that gates reclassification. */
    fingerprint: z.string().regex(HEX64, 'must be a lowercase hex sha256'),
  })
  .strict()
  .superRefine((source, ctx) => {
    // The kind and the README fields must agree: a readme source has both; a
    // metadata source has neither. This keeps the source self-describing.
    if (source.kind === 'readme' && (source.readme_path === null || source.readme_oid === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a readme source requires both readme_path and readme_oid',
        path: ['readme_path'],
      });
    }
    if (source.kind === 'metadata' && (source.readme_path !== null || source.readme_oid !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a metadata source must not carry readme_path or readme_oid',
        path: ['readme_path'],
      });
    }
  });
export type AnnotationSource = z.infer<typeof AnnotationSourceSchema>;

/**
 * Provenance of the generated annotation. No raw prompt, response, or secret is
 * ever recorded — only the identifiers needed to reproduce/refresh. `generated_at`
 * changes ONLY when this repository's annotation actually changes (P3.3).
 */
export const AnnotationGenerationSchema = z
  .object({
    /** Executor identity is informational; the profile version is authoritative. */
    executor_kind: AgentExecutorKindSchema,
    /** StarLedger-controlled methodology/cache version, for example `agent-v1`. */
    execution_profile_version: z.string().min(1),
    /** Optional executor-reported label. It is never trusted as a cache key. */
    model_label: OptionalModelLabelSchema,
    prompt_version: z.string().min(1),
    generated_at: UtcTimestampSchema,
  })
  .strict();
export type AnnotationGeneration = z.infer<typeof AnnotationGenerationSchema>;

/**
 * The canonical tag array: each tag is in the controlled vocabulary, the list is
 * bounded, unique, and sorted ascending. Unsorted/duplicate/over-budget input is
 * REJECTED here — the classifier normalizes (see `normalizeTags`) before
 * validation, so the committed artifact is always in one canonical form.
 */
export const TagsSchema = z
  .array(TagSchema)
  .max(MAX_TAGS)
  .superRefine((tags, ctx) => {
    if (new Set(tags).size !== tags.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tags must be unique' });
    }
    const sorted = [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (tags.some((tag, i) => tag !== sorted[i])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tags must be sorted ascending' });
    }
  });

/**
 * One AI annotation, keyed by the canonical repository `node_id` (the only join
 * key the dashboard uses). Exactly one category, a bounded canonical tag list, a
 * length-bounded factual summary, plus source + generation provenance. No raw
 * model output, prompt, README content, error message, or secret is permitted.
 */
export const AnnotationSchema = z
  .object({
    node_id: z.string().min(1),
    category: CategorySchema,
    tags: TagsSchema,
    summary: CanonicalSummarySchema,
    source: AnnotationSourceSchema,
    generation: AnnotationGenerationSchema,
  })
  .strict();
export type Annotation = z.infer<typeof AnnotationSchema>;
