import { describe, expect, it } from 'vitest';
import { NotifierConfigSchema } from '../src/config';

describe('NotifierConfigSchema', () => {
  it('rejects the reserved summary.use_llm=true with a clear, located message', () => {
    const result = NotifierConfigSchema.safeParse({ summary: { use_llm: true } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/reserved/i);
      expect(result.error.issues[0]?.path).toEqual(['summary', 'use_llm']);
    }
  });

  it('accepts use_llm=false and defaults the retry attention threshold', () => {
    const config = NotifierConfigSchema.parse({});
    expect(config.summary.use_llm).toBe(false);
    expect(config.retry.attention_after_attempts).toBe(6);
  });

  it('rejects an attention threshold below 1', () => {
    expect(NotifierConfigSchema.safeParse({ retry: { attention_after_attempts: 0 } }).success).toBe(
      false,
    );
  });
});
