import type { Annotation } from '../src/annotation';
import type { ClassificationCandidate } from '../src/candidate';
import {
  DEFAULT_CLASSIFICATION_CONSTRAINTS,
  buildClassificationJob,
  type BuildClassificationJobInput,
  type ClassificationJob,
} from '../src/job';

export function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    node_id: 'R_kgDOAAA',
    category: 'developer-tools',
    tags: ['automation', 'cli'],
    summary:
      'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
    source: {
      kind: 'readme',
      readme_path: 'README.md',
      readme_oid: 'abc123def456',
      repo_metadata_sha256: 'a'.repeat(64),
      fingerprint: 'b'.repeat(64),
    },
    generation: {
      executor_kind: 'claude-routine',
      execution_profile_version: 'agent-v1',
      model_label: 'informational-only',
      prompt_version: 'classify-v1',
      generated_at: '2026-06-20T00:00:00Z',
    },
    ...overrides,
  };
}

export function makeJobInput(
  overrides: Partial<BuildClassificationJobInput> = {},
): BuildClassificationJobInput {
  return {
    node_id: 'R_kgDOAAA',
    source_fingerprint: 'b'.repeat(64),
    prompt_version: 'classify-v1',
    execution_profile_version: 'agent-v1',
    executor_kind: 'claude-routine',
    input: {
      name_with_owner: 'example/repository',
      description: 'A repository used to test deterministic agent contracts.',
      primary_language: 'TypeScript',
      topics: ['automation', 'testing'],
      repo_metadata_sha256: 'a'.repeat(64),
      readme: {
        path: 'README.md',
        oid: 'abc123def456',
        content: 'This is bounded, untrusted README content for a test repository.',
      },
    },
    constraints: DEFAULT_CLASSIFICATION_CONSTRAINTS,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<BuildClassificationJobInput> = {}): ClassificationJob {
  return buildClassificationJob(makeJobInput(overrides));
}

export function makeCandidate(
  job: ClassificationJob,
  overrides: Partial<ClassificationCandidate> = {},
): ClassificationCandidate {
  return {
    schema_version: '1.0',
    job_id: job.job_id,
    node_id: job.node_id,
    source_fingerprint: job.source_fingerprint,
    taxonomy_version: job.taxonomy_version,
    prompt_version: job.prompt_version,
    execution_profile_version: job.execution_profile_version,
    category: 'developer-tools',
    tags: ['automation', 'cli'],
    summary:
      'A concise, factual description of this repository that remains within the documented summary bounds for the public artifact.',
    execution: {
      kind: job.executor_kind,
      profile_version: job.execution_profile_version,
      model_label: 'informational-only',
    },
    ...overrides,
  };
}
