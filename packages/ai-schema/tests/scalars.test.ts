import { describe, expect, it } from 'vitest';
import { AnnotationSchema } from '../src/annotation';
import { serializeAnnotations } from '../src/artifact';
import { buildAiAnnotationsMeta } from '../src/meta-build';
import { normalizeSummary } from '../src/scalars';
import { makeAnnotation } from './helpers';

describe('AI scalar contracts', () => {
  it('TIME-1: accepts canonical UTC Z timestamps', () => {
    expect(
      AnnotationSchema.safeParse(
        makeAnnotation({
          generation: { ...makeAnnotation().generation, generated_at: '2026-06-20T12:34:56Z' },
        }),
      ).success,
    ).toBe(true);
    expect(() =>
      buildAiAnnotationsMeta({
        annotationsBytes: serializeAnnotations([makeAnnotation()]),
        annotationCount: 1,
        datasetSha256: 'c'.repeat(64),
        generatedAt: '2026-06-20T12:34:56Z',
      }),
    ).not.toThrow();
  });

  it('TIME-2/TIME-3/STRICT-2: rejects offsets, date-only values, and arbitrary text', () => {
    for (const generated_at of ['2026-06-20T20:34:56+08:00', '2026-06-20', 'tomorrow']) {
      expect(
        AnnotationSchema.safeParse({
          ...makeAnnotation(),
          generation: { ...makeAnnotation().generation, generated_at },
        }).success,
      ).toBe(false);
    }
  });

  it('TIME-4: serialization preserves normalized UTC Z timestamps', () => {
    const bytes = serializeAnnotations([
      makeAnnotation({
        generation: { ...makeAnnotation().generation, generated_at: '2026-06-20T12:34:56Z' },
      }),
    ]);
    expect(JSON.parse(bytes).annotations[0].generation.generated_at).toBe('2026-06-20T12:34:56Z');
  });

  it('normalizes summary whitespace and Unicode deterministically', () => {
    expect(normalizeSummary(' Cafe\u0301  toolkit\r\nfor\tdevelopers. ')).toBe(
      'Café toolkit for developers.',
    );
  });
});
