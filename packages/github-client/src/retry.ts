import {
  ExporterError,
  RateLimitInsufficientError,
  RetryBudgetExhaustedError,
  RetryableResponseError,
  SecondaryLimitCooldownExceededError,
  TerminalError,
} from './errors';

export type ErrorClass = 'retryable' | 'terminal' | 'deferred';

interface HttpishError {
  status?: number;
  message?: string;
  response?: { headers?: Record<string, string | undefined> };
}

function headersOf(err: unknown): Record<string, string | undefined> {
  return (err as HttpishError)?.response?.headers ?? {};
}

/** Classify an API error into retry/terminal/deferred buckets (shared by REST + GraphQL). */
export function classifyError(err: unknown): ErrorClass {
  if (err instanceof RetryableResponseError) return 'retryable';

  const e = err as HttpishError;
  const status = e?.status;
  const message = e?.message ?? '';
  const headers = headersOf(err);

  if (status === 401) return 'terminal';
  if (status === 400 || status === 422) return 'terminal'; // invalid query / schema
  if (status === 403) {
    if (/secondary rate limit/i.test(message) || headers['retry-after'] != null) return 'retryable';
    if (headers['x-ratelimit-remaining'] === '0') return 'deferred'; // primary exhausted
    return 'terminal'; // permission failure unrelated to rate limit
  }
  if (status === 429) return 'retryable';
  if (status === 502 || status === 503 || status === 504) return 'retryable';
  if (
    /(timed?\s?out|timeout|etimedout|econnreset|econnrefused|eai_again|socket hang up|network|fetch failed)/i.test(
      message,
    )
  ) {
    return 'retryable';
  }
  if (/secondary rate limit/i.test(message)) return 'retryable';
  if (/something went wrong while executing your query/i.test(message)) return 'retryable'; // GraphQL exec timeout
  return 'terminal';
}

export function isSecondaryLimit(err: unknown): boolean {
  const e = err as HttpishError;
  return (
    /secondary rate limit/i.test(e?.message ?? '') ||
    e?.status === 429 ||
    (e?.status === 403 && headersOf(err)['retry-after'] != null)
  );
}

export function retryAfterMs(err: unknown): number | null {
  const ra = headersOf(err)['retry-after'];
  if (ra == null) return null;
  const secs = Number(ra);
  return Number.isFinite(secs) ? secs * 1000 : null;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxTotalWaitMs: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  maxTotalWaitMs: 120000,
};

export interface RetryTelemetry {
  attempts: number;
  totalWaitMs: number;
  secondaryLimitEvents: number;
  globalCooldowns: number;
}

export interface CoordinatorDeps {
  config?: Partial<RetryConfig>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

/**
 * A single coordinator shared by REST pagination, GraphQL pagination, and
 * hydrate. Centralizes bounded retry, Retry-After, jittered backoff, and a
 * GLOBAL secondary-limit cooldown (so concurrent work pauses together).
 */
export class RetryCoordinator {
  private readonly config: RetryConfig;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private cooldownUntil = 0;

  readonly telemetry: RetryTelemetry = {
    attempts: 0,
    totalWaitMs: 0,
    secondaryLimitEvents: 0,
    globalCooldowns: 0,
  };

  constructor(deps: CoordinatorDeps = {}) {
    this.config = { ...DEFAULT_RETRY, ...deps.config };
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
  }

  /** Full-jitter exponential backoff, capped at maxDelayMs. */
  private backoff(attempt: number): number {
    const exp = Math.min(this.config.maxDelayMs, this.config.baseDelayMs * 2 ** (attempt - 1));
    return Math.min(this.config.maxDelayMs, exp / 2 + (exp / 2) * this.random());
  }

  private async waitBudgeted(ms: number): Promise<void> {
    if (this.telemetry.totalWaitMs + ms > this.config.maxTotalWaitMs) {
      throw new RetryBudgetExhaustedError(
        `max total wait ${this.config.maxTotalWaitMs}ms would be exceeded`,
      );
    }
    await this.sleep(ms);
    this.telemetry.totalWaitMs += ms;
  }

  async run<T>(
    fn: () => Promise<T>,
    opts: { classify?: (e: unknown) => ErrorClass } = {},
  ): Promise<T> {
    const classify = opts.classify ?? classifyError;
    let attempt = 0;

    for (;;) {
      // honor the shared cooldown before dispatching
      const cooldown = this.cooldownUntil - this.now();
      if (cooldown > 0) {
        this.telemetry.globalCooldowns += 1;
        await this.waitBudgeted(cooldown);
      }

      this.telemetry.attempts += 1;
      try {
        return await fn();
      } catch (err) {
        const cls = classify(err);

        if (cls === 'terminal') {
          throw err instanceof ExporterError ? err : new TerminalError(messageOf(err));
        }
        if (cls === 'deferred') {
          throw err instanceof ExporterError
            ? err
            : new RateLimitInsufficientError(`primary rate limit insufficient: ${messageOf(err)}`);
        }

        // retryable
        attempt += 1;
        if (attempt >= this.config.maxAttempts) {
          throw new RetryBudgetExhaustedError(`retry budget exhausted after ${attempt} attempts`, {
            cause: err,
          });
        }

        let delay: number;
        if (isSecondaryLimit(err)) {
          this.telemetry.secondaryLimitEvents += 1;
          const cooldownMs = retryAfterMs(err) ?? this.backoff(attempt);
          if (cooldownMs > this.config.maxTotalWaitMs) {
            throw new SecondaryLimitCooldownExceededError(
              `secondary-limit cooldown ${cooldownMs}ms exceeds max ${this.config.maxTotalWaitMs}ms`,
            );
          }
          // global cooldown: all subsequent dispatches wait for this
          this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + cooldownMs);
          delay = Math.max(0, this.cooldownUntil - this.now());
        } else {
          delay = this.backoff(attempt);
        }

        await this.waitBudgeted(delay);
      }
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
