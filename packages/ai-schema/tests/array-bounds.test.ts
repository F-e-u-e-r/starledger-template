import { describe, expect, it } from 'vitest';
import { ClassificationInputSchema } from '../src/job';

// GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404): before zod@4.6.6 an array/set/map size bound ran
// AFTER every element had been parsed, so an oversized, element-invalid collection built one
// issue per element (memory exhaustion). AI executor artifacts are untrusted PR data that the
// CI gates validate with these schemas, so the bound must reject first. This pins the fixed
// behaviour on a real external-input schema: `topics` is capped at 100 entries.
describe('ClassificationInputSchema size bounds (GHSA-mrhx-c7xc-m3w5)', () => {
  const valid = {
    name_with_owner: 'acme/widgets',
    description: null,
    primary_language: null,
    topics: ['a', 'b'],
    repo_metadata_sha256: 'a'.repeat(64),
    readme: null,
  };

  it('accepts a bounded, sorted topics array', () => {
    expect(ClassificationInputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an oversized topics array with a single too_big issue, before parsing elements', () => {
    const oversized = {
      ...valid,
      topics: Array.from({ length: 100_001 }, () => 0 as unknown as string),
    };
    const result = ClassificationInputSchema.safeParse(oversized);
    expect(result.success).toBe(false);
    if (result.success) return;
    // Exactly one bound issue, not 100 001 per-element issues (the pre-4.6.6 behaviour
    // produces 100 002 issues here, so this assertion discriminates the fix).
    expect(
      result.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') })),
    ).toEqual([{ code: 'too_big', path: 'topics' }]);
  });

  it('still rejects an element-invalid array within the bound, element by element', () => {
    const result = ClassificationInputSchema.safeParse({ ...valid, topics: ['ok', ''] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('topics.1');
  });
});
