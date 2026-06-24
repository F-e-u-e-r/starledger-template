import { describe, expect, it } from 'vitest';
import { assembleAiArtifacts } from '../src/assemble';
import {
  CandidateValidationError,
  candidateToAnnotation,
  validateCandidate,
} from '../src/validate-candidate';
import { makeCandidate, makeJob } from '../../ai-schema/tests/helpers';

const LONG_SUMMARY =
  'A concise factual repository summary that is intentionally long enough to satisfy the public annotation bounds after normalization.';

describe('candidate validation', () => {
  it('CAND-1: a candidate that exactly matches its job is accepted and normalized', () => {
    const job = makeJob();
    const candidate = makeCandidate(job, { tags: ['cli', 'automation', 'cli'] });
    const validated = validateCandidate(candidate, job);
    expect(validated.tags).toEqual(['automation', 'cli']);
  });

  it('CAND-2: a stale source fingerprint is rejected', () => {
    const job = makeJob();
    const candidate = makeCandidate(job, { source_fingerprint: 'c'.repeat(64) });
    expect(() => validateCandidate(candidate, job)).toThrow(CandidateValidationError);
  });

  it('CAND-3: a wrong node_id or job_id is rejected', () => {
    const job = makeJob();
    expect(() => validateCandidate(makeCandidate(job, { node_id: 'R_other' }), job)).toThrow(
      CandidateValidationError,
    );
    expect(() =>
      validateCandidate(makeCandidate(job, { job_id: `sha256:${'d'.repeat(64)}` }), job),
    ).toThrow(CandidateValidationError);
  });

  it('EXEC-1: Claude manifest + Claude candidate passes', () => {
    const job = makeJob();
    const validated = validateCandidate(makeCandidate(job), job);
    expect(validated.candidate.execution.kind).toBe('claude-routine');
  });

  it('EXEC-2: Claude manifest + Codex candidate fails', () => {
    const job = makeJob();
    expect(() =>
      validateCandidate(
        makeCandidate(job, {
          execution: {
            kind: 'codex-automation',
            profile_version: 'agent-v1',
            model_label: 'gpt-5.5',
          },
        }),
        job,
      ),
    ).toThrow(CandidateValidationError);
  });

  it('EXEC-4: executor kind and profile version are independently validated', () => {
    const codexJob = makeJob({ executor_kind: 'codex-automation' });
    const codex = validateCandidate(
      makeCandidate(codexJob, {
        execution: {
          kind: 'codex-automation',
          profile_version: 'agent-v1',
          model_label: 'gpt-5.5',
        },
      }),
      codexJob,
    );
    expect(codex.candidate.execution.kind).toBe('codex-automation');

    const job = makeJob();
    expect(() =>
      validateCandidate(
        makeCandidate(job, {
          execution: {
            kind: 'claude-routine',
            profile_version: 'agent-v2',
            model_label: 'sonnet',
          },
        }),
        job,
      ),
    ).toThrow(/profile/);
  });

  it('SUMMARY-1: leading and trailing whitespace is normalized', () => {
    const job = makeJob();
    const validated = validateCandidate(
      makeCandidate(job, { summary: `  ${LONG_SUMMARY}   ` }),
      job,
    );
    expect(candidateToAnnotation(validated, '2026-06-20T00:00:00Z').summary).toBe(LONG_SUMMARY);
  });

  it('SUMMARY-2/ART-4: CRLF and LF summaries produce identical artifact bytes', () => {
    const job = makeJob();
    const first = validateCandidate(makeCandidate(job, { summary: `${LONG_SUMMARY}\r\n` }), job);
    const second = validateCandidate(makeCandidate(job, { summary: `${LONG_SUMMARY}\n` }), job);
    const firstBytes = assembleAiArtifacts({
      currentAnnotations: [],
      validatedCandidates: [first],
      datasetSha256: 'e'.repeat(64),
      generatedAt: '2026-06-20T00:00:00Z',
    }).annotationsBytes;
    const secondBytes = assembleAiArtifacts({
      currentAnnotations: [],
      validatedCandidates: [second],
      datasetSha256: 'e'.repeat(64),
      generatedAt: '2026-06-20T00:00:00Z',
    }).annotationsBytes;
    expect(firstBytes).toBe(secondBytes);
  });

  it('SUMMARY-3: Unicode-equivalent summaries normalize to identical artifact bytes', () => {
    const job = makeJob();
    const decomposed = `${LONG_SUMMARY} Cafe\u0301 classification.`;
    const composed = `${LONG_SUMMARY} Café classification.`;
    const first = assembleAiArtifacts({
      currentAnnotations: [],
      validatedCandidates: [validateCandidate(makeCandidate(job, { summary: decomposed }), job)],
      datasetSha256: 'e'.repeat(64),
      generatedAt: '2026-06-20T00:00:00Z',
    }).annotationsBytes;
    const second = assembleAiArtifacts({
      currentAnnotations: [],
      validatedCandidates: [validateCandidate(makeCandidate(job, { summary: composed }), job)],
      datasetSha256: 'e'.repeat(64),
      generatedAt: '2026-06-20T00:00:00Z',
    }).annotationsBytes;
    expect(first).toBe(second);
  });

  it('SUMMARY-4: a summary below the minimum after normalization fails', () => {
    const job = makeJob();
    expect(() =>
      validateCandidate(makeCandidate(job, { summary: '        too short        ' }), job),
    ).toThrow(CandidateValidationError);
  });

  it('SUMMARY-5: control characters in a summary fail', () => {
    const job = makeJob();
    expect(() =>
      validateCandidate(makeCandidate(job, { summary: `${LONG_SUMMARY}\u0007` }), job),
    ).toThrow();
  });

  it('normalizes optional model labels before artifact construction', () => {
    const job = makeJob();
    const labeled = validateCandidate(
      makeCandidate(job, {
        execution: {
          kind: 'claude-routine',
          profile_version: 'agent-v1',
          model_label: '  Claude Sonnet  ',
        },
      }),
      job,
    );
    expect(candidateToAnnotation(labeled, '2026-06-20T00:00:00Z').generation.model_label).toBe(
      'Claude Sonnet',
    );

    const unlabeled = validateCandidate(
      makeCandidate(job, {
        execution: {
          kind: 'claude-routine',
          profile_version: 'agent-v1',
          model_label: null,
        },
      }),
      job,
    );
    expect(candidateToAnnotation(unlabeled, '2026-06-20T00:00:00Z').generation.model_label).toBe(
      null,
    );
  });

  it('rejects model labels with control characters', () => {
    const job = makeJob();
    expect(() =>
      validateCandidate(
        makeCandidate(job, {
          execution: {
            kind: 'claude-routine',
            profile_version: 'agent-v1',
            model_label: 'bad\nlabel',
          },
        }),
        job,
      ),
    ).toThrow();
  });
});
