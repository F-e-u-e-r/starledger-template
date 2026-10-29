import { describe, expect, it } from 'vitest';
import { NotifierConfigSchema } from '../src/config';

// Zod 3 -> Zod 4 parity oracle. The expected values below were captured by running these
// exact inputs through the schemas under zod@3.25.76 (the pre-migration contract). They pin
// accept/reject outcomes, the fully defaulted outputs (nested `.prefault({})` defaults
// included) and the issue PATHS of rejections. Issue codes and messages are Zod's own naming
// and are deliberately not asserted.
describe('NotifierConfigSchema parity with zod@3.25.76', () => {
  it('empty: accepted with the Zod 3 output', () => {
    const result = NotifierConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      youtube: {
        channels: [],
        recent_seen_limit: 100,
      },
      awesome_stars: {
        repository: 'maguowei/awesome-stars',
        ref: 'master',
        paths: ['README.md'],
      },
      telegram: {
        disable_web_page_preview: true,
      },
      state: {
        branch: 'starledger-state',
        file: 'notifier-state.json',
        remote: 'origin',
      },
      retention: {
        delivery_days: 90,
        delivery_max: 2000,
      },
      summary: {
        use_llm: false,
      },
      retry: {
        attention_after_attempts: 6,
      },
    });
  });

  it('partial-nested: accepted with the Zod 3 output', () => {
    const result = NotifierConfigSchema.safeParse({
      youtube: {
        channels: ['UC1'],
      },
      retention: {
        delivery_days: 7,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      youtube: {
        channels: ['UC1'],
        recent_seen_limit: 100,
      },
      awesome_stars: {
        repository: 'maguowei/awesome-stars',
        ref: 'master',
        paths: ['README.md'],
      },
      telegram: {
        disable_web_page_preview: true,
      },
      state: {
        branch: 'starledger-state',
        file: 'notifier-state.json',
        remote: 'origin',
      },
      retention: {
        delivery_days: 7,
        delivery_max: 2000,
      },
      summary: {
        use_llm: false,
      },
      retry: {
        attention_after_attempts: 6,
      },
    });
  });

  it('awesome-only-repo: accepted with the Zod 3 output', () => {
    const result = NotifierConfigSchema.safeParse({
      awesome_stars: {
        repository: 'x/y',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      youtube: {
        channels: [],
        recent_seen_limit: 100,
      },
      awesome_stars: {
        repository: 'x/y',
        ref: 'master',
        paths: ['README.md'],
      },
      telegram: {
        disable_web_page_preview: true,
      },
      state: {
        branch: 'starledger-state',
        file: 'notifier-state.json',
        remote: 'origin',
      },
      retention: {
        delivery_days: 90,
        delivery_max: 2000,
      },
      summary: {
        use_llm: false,
      },
      retry: {
        attention_after_attempts: 6,
      },
    });
  });

  it('telegram-false: accepted with the Zod 3 output', () => {
    const result = NotifierConfigSchema.safeParse({
      telegram: {
        disable_web_page_preview: false,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      youtube: {
        channels: [],
        recent_seen_limit: 100,
      },
      awesome_stars: {
        repository: 'maguowei/awesome-stars',
        ref: 'master',
        paths: ['README.md'],
      },
      telegram: {
        disable_web_page_preview: false,
      },
      state: {
        branch: 'starledger-state',
        file: 'notifier-state.json',
        remote: 'origin',
      },
      retention: {
        delivery_days: 90,
        delivery_max: 2000,
      },
      summary: {
        use_llm: false,
      },
      retry: {
        attention_after_attempts: 6,
      },
    });
  });

  it('use_llm-true-rejected: rejected at the same paths as Zod 3', () => {
    const result = NotifierConfigSchema.safeParse({
      summary: {
        use_llm: true,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['summary.use_llm']);
  });

  it('unknown-key-rejected: rejected at the same paths as Zod 3', () => {
    const result = NotifierConfigSchema.safeParse({
      bogus: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });

  it('nested-unknown-key-rejected: rejected at the same paths as Zod 3', () => {
    const result = NotifierConfigSchema.safeParse({
      youtube: {
        nope: 1,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['youtube']);
  });

  it('empty-paths-rejected: rejected at the same paths as Zod 3', () => {
    const result = NotifierConfigSchema.safeParse({
      awesome_stars: {
        paths: [],
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['awesome_stars.paths']);
  });

  it('bad-type: rejected at the same paths as Zod 3', () => {
    const result = NotifierConfigSchema.safeParse({
      retention: {
        delivery_days: '7',
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['retention.delivery_days']);
  });

  it('below-min: rejected at the same paths as Zod 3', () => {
    const result = NotifierConfigSchema.safeParse({
      youtube: {
        recent_seen_limit: 10,
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['youtube.recent_seen_limit']);
  });

  it('null-input-rejected: rejected at the same paths as Zod 3', () => {
    const result = NotifierConfigSchema.safeParse(null);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['']);
  });
});
