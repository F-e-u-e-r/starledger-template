import { z } from 'zod';
import { AI_SCHEMA_VERSION } from './artifact';
import { sha256 } from './hash';
import { AgentExecutorKindSchema, type AgentExecutorKind } from './execution-profile';
import { GitObjectOidSchema } from './scalars';
import {
  CATEGORIES,
  MAX_TAGS,
  SUMMARY_MAX_LENGTH,
  SUMMARY_MIN_LENGTH,
  TAGS,
  TAXONOMY_VERSION,
  CategorySchema,
  TagSchema,
} from './taxonomy';

export const LowercaseSha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256');
export const JobIdSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'must be a sha256-prefixed lowercase hex digest');

function sortedUnique<T extends string>(
  values: readonly T[],
  name: string,
  ctx: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be unique` });
  }
  const sorted = [...values].sort();
  if (values.some((value, index) => value !== sorted[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be sorted ascending` });
  }
}

export const ClassificationReadmeInputSchema = z
  .object({
    path: z.string().min(1),
    oid: GitObjectOidSchema,
    /** Preprocessed, bounded untrusted text. Manifests are temporary and ignored. */
    content: z.string(),
  })
  .strict();
export type ClassificationReadmeInput = z.infer<typeof ClassificationReadmeInputSchema>;

/** The immutable, bounded source material supplied to an agent for one job. */
export const ClassificationInputSchema = z
  .object({
    name_with_owner: z.string().min(1),
    description: z.string().nullable(),
    primary_language: z.string().nullable(),
    topics: z.array(z.string().min(1)).max(100),
    repo_metadata_sha256: LowercaseSha256Schema,
    readme: ClassificationReadmeInputSchema.nullable(),
  })
  .strict()
  .superRefine((input, ctx) => sortedUnique(input.topics, 'topics', ctx));
export type ClassificationInput = z.infer<typeof ClassificationInputSchema>;

/** The complete fixed taxonomy and summary bounds supplied to each agent. */
export const ClassificationConstraintsSchema = z
  .object({
    allowed_categories: z.array(CategorySchema).min(1),
    allowed_tags: z.array(TagSchema),
    max_tags: z.literal(MAX_TAGS),
    summary_min_chars: z.literal(SUMMARY_MIN_LENGTH),
    summary_max_chars: z.literal(SUMMARY_MAX_LENGTH),
  })
  .strict()
  .superRefine((constraints, ctx) => {
    sortedUnique(constraints.allowed_categories, 'allowed_categories', ctx);
    sortedUnique(constraints.allowed_tags, 'allowed_tags', ctx);
  });
export type ClassificationConstraints = z.infer<typeof ClassificationConstraintsSchema>;

export const DEFAULT_CLASSIFICATION_CONSTRAINTS: ClassificationConstraints = {
  allowed_categories: [...CATEGORIES],
  allowed_tags: [...TAGS],
  max_tags: MAX_TAGS,
  summary_min_chars: SUMMARY_MIN_LENGTH,
  summary_max_chars: SUMMARY_MAX_LENGTH,
};

export const ClassificationJobSchema = z
  .object({
    schema_version: z.literal(AI_SCHEMA_VERSION),
    job_id: JobIdSchema,
    node_id: z.string().min(1),
    source_fingerprint: LowercaseSha256Schema,
    taxonomy_version: z.literal(TAXONOMY_VERSION),
    prompt_version: z.string().min(1),
    execution_profile_version: z.string().min(1),
    executor_kind: AgentExecutorKindSchema,
    input: ClassificationInputSchema,
    constraints: ClassificationConstraintsSchema,
  })
  .strict()
  .superRefine((job, ctx) => {
    if (job.job_id !== classificationJobId(job)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['job_id'],
        message: 'job_id does not match the immutable job inputs',
      });
    }
  });
export type ClassificationJob = z.infer<typeof ClassificationJobSchema>;

export interface ClassificationJobIdentity {
  node_id: string;
  source_fingerprint: string;
  /** String rather than a literal here so tests can prove a taxonomy bump changes the id. */
  taxonomy_version: string;
  prompt_version: string;
  execution_profile_version: string;
  executor_kind: AgentExecutorKind;
  input: ClassificationInput;
  constraints: ClassificationConstraints;
}

function canonicalizeInput(input: ClassificationInput): ClassificationInput {
  return {
    name_with_owner: input.name_with_owner,
    description: input.description,
    primary_language: input.primary_language,
    topics: [...input.topics].sort(),
    repo_metadata_sha256: input.repo_metadata_sha256,
    readme:
      input.readme === null
        ? null
        : { path: input.readme.path, oid: input.readme.oid, content: input.readme.content },
  };
}

function canonicalizeConstraints(
  constraints: ClassificationConstraints,
): ClassificationConstraints {
  return {
    allowed_categories: [
      ...constraints.allowed_categories,
    ].sort() as ClassificationConstraints['allowed_categories'],
    allowed_tags: [...constraints.allowed_tags].sort() as ClassificationConstraints['allowed_tags'],
    max_tags: constraints.max_tags,
    summary_min_chars: constraints.summary_min_chars,
    summary_max_chars: constraints.summary_max_chars,
  };
}

/** SHA-256 over all immutable job inputs, with a fixed object and list order. */
export function classificationJobId(job: ClassificationJobIdentity): string {
  const canonical = {
    schema_version: AI_SCHEMA_VERSION,
    node_id: job.node_id,
    source_fingerprint: job.source_fingerprint,
    taxonomy_version: job.taxonomy_version,
    prompt_version: job.prompt_version,
    execution_profile_version: job.execution_profile_version,
    executor_kind: job.executor_kind,
    input: canonicalizeInput(job.input),
    constraints: canonicalizeConstraints(job.constraints),
  };
  return `sha256:${sha256(JSON.stringify(canonical))}`;
}

export type BuildClassificationJobInput = Omit<ClassificationJobIdentity, 'taxonomy_version'>;

export function buildClassificationJob(input: BuildClassificationJobInput): ClassificationJob {
  const parsedInput = ClassificationInputSchema.parse(input.input);
  const parsedConstraints = ClassificationConstraintsSchema.parse(input.constraints);
  const job: ClassificationJob = {
    schema_version: AI_SCHEMA_VERSION,
    job_id: classificationJobId({
      ...input,
      taxonomy_version: TAXONOMY_VERSION,
      input: parsedInput,
      constraints: parsedConstraints,
    }),
    node_id: input.node_id,
    source_fingerprint: input.source_fingerprint,
    taxonomy_version: TAXONOMY_VERSION,
    prompt_version: input.prompt_version,
    execution_profile_version: input.execution_profile_version,
    executor_kind: input.executor_kind,
    input: parsedInput,
    constraints: parsedConstraints,
  };
  return ClassificationJobSchema.parse(job);
}

/** Explicit key order for deterministic, temporary manifests. */
export function canonicalizeClassificationJob(job: ClassificationJob): Record<string, unknown> {
  return {
    schema_version: job.schema_version,
    job_id: job.job_id,
    node_id: job.node_id,
    source_fingerprint: job.source_fingerprint,
    taxonomy_version: job.taxonomy_version,
    prompt_version: job.prompt_version,
    execution_profile_version: job.execution_profile_version,
    executor_kind: job.executor_kind,
    input: canonicalizeInput(job.input),
    constraints: canonicalizeConstraints(job.constraints),
  };
}
