import { describe, expect, it } from 'vitest';
import { sha256 } from '@starred/ai-schema';
import { assembleAiArtifacts, verifyAiArtifacts } from '../src/assemble';
import { candidateToAnnotation, validateCandidate } from '../src/validate-candidate';
import { makeCandidate, makeJob } from '../../ai-schema/tests/helpers';

const DATASET_SHA = 'e'.repeat(64);

describe('deterministic AI artifact assembly', () => {
  it('ART-1/ART-2/SEC-1: excludes raw README and secret markers, and writes a matching hash', () => {
    const secretMarker = 'STARLEDGER_TEST_SECRET_DO_NOT_PERSIST';
    const job = makeJob({
      node_id: 'R_b',
      input: {
        ...makeJob().input,
        readme: {
          path: 'README.md',
          oid: 'abc123def456',
          content: `Untrusted README content: ${secretMarker}`,
        },
      },
    });
    const validated = validateCandidate(makeCandidate(job), job);
    const result = assembleAiArtifacts({
      currentAnnotations: [],
      validatedCandidates: [validated],
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-20T00:00:00Z',
    });
    expect(result.changed).toBe(true);
    expect(result.annotationsBytes).not.toContain(job.input.readme?.content ?? 'unexpected');
    expect(result.annotationsBytes).not.toContain(secretMarker);
    expect(result.meta?.annotations_sha256).toBe(sha256(result.annotationsBytes));
    expect(result.metaBytes).not.toBeNull();
    verifyAiArtifacts(result.annotationsBytes, result.metaBytes ?? '');
  });

  it('ART-3: applying an identical candidate preserves generated_at and artifact bytes', () => {
    const job = makeJob();
    const validated = validateCandidate(makeCandidate(job), job);
    const existing = candidateToAnnotation(validated, '2026-06-20T00:00:00Z');
    const result = assembleAiArtifacts({
      currentAnnotations: [existing],
      validatedCandidates: [validated],
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-21T00:00:00Z',
    });
    expect(result.changed).toBe(false);
    expect(result.annotations[0]?.generation.generated_at).toBe('2026-06-20T00:00:00Z');
  });

  it('ART-4: non-canonical artifact bytes are rejected even when their hash matches', () => {
    const job = makeJob();
    const validated = validateCandidate(makeCandidate(job), job);
    const result = assembleAiArtifacts({
      currentAnnotations: [],
      validatedCandidates: [validated],
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-20T00:00:00Z',
    });
    const nonCanonical = `${result.annotationsBytes.trimEnd()}\n\n`;
    const meta = result.metaBytes?.replace(
      result.meta?.annotations_sha256 ?? '',
      sha256(nonCanonical),
    );
    expect(() => verifyAiArtifacts(nonCanonical, meta ?? '')).toThrow(
      'ai-annotations.json is not deterministically serialized',
    );
  });
});
