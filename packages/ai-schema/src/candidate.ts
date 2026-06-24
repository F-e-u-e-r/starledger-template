import { z } from 'zod';
import { AI_SCHEMA_VERSION } from './artifact';
import { AgentExecutorKindSchema } from './execution-profile';
import { JobIdSchema, LowercaseSha256Schema } from './job';
import { RawModelLabelSchema, RawSummarySchema } from './scalars';
import { MAX_TAGS, TAXONOMY_VERSION, CategorySchema, TagSchema } from './taxonomy';

/** An executor-reported label is operational context only, never a trust boundary. */
export const CandidateExecutionSchema = z
  .object({
    kind: AgentExecutorKindSchema,
    profile_version: z.string().min(1),
    model_label: RawModelLabelSchema,
  })
  .strict();
export type CandidateExecution = z.infer<typeof CandidateExecutionSchema>;

/**
 * Untrusted agent output. Tags may be unordered or duplicated here because the
 * deterministic validator normalizes them before constructing an artifact; all
 * values still have to belong to the controlled vocabulary and fit the hard cap.
 */
export const ClassificationCandidateSchema = z
  .object({
    schema_version: z.literal(AI_SCHEMA_VERSION),
    job_id: JobIdSchema,
    node_id: z.string().min(1),
    source_fingerprint: LowercaseSha256Schema,
    taxonomy_version: z.literal(TAXONOMY_VERSION),
    prompt_version: z.string().min(1),
    execution_profile_version: z.string().min(1),
    category: CategorySchema,
    tags: z.array(TagSchema).max(MAX_TAGS),
    summary: RawSummarySchema,
    execution: CandidateExecutionSchema,
  })
  .strict();
export type ClassificationCandidate = z.infer<typeof ClassificationCandidateSchema>;

/** The JSON file accepted by the candidate-validation and apply commands. */
export const ClassificationCandidatesSchema = z
  .object({
    schema_version: z.literal(AI_SCHEMA_VERSION),
    candidates: z.array(ClassificationCandidateSchema),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const ids = bundle.candidates.map((candidate) => candidate.job_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates'],
        message: 'candidates must have unique job_id',
      });
    }
  });
export type ClassificationCandidates = z.infer<typeof ClassificationCandidatesSchema>;
