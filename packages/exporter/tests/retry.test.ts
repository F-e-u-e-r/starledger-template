import {
  RateLimitInsufficientError,
  RetryBudgetExhaustedError,
  SecondaryLimitCooldownExceededError,
  TerminalError,
} from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { httpError, makeTestCoordinator } from './helpers';

describe('RetryCoordinator (RATE-1..6)', () => {
  it('RATE-1: honors a secondary-limit Retry-After, then succeeds', async () => {
    const coord = makeTestCoordinator();
    let calls = 0;
    const result = await coord.run(async () => {
      calls += 1;
      if (calls === 1) {
        throw httpError(403, 'You have exceeded a secondary rate limit', { 'retry-after': '2' });
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(coord.telemetry.secondaryLimitEvents).toBe(1);
    expect(coord.telemetry.totalWaitMs).toBe(2000);
  });

  it('RATE-2: a persistent secondary limit exhausts the budget (deferred)', async () => {
    const coord = makeTestCoordinator({ maxAttempts: 3, maxTotalWaitMs: 1_000_000 });
    await expect(
      coord.run(async () => {
        throw httpError(429, 'secondary rate limit');
      }),
    ).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
  });

  it('RATE-3: insufficient primary rate limit defers immediately (no retry)', async () => {
    const coord = makeTestCoordinator();
    let calls = 0;
    await expect(
      coord.run(async () => {
        calls += 1;
        throw httpError(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0' });
      }),
    ).rejects.toBeInstanceOf(RateLimitInsufficientError);
    expect(calls).toBe(1);
  });

  it('RATE-4: a 401 is terminal — no retry, no bisection', async () => {
    const coord = makeTestCoordinator();
    let calls = 0;
    await expect(
      coord.run(async () => {
        calls += 1;
        throw httpError(401, 'bad credentials');
      }),
    ).rejects.toBeInstanceOf(TerminalError);
    expect(calls).toBe(1);
  });

  it('RATE-5: 502/503/504 are retried and can succeed', async () => {
    const coord = makeTestCoordinator({ maxAttempts: 4 });
    let calls = 0;
    const result = await coord.run(async () => {
      calls += 1;
      if (calls < 3) throw httpError(calls === 1 ? 503 : 504, 'transient');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('RATE-6: total wait is bounded by maxTotalWaitMs', async () => {
    const coord = makeTestCoordinator({ maxAttempts: 10, baseDelayMs: 1000, maxTotalWaitMs: 100 });
    await expect(
      coord.run(async () => {
        throw httpError(503, 'transient');
      }),
    ).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
    expect(coord.telemetry.totalWaitMs).toBeLessThanOrEqual(100);
  });

  it('a secondary cooldown larger than the budget is deferred', async () => {
    const coord = makeTestCoordinator({ maxTotalWaitMs: 1000 });
    await expect(
      coord.run(async () => {
        throw httpError(403, 'secondary rate limit', { 'retry-after': '60' });
      }),
    ).rejects.toBeInstanceOf(SecondaryLimitCooldownExceededError);
  });
});
