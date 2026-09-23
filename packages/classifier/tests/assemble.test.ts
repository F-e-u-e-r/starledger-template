import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
  sha256,
} from '@starred/ai-schema';
import { assembleAiArtifacts, verifyAiArtifacts } from '../src/assemble';
import { candidateToAnnotation, validateCandidate } from '../src/validate-candidate';
import { makeAnnotation, makeCandidate, makeJob } from '../../ai-schema/tests/helpers';

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
      canonicalNodeIds: new Set([job.node_id]),
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-20T00:00:00Z',
    });
    expect(result.changed).toBe(true);
    expect(result.annotationsBytes).not.toContain(job.input.readme?.content ?? 'unexpected');
    expect(result.annotationsBytes).not.toContain(secretMarker);
    expect(result.meta?.annotations_sha256).toBe(sha256(result.annotationsBytes));
    expect(result.metaBytes).not.toBeNull();
    verifyAiArtifacts(Buffer.from(result.annotationsBytes, 'utf8'), result.metaBytes ?? '');
  });

  it('ART-3: applying an identical candidate preserves generated_at and artifact bytes', () => {
    const job = makeJob();
    const validated = validateCandidate(makeCandidate(job), job);
    const existing = candidateToAnnotation(validated, '2026-06-20T00:00:00Z');
    const result = assembleAiArtifacts({
      currentAnnotations: [existing],
      validatedCandidates: [validated],
      canonicalNodeIds: new Set([job.node_id]),
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
      canonicalNodeIds: new Set([job.node_id]),
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-20T00:00:00Z',
    });
    const nonCanonical = `${result.annotationsBytes.trimEnd()}\n\n`;
    const meta = result.metaBytes?.replace(
      result.meta?.annotations_sha256 ?? '',
      sha256(nonCanonical),
    );
    expect(() => verifyAiArtifacts(Buffer.from(nonCanonical, 'utf8'), meta ?? '')).toThrow(
      'ai-annotations.json is not deterministically serialized',
    );
  });
});

describe('removed-star prune (issue #212)', () => {
  it('PRUNE-1: an annotation whose repository left the canonical dataset is pruned', () => {
    const keep = makeAnnotation();
    const orphan = makeAnnotation({ node_id: 'R_zz' });
    const result = assembleAiArtifacts({
      currentAnnotations: [keep, orphan],
      validatedCandidates: [],
      canonicalNodeIds: new Set([keep.node_id]),
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-21T00:00:00Z',
    });
    expect(result.changed).toBe(true);
    expect(result.prunedNodeIds).toEqual(['R_zz']);
    expect(result.annotations.map((a) => a.node_id)).toEqual([keep.node_id]);
    // the surviving record keeps its original timestamp (no churn)
    expect(result.annotations[0]?.generation.generated_at).toBe(keep.generation.generated_at);
    expect(result.meta?.annotation_count).toBe(1);
    expect(result.meta?.dataset_sha256).toBe(DATASET_SHA);
    verifyAiArtifacts(Buffer.from(result.annotationsBytes, 'utf8'), result.metaBytes ?? '');
  });

  it('PRUNE-2: no orphans and zero candidates are a byte-identical no-op', () => {
    const keep = makeAnnotation();
    const result = assembleAiArtifacts({
      currentAnnotations: [keep],
      validatedCandidates: [],
      canonicalNodeIds: new Set([keep.node_id]),
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-21T00:00:00Z',
    });
    expect(result.changed).toBe(false);
    expect(result.prunedNodeIds).toEqual([]);
    expect(result.meta).toBeNull();
    expect(result.annotationsBytes).toBe(serializeAnnotations([keep]));
  });

  it('PRUNE-3: one assembly prunes the orphan and applies a valid candidate', () => {
    const job = makeJob();
    const validated = validateCandidate(makeCandidate(job), job);
    const orphan = makeAnnotation({ node_id: 'R_zz' });
    const result = assembleAiArtifacts({
      currentAnnotations: [orphan],
      validatedCandidates: [validated],
      canonicalNodeIds: new Set([job.node_id]),
      datasetSha256: DATASET_SHA,
      generatedAt: '2026-06-21T00:00:00Z',
    });
    expect(result.changed).toBe(true);
    expect(result.prunedNodeIds).toEqual(['R_zz']);
    expect(result.annotations.map((a) => a.node_id)).toEqual([job.node_id]);
  });

  it('PRUNE-4: a validated candidate outside the canonical dataset is a hard failure', () => {
    const job = makeJob();
    const validated = validateCandidate(makeCandidate(job), job);
    expect(() =>
      assembleAiArtifacts({
        currentAnnotations: [],
        validatedCandidates: [validated],
        canonicalNodeIds: new Set(['R_other']),
        datasetSha256: DATASET_SHA,
        generatedAt: '2026-06-20T00:00:00Z',
      }),
    ).toThrow(/not in the canonical dataset/);
  });
});

