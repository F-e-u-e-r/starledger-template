import { AuthError, RetryBudgetExhaustedError } from '@starred/github-client';
import { describe, expect, it, vi } from 'vitest';
import { fatal } from '../src/fatal';

/** Sentinel thrown by the process.exit spy so fatal() unwinds instead of exiting. */
class ExitSignal extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`exit ${String(code)}`);
  }
}

/** Run fatal() with process.exit and stderr captured; return what it did. */
function captureFatal(error: unknown): {
  code: number | string | null | undefined;
  stderr: string;
} {
  const writes: string[] = [];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?) => {
    throw new ExitSignal(code);
  });
  const errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(String(chunk));
      return true;
    });
  try {
    fatal(error);
    throw new Error('unreachable: fatal() must never return');
  } catch (thrown) {
    if (!(thrown instanceof ExitSignal)) throw thrown;
    return { code: thrown.code, stderr: writes.join('') };
  } finally {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('fatal() exit-code contract (issue #56)', () => {
  it('FATAL-1: a DeferredError exits 20 (recoverable — retry next run)', () => {
    const result = captureFatal(new RetryBudgetExhaustedError('probe retries exhausted'));
    expect(result.code).toBe(20);
    expect(result.stderr).toBe('fatal (exit 20): probe retries exhausted\n');
  });

  it('FATAL-2: a TerminalError exits 10 with its own message', () => {
    const result = captureFatal(new AuthError('bad credentials'));
    expect(result.code).toBe(10);
    expect(result.stderr).toBe('fatal (exit 10): bad credentials\n');
  });

  it('FATAL-3: a plain Error is terminal (exit 10)', () => {
    const result = captureFatal(new Error('boom'));
    expect(result.code).toBe(10);
    expect(result.stderr).toBe('fatal (exit 10): boom\n');
  });

  it('FATAL-4: a non-Error value is stringified and terminal (exit 10)', () => {
    const result = captureFatal('string failure');
    expect(result.code).toBe(10);
    expect(result.stderr).toBe('fatal (exit 10): string failure\n');
  });
});
