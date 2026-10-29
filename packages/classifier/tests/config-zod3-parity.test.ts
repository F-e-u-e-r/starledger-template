import { describe, expect, it } from 'vitest';
import { AiConfigSchema } from '../src/config';

// Zod 3 -> Zod 4 parity oracle. The expected values below were captured by running these
// exact inputs through the schemas under zod@3.25.76 (the pre-migration contract). They pin
// accept/reject outcomes, the fully defaulted outputs (nested `.prefault({})` defaults
// included) and the issue PATHS of rejections. Issue codes and messages are Zod's own naming
// and are deliberately not asserted.
describe('AiConfigSchema parity with zod@3.25.76', () => {
  it('empty: accepted with the Zod 3 output', () => {
    const result = AiConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      ai: {
        enabled: false,
        prompt_version: 'classify-v1',
        executor_kind: 'claude-routine',
        execution_profile: {
          execution_profile_version: 'agent-v1',
        },
        readme_max_chars: 30000,
        metadata_max_chars: 5000,
        budget: {
          max_new_per_run: 20,
          max_refresh_per_run: 5,
          max_retry_per_run: 5,
          max_total_per_run: 25,
        },
      },
    });
  });

  it('ai-empty: accepted with the Zod 3 output', () => {
    const result = AiConfigSchema.safeParse({
      ai: {},
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      ai: {
        enabled: false,
        prompt_version: 'classify-v1',
        executor_kind: 'claude-routine',
        execution_profile: {
          execution_profile_version: 'agent-v1',
        },
        readme_max_chars: 30000,
        metadata_max_chars: 5000,
        budget: {
          max_new_per_run: 20,
          max_refresh_per_run: 5,
          max_retry_per_run: 5,
          max_total_per_run: 25,
        },
      },
    });
  });

  it('ai-budget-partial: accepted with the Zod 3 output', () => {
    const result = AiConfigSchema.safeParse({
      ai: {
        enabled: true,
        budget: {
          max_new_per_run: 3,
        },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      ai: {
        enabled: true,
        prompt_version: 'classify-v1',
        executor_kind: 'claude-routine',
        execution_profile: {
          execution_profile_version: 'agent-v1',
        },
        readme_max_chars: 30000,
        metadata_max_chars: 5000,
        budget: {
          max_new_per_run: 3,
          max_refresh_per_run: 5,
          max_retry_per_run: 5,
          max_total_per_run: 25,
        },
      },
    });
  });

  it('unknown-key-rejected: rejected at the same paths as Zod 3', () => {
    const result = AiConfigSchema.safeParse({
      ai: {
        nope: true,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['ai']);
  });

  it('below-min-rejected: rejected at the same paths as Zod 3', () => {
    const result = AiConfigSchema.safeParse({
      ai: {
        readme_max_chars: 10,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['ai.readme_max_chars']);
  });

  it('bad-enum-rejected: rejected at the same paths as Zod 3', () => {
    const result = AiConfigSchema.safeParse({
      ai: {
        executor_kind: 'nope',
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['ai.executor_kind']);
  });
});
