import { describe, expect, it } from 'vitest';
import { AiAnnotationsSchema, buildAiAnnotations, serializeAnnotations } from '../src/artifact';
import { sha256 } from '../src/hash';
import { buildAiAnnotationsMeta } from '../src/meta-build';
import { makeAnnotation } from './helpers';

describe('AI artifact determinism + integrity', () => {
  it('DET-1: object insertion order does not affect serialized bytes', () => {
    const base = makeAnnotation();
    const reordered = {
      generation: base.generation,
      source: base.source,
      summary: base.summary,
      tags: base.tags,
      category: base.category,
      node_id: base.node_id,
    };
    expect(serializeAnnotations([reordered])).toBe(serializeAnnotations([base]));
  });

  it('DET-2: annotations are always sorted by node_id ascending', () => {
    const bytes = serializeAnnotations([
      makeAnnotation({ node_id: 'R_c' }),
      makeAnnotation({ node_id: 'R_a' }),
      makeAnnotation({ node_id: 'R_b' }),
    ]);
    const parsed = JSON.parse(bytes) as { annotations: { node_id: string }[] };
    expect(parsed.annotations.map((annotation) => annotation.node_id)).toEqual([
      'R_a',
      'R_b',
      'R_c',
    ]);
  });

  it('emits 2-space indentation and a single trailing newline', () => {
    const bytes = serializeAnnotations([makeAnnotation()]);
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes.endsWith('\n\n')).toBe(false);
    expect(bytes).toContain('\n  "annotations"');
  });

  it('rejects duplicate node_id and unsorted annotations at the schema', () => {
    const a = makeAnnotation({ node_id: 'R_a' });
    const b = makeAnnotation({ node_id: 'R_b' });
    expect(AiAnnotationsSchema.safeParse(buildAiAnnotations([a, a])).success).toBe(false);
    const unsorted = { schema_version: '1.0', taxonomy_version: '1', annotations: [b, a] };
    expect(AiAnnotationsSchema.safeParse(unsorted).success).toBe(false);
  });

  it('META-1: the meta hash matches the exact annotation bytes', () => {
    const bytes = serializeAnnotations([makeAnnotation()]);
    const meta = buildAiAnnotationsMeta({
      annotationsBytes: bytes,
      annotationCount: 1,
      datasetSha256: 'c'.repeat(64),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    expect(meta.annotations_sha256).toBe(sha256(bytes));
    expect(meta.annotation_count).toBe(1);
  });
});
