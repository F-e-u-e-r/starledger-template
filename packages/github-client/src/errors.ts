/**
 * Error hierarchy. Each error carries the process exit code the CLI should use:
 *   - TerminalError  → 10 (fatal: auth / schema / config / malformed)
 *   - DeferredError  → 20 (recoverable but do NOT publish this run; keep last-known-good)
 */
export class ExporterError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A successful HTTP response without the GraphQL data envelope is transient
 * infrastructure failure, not a valid API result. The retry coordinator turns
 * a persistent instance into its normal deferred exhaustion error.
 */
export class RetryableResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class TerminalError extends ExporterError {
  constructor(message: string, code = 'TERMINAL') {
    super(message, 10, code);
  }
}

export class DeferredError extends ExporterError {
  constructor(message: string, code = 'DEFERRED') {
    super(message, 20, code);
  }
}

// --- terminal (exit 10) ---
export class AuthError extends TerminalError {
  constructor(message: string) {
    super(message, 'AUTH');
  }
}
export class MalformedResponseError extends TerminalError {
  constructor(message: string) {
    super(message, 'MALFORMED_RESPONSE');
  }
}

// --- deferred (exit 20) ---
/** Base for "the enumeration is incomplete" → never publish. */
export class EnumerationError extends DeferredError {
  constructor(message: string, code = 'ENUMERATION_ERROR') {
    super(message, code);
  }
}
export class IncompleteEnumerationError extends EnumerationError {
  constructor(message: string) {
    super(message, 'INCOMPLETE_ENUMERATION');
  }
}
export class PageFetchError extends EnumerationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'PAGE_FETCH_FAILED');
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
export class RetryBudgetExhaustedError extends DeferredError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'RETRY_BUDGET_EXHAUSTED');
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
export class RateLimitInsufficientError extends DeferredError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT_INSUFFICIENT');
  }
}
export class SecondaryLimitCooldownExceededError extends DeferredError {
  constructor(message: string) {
    super(message, 'SECONDARY_LIMIT_COOLDOWN_EXCEEDED');
  }
}
export class DuplicateConflictError extends EnumerationError {
  constructor(message: string) {
    super(message, 'DUPLICATE_CONFLICT');
  }
}
export class ValidationFailedError extends DeferredError {
  constructor(message: string) {
    super(message, 'VALIDATION_FAILED');
  }
}
export class PushFailedError extends DeferredError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'PUSH_FAILED');
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
