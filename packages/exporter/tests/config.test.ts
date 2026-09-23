import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveRetryConfig } from '../src/config';

describe('loadConfig (B1: an explicit missing path fails closed)', () => {
  it('returns defaults when no path is supplied', () => {
    expect(loadConfig().hydrate_batch_size).toBe(75);
  });

  it('throws TerminalError (exit 10) for an explicit path that does not exist', () => {
    let err: unknown;
    try {
      loadConfig('/definitely/not/here.yaml');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TerminalError);
    expect((err as TerminalError).exitCode).toBe(10);
    expect((err as TerminalError).code).toBe('CONFIG_NOT_FOUND');
  });

  it('parses a real config file that exists', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'exporter-config-')), 'config.yaml');
    writeFileSync(path, 'hydrate_batch_size: 10\n');
    expect(loadConfig(path).hydrate_batch_size).toBe(10);
  });
});

describe('resolveRetryConfig', () => {
  it('returns no override when the env var is unset (library default applies)', () => {
    expect(resolveRetryConfig({})).toEqual({});
  });

  it('returns no override for an empty/whitespace value', () => {
    expect(resolveRetryConfig({ STARLEDGER_RETRY_MAX_TOTAL_WAIT_MS: '   ' })).toEqual({});
  });

  it('parses a positive integer of milliseconds', () => {
    expect(resolveRetryConfig({ STARLEDGER_RETRY_MAX_TOTAL_WAIT_MS: '600000' })).toEqual({
      maxTotalWaitMs: 600_000,
    });
  });

  it.each(['0', '-1', 'abc', '300.5', 'NaN'])('fails closed on a malformed value: %s', (value) => {
    expect(() => resolveRetryConfig({ STARLEDGER_RETRY_MAX_TOTAL_WAIT_MS: value })).toThrow(
      TerminalError,
    );
  });

  it('surfaces the offending value and an INVALID_RETRY_BUDGET code', () => {
    const err = (() => {
      try {
        resolveRetryConfig({ STARLEDGER_RETRY_MAX_TOTAL_WAIT_MS: 'nope' });
        return null;
      } catch (e) {
        return e as TerminalError;
      }
    })();
    expect(err).toBeInstanceOf(TerminalError);
    expect(err?.code).toBe('INVALID_RETRY_BUDGET');
    expect(err?.message).toContain('nope');
  });
});
