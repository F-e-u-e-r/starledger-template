import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/config';

// Zod 3 -> Zod 4 parity oracle. The expected values below were captured by running these
// exact inputs through the schemas under zod@3.25.76 (the pre-migration contract). They pin
// accept/reject outcomes, the fully defaulted outputs (nested `.prefault({})` defaults
// included) and the issue PATHS of rejections. Issue codes and messages are Zod's own naming
// and are deliberately not asserted.
describe('ConfigSchema parity with zod@3.25.76', () => {
  it('empty: accepted with the Zod 3 output', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      username: null,
      hydrate_batch_size: 75,
      max_degraded_ratio: 0.05,
      allow_empty: false,
      rate_limit_reserve: 0,
      output: {
        stars: 'stars.json',
        dataset_meta: 'dataset-meta.json',
        run_meta: 'run-meta.json',
      },
    });
  });

  it('output-partial: accepted with the Zod 3 output', () => {
    const result = ConfigSchema.safeParse({
      output: {
        stars: 'a.json',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      username: null,
      hydrate_batch_size: 75,
      max_degraded_ratio: 0.05,
      allow_empty: false,
      rate_limit_reserve: 0,
      output: {
        stars: 'a.json',
        dataset_meta: 'dataset-meta.json',
        run_meta: 'run-meta.json',
      },
    });
  });

  it('username-null: accepted with the Zod 3 output', () => {
    const result = ConfigSchema.safeParse({
      username: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      username: null,
      hydrate_batch_size: 75,
      max_degraded_ratio: 0.05,
      allow_empty: false,
      rate_limit_reserve: 0,
      output: {
        stars: 'stars.json',
        dataset_meta: 'dataset-meta.json',
        run_meta: 'run-meta.json',
      },
    });
  });

  it('username-empty-rejected: rejected at the same paths as Zod 3', () => {
    const result = ConfigSchema.safeParse({
      username: '',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['username']);
  });

  it('ratio-out-of-range-rejected: rejected at the same paths as Zod 3', () => {
    const result = ConfigSchema.safeParse({
      max_degraded_ratio: 2,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['max_degraded_ratio']);
  });

  it('unknown-key-rejected: rejected at the same paths as Zod 3', () => {
    const result = ConfigSchema.safeParse({
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});
