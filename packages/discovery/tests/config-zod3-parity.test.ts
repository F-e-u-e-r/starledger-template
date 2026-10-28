import { describe, expect, it } from 'vitest';
import { DiscoveryInboxConfigSchema, DiscoveryDecisionsConfigSchema } from '../src/config';

// Zod 3 -> Zod 4 parity oracle. The expected values below were captured by running these
// exact inputs through the schemas under zod@3.25.76 (the pre-migration contract). They pin
// accept/reject outcomes, the fully defaulted outputs (nested `.prefault({})` defaults
// included) and the issue PATHS of rejections. Issue codes and messages are Zod's own naming
// and are deliberately not asserted.
describe('DiscoveryInboxConfigSchema parity with zod@3.25.76', () => {
  it('empty: accepted with the Zod 3 output', () => {
    const result = DiscoveryInboxConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      manual: [],
    });
  });

  it('unknown-key-rejected: rejected at the same paths as Zod 3', () => {
    const result = DiscoveryInboxConfigSchema.safeParse({
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});

describe('DiscoveryDecisionsConfigSchema parity with zod@3.25.76', () => {
  it('empty: accepted with the Zod 3 output', () => {
    const result = DiscoveryDecisionsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      dismissed: [],
      promoted: [],
    });
  });

  it('unknown-key-rejected: rejected at the same paths as Zod 3', () => {
    const result = DiscoveryDecisionsConfigSchema.safeParse({
      extra: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});
