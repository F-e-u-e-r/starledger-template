import { describe, expect, it } from 'vitest';
import { UtcTimestampSchema } from '../src/scalars';
import { SkillsClassificationMetaSchema } from '../src/meta';

// Zod 3 -> Zod 4 parity oracle for UNCHANGED external-input schemas. Expected values were
// captured by running these exact inputs under zod@3.25.76 (the pre-migration contract):
// accept/reject, the stored output for accepted inputs (no trimming or rewriting), and the
// set of issue paths for rejected inputs. Issue codes and messages are Zod's own naming and
// are deliberately not asserted. Inputs whose outcome Zod 4 changed on purpose (safe-integer
// `.int()`, the early size-bound rejection of GHSA-mrhx-c7xc-m3w5) are disclosed in the PR
// instead of being pinned here.
describe('UtcTimestampSchema parity with zod@3.25.76 (skills-schema.UtcTimestampSchema)', () => {
  it('seconds-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00:00Z');
  });

  it('fraction-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00.123Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00:00.123Z');
  });

  it('fraction-long-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00.123456789Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00:00.123456789Z');
  });

  it('minutes-only-Z: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2026-10-27T10:00Z');
  });

  it('offset-colon: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+00:00');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('offset-nocolon: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+0000');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('offset-hhonly: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+01');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('offset-out-of-range: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00+99:99');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('no-offset: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('lowercase-z: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('space-separator: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27 10:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('leap-day-valid: accepted with the Zod 3 output', () => {
    const result = UtcTimestampSchema.safeParse('2028-02-29T00:00:00Z');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual('2028-02-29T00:00:00Z');
  });

  it('leap-day-invalid: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2027-02-29T00:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('month-13: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-13-01T00:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('hour-24: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T24:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('second-60: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:60Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('day-31-april: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-04-31T00:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('trailing-space: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('2026-10-27T10:00:00Z ');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('year-5digit: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('12026-10-27T10:00:00Z');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('empty: rejected at the same paths as Zod 3', () => {
    const result = UtcTimestampSchema.safeParse('');
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});

describe('SkillsClassificationMetaSchema parity with zod@3.25.76 (skills-schema.SkillsClassificationMetaSchema)', () => {
  it('helper-meta: accepted with the Zod 3 output', () => {
    const result = SkillsClassificationMetaSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      source_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      generated_at: '2026-08-13T00:00:00Z',
      category_count: 2,
      source_entry_count: 2,
      resolved_entry_count: 2,
      present_repo_count: 2,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 698,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      source_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      generated_at: '2026-08-13T00:00:00Z',
      category_count: 2,
      source_entry_count: 2,
      resolved_entry_count: 2,
      present_repo_count: 2,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 698,
    });
  });

  it('extra-key: rejected at the same paths as Zod 3', () => {
    const result = SkillsClassificationMetaSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      source_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      generated_at: '2026-08-13T00:00:00Z',
      category_count: 2,
      source_entry_count: 2,
      resolved_entry_count: 2,
      present_repo_count: 2,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 698,
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('generated-at-minutes-only: accepted with the Zod 3 output', () => {
    const result = SkillsClassificationMetaSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      source_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      generated_at: '2026-10-27T10:00Z',
      category_count: 2,
      source_entry_count: 2,
      resolved_entry_count: 2,
      present_repo_count: 2,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 698,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      source_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      generated_at: '2026-10-27T10:00Z',
      category_count: 2,
      source_entry_count: 2,
      resolved_entry_count: 2,
      present_repo_count: 2,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 698,
    });
  });

  it('generated-at-offset: rejected at the same paths as Zod 3', () => {
    const result = SkillsClassificationMetaSchema.safeParse({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      source_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      generated_at: '2026-10-27T10:00:00+00:00',
      category_count: 2,
      source_entry_count: 2,
      resolved_entry_count: 2,
      present_repo_count: 2,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 698,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['generated_at']);
  });

  it('null-input: rejected at the same paths as Zod 3', () => {
    const result = SkillsClassificationMetaSchema.safeParse(null);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});
