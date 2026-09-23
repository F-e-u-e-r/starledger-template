import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { loadNotifierConfig, NotifierConfigSchema } from '../src/config';

describe('loadNotifierConfig (B1: a mistyped path must not silently poll defaults)', () => {
  it('returns defaults when no path is supplied', () => {
    expect(loadNotifierConfig().awesome_stars.repository).toBe('maguowei/awesome-stars');
  });

  it('throws TerminalError (exit 10) for an explicit path that does not exist', () => {
    let err: unknown;
    try {
      loadNotifierConfig('/definitely/not/here.yaml');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TerminalError);
    expect((err as TerminalError).exitCode).toBe(10);
    expect((err as TerminalError).code).toBe('CONFIG_NOT_FOUND');
  });

  it('parses a real config file that exists', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'notifier-config-')), 'notifier.yaml');
    writeFileSync(path, 'retry:\n  attention_after_attempts: 3\n');
    expect(loadNotifierConfig(path).retry.attention_after_attempts).toBe(3);
  });
});

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