/**
 * VERIFICATION IS A BYTE CONTRACT (round-9 owner ruling, closing the
 * fifth/sixth surfaces of the decoded-text digest class). Same trap as the
 * canonical dataset: a literal U+FFFD's three UTF-8 bytes swapped for a bare
 * 0xFF decode back to identical text, so a decoded-text hash matches while
 * the bytes differ — the old implementation ACCEPTED an artifact that the
 * byte-strict deploy stager and runtime loader then reject.
 */
describe('verifyAiArtifacts is a BYTE contract', () => {
  function pairWithReplacementChar(): { annotationsBytes: Buffer; meta: string } {
    const annotationsText = serializeAnnotations([
      makeAnnotation({
        summary:
          'A concise, factual description \uFFFD of what this repository does and why it is useful.',
      }),
    ]);
    const meta = serializeAiAnnotationsMeta(
      buildAiAnnotationsMeta({
        annotationsBytes: annotationsText,
        annotationCount: 1,
        datasetSha256: DATASET_SHA,
        generatedAt: '2026-06-21T00:00:00Z',
      }),
    );
    return { annotationsBytes: Buffer.from(annotationsText, 'utf8'), meta };
  }

  it('CONTROL: the unmutated bytes verify', () => {
    const { annotationsBytes, meta } = pairWithReplacementChar();
    expect(() => verifyAiArtifacts(annotationsBytes, meta)).not.toThrow();
  });

  it('BYTES: a byte mutation that decodes to identical text is REJECTED', () => {
    const { annotationsBytes, meta } = pairWithReplacementChar();
    const at = annotationsBytes.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      annotationsBytes.subarray(0, at),
      Buffer.from([0xff]),
      annotationsBytes.subarray(at + 3),
    ]);
    // Preconditions of the trap: bytes differ, decoded text does not.
    expect(mutated.equals(annotationsBytes)).toBe(false);
    expect(mutated.toString('utf8')).toBe(annotationsBytes.toString('utf8'));

    // With the canonical-form check byte-strict (round-9), a decode-alike
    // mutation dies THERE, before the hash gate: the mutated bytes are not the
    // serializer's output bytes.
    expect(() => verifyAiArtifacts(mutated, meta)).toThrow(/not deterministically serialized/);
  });

  it('HASH-GATE: canonical bytes with a wrong meta digest are rejected by the hash check', () => {
    const { annotationsBytes, meta } = pairWithReplacementChar();
    const tampered = meta.replace(
      /"annotations_sha256": "[0-9a-f]{64}"/,
      `"annotations_sha256": "${'0'.repeat(64)}"`,
    );
    expect(tampered).not.toBe(meta);
    expect(() => verifyAiArtifacts(annotationsBytes, tampered)).toThrow(
      /hash does not match ai-annotations\.json bytes/,
    );
  });
});

/**
 * The RE-STAMPED variant (round-9 finding, sol@max): the BYTES pin above keeps
 * the ORIGINAL meta, so the mutated artifact dies at the hash check and the
 * canonical-form check is never reached. Re-stamp the meta with the correct
 * BYTE digest of the mutated artifact and both the hash check AND a
 * canonical-form check running on DECODED text pass — accepting artifact bytes
 * that are NOT the canonical serialization. The canonical-form contract is a
 * byte contract too: the artifact's exact bytes must BE the serializer's
 * output bytes.
 */
describe('verifyAiArtifacts canonical form is a BYTE contract', () => {
  it('BYTES-RESTAMPED: a decode-alike mutation with a correctly re-stamped meta is REJECTED', () => {
    const annotationsText = serializeAnnotations([
      makeAnnotation({
        summary:
          'A concise, factual description \uFFFD of what this repository does and why it is useful.',
      }),
    ]);
    const annotationsBytes = Buffer.from(annotationsText, 'utf8');
    const at = annotationsBytes.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
    expect(at).toBeGreaterThan(-1);
    const mutated = Buffer.concat([
      annotationsBytes.subarray(0, at),
      Buffer.from([0xff]),
      annotationsBytes.subarray(at + 3),
    ]);
    expect(mutated.equals(annotationsBytes)).toBe(false);
    expect(mutated.toString('utf8')).toBe(annotationsBytes.toString('utf8'));
    // Meta stamped over the MUTATED bytes: the hash check now passes; only a
    // byte-strict canonical-form check can refuse the pair.
    const meta = serializeAiAnnotationsMeta(
      buildAiAnnotationsMeta({
        annotationsBytes: annotationsText,
        annotationCount: 1,
        datasetSha256: DATASET_SHA,
        generatedAt: '2026-06-21T00:00:00Z',
      }),
    ).replace(
      createHash('sha256').update(annotationsBytes).digest('hex'),
      createHash('sha256').update(mutated).digest('hex'),
    );
    expect(() => verifyAiArtifacts(mutated, meta)).toThrow(/not deterministically serialized/);
  });
});
