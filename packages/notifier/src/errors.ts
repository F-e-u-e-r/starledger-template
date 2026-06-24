import { ExporterError } from '@starred/github-client';

/**
 * A Telegram `sendMessage` failure carrying the structured signal the delivery
 * taxonomy classifies on. The HTTP status drives most decisions; `description`
 * is Telegram's own (credential-free) error string, used only to split an
 * ambiguous `400` into a per-message fault vs a misconfigured destination. The
 * raw remote body is never retained.
 */
export class TelegramSendError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly telegramErrorCode: number | null = null,
    readonly description: string | null = null,
  ) {
    super(message);
    this.name = 'TelegramSendError';
  }
}

/**
 * Disposition of a pending-item delivery failure (the P2.5 taxonomy):
 *
 *   - `retryable` — transient; keep the item pending and retry next run (exit 20).
 *   - `permanent` — a deterministic per-notification fault; record a
 *                   `permanent_failure` delivery and stop retrying *that*
 *                   notification (a byte-identical retry would fail identically).
 *   - `fatal`     — a run-level credential/destination fault; abort the run
 *                   (exit 10) and persist nothing, so the misconfiguration is
 *                   loud and the last-known-good state is preserved.
 *
 * The default is `retryable`: we escalate to `permanent`/`fatal` only on positive
 * evidence, so an unrecognized error never silently drops a notification.
 */
export type DeliveryDisposition = 'retryable' | 'permanent' | 'fatal';

/**
 * Telegram 4xx descriptions that mean the destination/credentials are wrong for
 * EVERY message (run-level), not that this one message was malformed. Telegram
 * returns `400` for several of these, so the description is the only signal that
 * separates "fix the chat id / bot" from "this message is unsendable".
 */
const TELEGRAM_DESTINATION_PATTERNS: readonly RegExp[] = [
  /chat not found/i,
  /chat_id is empty/i,
  /bot was blocked/i,
  /bot can't initiate/i,
  /user is deactivated/i,
  /group chat was upgraded/i,
  /need administrator rights/i,
  /not enough rights/i,
  /have no rights/i,
  /bot is not a member/i,
  /CHAT_WRITE_FORBIDDEN/i,
  /PEER_ID_INVALID/i,
];

function isDestinationFault(description: string | null): boolean {
  if (!description) return false;
  return TELEGRAM_DESTINATION_PATTERNS.some((pattern) => pattern.test(description));
}

/**
 * Telegram 4xx descriptions for a per-MESSAGE fault: this specific message is
 * unsendable and a byte-identical retry fails identically. These are the ONLY
 * 400s treated as permanent — an unrecognized 400 stays retryable (see
 * `classifyTelegram`).
 */
const TELEGRAM_MESSAGE_FAULT_PATTERNS: readonly RegExp[] = [
  /message is too long/i,
  /message text is empty/i,
  /can't parse entities/i,
  /can't parse message text/i,
  /can't find end of the entity/i,
  /unsupported start tag/i,
  /unclosed start tag/i,
  /wrong (?:http url|url host|character)/i,
  /MESSAGE_TOO_LONG/i,
  /ENTITY_BOUNDS_INVALID/i,
];

function isMessageFault(description: string | null): boolean {
  if (!description) return false;
  return TELEGRAM_MESSAGE_FAULT_PATTERNS.some((pattern) => pattern.test(description));
}

function classifyTelegram(err: TelegramSendError): DeliveryDisposition {
  const status = err.httpStatus;
  if (status === null) return 'retryable'; // transport error — no HTTP response
  if (status === 429 || status >= 500) return 'retryable'; // rate limit / server
  if (status === 401 || status === 403 || status === 404) return 'fatal'; // token / destination
  if (status === 400) {
    // Only POSITIVE evidence escalates a 400: a known destination wording is
    // fatal (fix the chat/bot), a known message-fault wording is permanent (this
    // message is unsendable). An UNRECOGNIZED 400 — including an unreadable body
    // (null description) — stays retryable: silently dropping a notification, and
    // eventually going green on a broken destination, is the exact failure mode
    // this taxonomy exists to prevent. A genuinely stuck item surfaces loudly via
    // `attention` instead of vanishing.
    if (isDestinationFault(err.description)) return 'fatal';
    if (isMessageFault(err.description)) return 'permanent';
    return 'retryable';
  }
  return 'retryable'; // any other status: stay conservative, never auto-drop
}

/**
 * Classify a pending-item delivery failure into its {@link DeliveryDisposition}.
 */
export function classifyDeliveryFailure(err: unknown): DeliveryDisposition {
  // An already-typed terminal error (missing/invalid credentials, GitHub auth)
  // is a run-level fatal regardless of which stage surfaced it.
  if (err instanceof ExporterError && err.exitCode === 10) return 'fatal';
  if (err instanceof TelegramSendError) return classifyTelegram(err);
  // Deterministic message rendering cannot be repaired by retrying.
  const stage = (err as { notifierStage?: unknown } | null)?.notifierStage;
  if (stage === 'render') return 'permanent';
  return 'retryable';
}
