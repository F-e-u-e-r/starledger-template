import { describe, expect, it } from 'vitest';
import {
  ClassificationManifestSchema,
  buildClassificationManifest,
  classificationJobId,
  serializeClassificationManifest,
} from '../src';
import { makeJob, makeJobInput } from './helpers';

describe('agent job and manifest contracts', () => {
  it('JOB-1: identical immutable inputs produce an identical job_id', () => {
    const first = makeJob();
    const second = makeJob({
      input: {
        ...makeJobInput().input,
        topics: ['automation', 'testing'],
      },
    });
    expect(first.job_id).toBe(second.job_id);
  });

  it('JOB-2/JOB-4: prompt, taxonomy, execution profile, and executor changes change job_id', () => {
    const job = makeJob();
    expect(makeJob({ prompt_version: 'classify-v2' }).job_id).not.toBe(job.job_id);
    expect(makeJob({ execution_profile_version: 'agent-v2' }).job_id).not.toBe(job.job_id);
    expect(makeJob({ executor_kind: 'codex-automation' }).job_id).not.toBe(job.job_id);
    expect(
      classificationJobId({
        ...job,
        taxonomy_version: '2',
      }),
    ).not.toBe(job.job_id);
  });

  it('JOB-3: manifest ordering and serialization are deterministic', () => {
    const a = makeJob({ node_id: 'R_a', source_fingerprint: 'a'.repeat(64) });
    const b = makeJob({ node_id: 'R_b', source_fingerprint: 'b'.repeat(64) });
    const first = buildClassificationManifest({
      promptVersion: 'classify-v1',
      executionProfileVersion: 'agent-v1',
      executorKind: 'claude-routine',
      datasetSha256: 'd'.repeat(64),
      jobs: [b, a],
    });
    const second = buildClassificationManifest({
      promptVersion: 'classify-v1',
      executionProfileVersion: 'agent-v1',
      executorKind: 'claude-routine',
      datasetSha256: 'd'.repeat(64),
      jobs: [a, b],
    });
    expect(first.jobs.map((job) => job.node_id)).toEqual(['R_a', 'R_b']);
    expect(serializeClassificationManifest(first)).toBe(serializeClassificationManifest(second));
    expect(ClassificationManifestSchema.safeParse(first).success).toBe(true);
  });
});
