import { DeferredError, TerminalError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { classifyDeliveryFailure, TelegramSendError } from '../src/errors';

const telegram = (
  status: number | null,
  code: number | null = null,
  description: string | null = null,
): TelegramSendError => new TelegramSendError(`HTTP ${status}`, status, code, description);

describe('classifyDeliveryFailure', () => {
  it('treats Telegram rate-limit and server errors as retryable', () => {
    expect(classifyDeliveryFailure(telegram(429))).toBe('retryable');
    expect(classifyDeliveryFailure(telegram(500))).toBe('retryable');
    expect(classifyDeliveryFailure(telegram(503))).toBe('retryable');
  });

  it('treats Telegram credential / destination statuses as fatal', () => {
    expect(classifyDeliveryFailure(telegram(401))).toBe('fatal');
    expect(classifyDeliveryFailure(telegram(403))).toBe('fatal');
    expect(classifyDeliveryFailure(telegram(404))).toBe('fatal');
  });

  it('escalates a 400 only on positive evidence: destination → fatal, message-fault → permanent', () => {
    expect(classifyDeliveryFailure(telegram(400, 400, 'Bad Request: chat not found'))).toBe(
      'fatal',
    );
    expect(
      classifyDeliveryFailure(telegram(400, 403, 'Forbidden: bot was blocked by the user')),
    ).toBe('fatal');
    expect(classifyDeliveryFailure(telegram(400, 400, 'Bad Request: message is too long'))).toBe(
      'permanent',
    );
    expect(classifyDeliveryFailure(telegram(400, 400, "Bad Request: can't parse entities"))).toBe(
      'permanent',
    );
    // An UNRECOGNIZED 400 (or an unreadable body) must NOT be silently dropped:
    // it stays retryable and surfaces via `attention`, never green-on-broken.
    expect(classifyDeliveryFailure(telegram(400, null, null))).toBe('retryable');
    expect(classifyDeliveryFailure(telegram(400, 400, 'Bad Request: something brand new'))).toBe(
      'retryable',
    );
  });

  it('treats a transport error (no HTTP status) and unknown errors as retryable', () => {
    expect(classifyDeliveryFailure(telegram(null))).toBe('retryable');
    expect(classifyDeliveryFailure(new Error('fetch failed'))).toBe('retryable');
  });

  it('maps shared exit-10 errors to fatal and exit-20 errors to retryable', () => {
    expect(classifyDeliveryFailure(new TerminalError('bad token', 'AUTH'))).toBe('fatal');
    expect(classifyDeliveryFailure(new DeferredError('github down', 'RESOLUTION_DEFERRED'))).toBe(
      'retryable',
    );
  });

  it('treats a deterministic render fault as permanent', () => {
    const err = new Error('Telegram message cannot be empty');
    Object.defineProperty(err, 'notifierStage', { value: 'render' });
    expect(classifyDeliveryFailure(err)).toBe('permanent');
  });
});
