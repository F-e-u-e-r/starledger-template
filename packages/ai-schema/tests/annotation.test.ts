import { describe, expect, it } from 'vitest';
import { AnnotationSchema } from '../src/annotation';
import { TAG_MAX_LENGTH, TAGS } from '../src/taxonomy';
import { makeAnnotation } from './helpers';

describe('AnnotationSchema (taxonomy + strictness)', () => {
  it('TAXONOMY-1: every controlled tag stays within the versioned length limit', () => {
    expect(TAGS.every((tag) => tag.length <= TAG_MAX_LENGTH)).toBe(true);
  });

  it('SCHEMA-1: a valid annotation passes', () => {
    expect(AnnotationSchema.safeParse(makeAnnotation()).success).toBe(true);
  });

  it('SCHEMA-2: an unknown category fails', () => {
    expect(
      AnnotationSchema.safeParse({ ...makeAnnotation(), category: 'blockchain' }).success,
    ).toBe(false);
  });

  it('SCHEMA-3: an unknown tag fails', () => {
    expect(
      AnnotationSchema.safeParse({ ...makeAnnotation(), tags: ['cli', 'blockchain'] }).success,
    ).toBe(false);
  });

  it('SCHEMA-4: duplicate tags fail', () => {
    expect(AnnotationSchema.safeParse({ ...makeAnnotation(), tags: ['cli', 'cli'] }).success).toBe(
      false,
    );
  });

  it('SCHEMA-5: more than the maximum number of tags fails', () => {
    const seven = ['api', 'automation', 'backend', 'cli', 'database', 'editor', 'frontend'];
    expect(AnnotationSchema.safeParse({ ...makeAnnotation(), tags: seven }).success).toBe(false);
  });

  it('SCHEMA-6: a summary outside the length bounds fails', () => {
    expect(AnnotationSchema.safeParse({ ...makeAnnotation(), summary: 'too short' }).success).toBe(
      false,
    );
    expect(
      AnnotationSchema.safeParse({ ...makeAnnotation(), summary: 'x'.repeat(401) }).success,
    ).toBe(false);
  });

  it('rejects an unsorted (but otherwise valid) tag list', () => {
    expect(
      AnnotationSchema.safeParse({ ...makeAnnotation(), tags: ['cli', 'automation'] }).success,
    ).toBe(false);
  });

  it('STRICT-1: an unknown field is rejected', () => {
    expect(AnnotationSchema.safeParse({ ...makeAnnotation(), extra: 1 }).success).toBe(false);
  });

  it('enforces readme/metadata source agreement', () => {
    const base = makeAnnotation();
    // a readme source without a path/oid is invalid
    expect(
      AnnotationSchema.safeParse({
        ...base,
        source: { ...base.source, readme_path: null, readme_oid: null },
      }).success,
    ).toBe(false);
    // a metadata source that still carries a path/oid is invalid
    expect(
      AnnotationSchema.safeParse({ ...base, source: { ...base.source, kind: 'metadata' } }).success,
    ).toBe(false);
    // a metadata source with no path/oid is valid
    expect(
      AnnotationSchema.safeParse({
        ...base,
        source: { ...base.source, kind: 'metadata', readme_path: null, readme_oid: null },
      }).success,
    ).toBe(true);
  });
});
