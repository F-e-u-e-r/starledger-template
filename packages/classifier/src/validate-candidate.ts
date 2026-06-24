import {
  AnnotationSchema,
  CanonicalSummarySchema,
  ClassificationCandidateSchema,
  ClassificationJobSchema,
  OptionalModelLabelSchema,
  normalizeOptionalModelLabel,
  normalizeSummary,
  normalizeTags,
  type Annotation,
  type ClassificationCandidate,
  type ClassificationJob,
  type Tag,
} from '@starred/ai-schema';

export class CandidateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateValidationError';
  }
}

export interface ValidatedCandidate {
  job: ClassificationJob;
  candidate: ClassificationCandidate;
  tags: Tag[];
  summary: string;
  modelLabel: string | null;
}

/**
 * Validates untrusted agent output against the immutable job contract. This is
 * deliberately exact: a stale candidate can never be applied to a changed job.
 */
export function validateCandidate(candidateInput: unknown, jobInput: unknown): ValidatedCandidate {
  const candidate = ClassificationCandidateSchema.parse(candidateInput);
  const job = ClassificationJobSchema.parse(jobInput);
  const repeatedFields: Array<
    keyof Pick<
      ClassificationCandidate,
      | 'job_id'
      | 'node_id'
      | 'source_fingerprint'
      | 'taxonomy_version'
      | 'prompt_version'
      | 'execution_profile_version'
    >
  > = [
    'job_id',
    'node_id',
    'source_fingerprint',
    'taxonomy_version',
    'prompt_version',
    'execution_profile_version',
  ];

  for (const field of repeatedFields) {
    if (candidate[field] !== job[field]) {
      throw new CandidateValidationError(
        `candidate ${field} does not match its classification job`,
      );
    }
  }
  if (candidate.execution.profile_version !== job.execution_profile_version) {
    throw new CandidateValidationError(
      'candidate execution profile does not match its classification job',
    );
  }
  if (candidate.execution.kind !== job.executor_kind) {
    throw new CandidateValidationError('candidate executor is not allowed by this job');
  }
  if (!job.constraints.allowed_categories.includes(candidate.category)) {
    throw new CandidateValidationError(
      'candidate category is not allowed by its classification job',
    );
  }
  const tags = normalizeTags(candidate.tags) as Tag[];
  if (tags.length > job.constraints.max_tags) {
    throw new CandidateValidationError('candidate tags exceed the job maximum after normalization');
  }
  if (tags.some((tag) => !job.constraints.allowed_tags.includes(tag))) {
    throw new CandidateValidationError('candidate tags are not allowed by its classification job');
  }
  const summary = normalizeSummary(candidate.summary);
  if (
    summary.length < job.constraints.summary_min_chars ||
    summary.length > job.constraints.summary_max_chars
  ) {
    throw new CandidateValidationError('candidate summary is outside bounds after normalization');
  }
  const canonicalSummary = CanonicalSummarySchema.safeParse(summary);
  if (!canonicalSummary.success) {
    throw new CandidateValidationError('candidate summary is invalid after normalization');
  }
  const modelLabel = normalizeOptionalModelLabel(candidate.execution.model_label);
  const canonicalModelLabel = OptionalModelLabelSchema.safeParse(modelLabel);
  if (!canonicalModelLabel.success) {
    throw new CandidateValidationError('candidate model_label is invalid after normalization');
  }
  return {
    job,
    candidate,
    tags,
    summary: canonicalSummary.data,
    modelLabel: canonicalModelLabel.data,
  };
}

/** Construct the only form that may enter ai-annotations.json. */
export function candidateToAnnotation(
  validated: ValidatedCandidate,
  generatedAt: string,
): Annotation {
  const { job, candidate, tags, summary, modelLabel } = validated;
  return AnnotationSchema.parse({
    node_id: candidate.node_id,
    category: candidate.category,
    tags,
    summary,
    source:
      job.input.readme === null
        ? {
            kind: 'metadata',
            readme_path: null,
            readme_oid: null,
            repo_metadata_sha256: job.input.repo_metadata_sha256,
            fingerprint: job.source_fingerprint,
          }
        : {
            kind: 'readme',
            readme_path: job.input.readme.path,
            readme_oid: job.input.readme.oid,
            repo_metadata_sha256: job.input.repo_metadata_sha256,
            fingerprint: job.source_fingerprint,
          },
    generation: {
      executor_kind: candidate.execution.kind,
      execution_profile_version: candidate.execution.profile_version,
      model_label: modelLabel,
      prompt_version: candidate.prompt_version,
      generated_at: generatedAt,
    },
  });
}
