import { DeferredError } from '@starred/github-client';
import { z } from 'zod';
import type { NotifierConfig } from './config';
import {
  type DeliveryRecord,
  DeliveryRecordSchema,
  NOTIFIER_SCHEMA_VERSION,
  type PendingNotification,
  PendingNotificationSchema,
} from './models';

/** One remembered recent video. */
export const YoutubeSeenSchema = z
  .object({
    id: z.string().min(1),
    seen_at: z.string(),
  })
  .strict();
export type YoutubeSeen = z.infer<typeof YoutubeSeenSchema>;

/**
 * Per-channel YouTube source state. `initialized` is explicit (fix #3): cold
 * start is NEVER inferred from an empty `recent_seen`, so pruning the window to
 * empty can never be mistaken for "first run". `etag`/`last_modified` drive
 * conditional requests.
 */
export const YoutubeChannelStateSchema = z
  .object({
    initialized: z.boolean(),
    etag: z.string().nullable(),
    last_modified: z.string().nullable(),
    recent_seen: z.array(YoutubeSeenSchema),
  })
  .strict();
export type YoutubeChannelState = z.infer<typeof YoutubeChannelStateSchema>;

/**
 * awesome-stars source state. The watched source (`repository`/`ref`/`paths`) is
 * recorded so a config change to it can be detected and re-baselined rather than
 * flooding. `last_commit_sha` is the only change-detection cursor (the URL set
 * is diffed at runtime from file content, never persisted).
 */
export const AwesomeStarsStateSchema = z
  .object({
    initialized: z.boolean(),
    repository: z.string().min(1),
    ref: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
    last_commit_sha: z.string().nullable(),
  })
  .strict();
export type AwesomeStarsState = z.infer<typeof AwesomeStarsStateSchema>;

export const NotifierStateSchema = z
  .object({
    schema_version: z.literal(NOTIFIER_SCHEMA_VERSION),
    youtube: z.record(z.string(), YoutubeChannelStateSchema),
    awesome_stars: AwesomeStarsStateSchema,
    pending: z.array(PendingNotificationSchema),
    deliveries: z.array(DeliveryRecordSchema),
  })
  .strict();
export type NotifierState = z.infer<typeof NotifierStateSchema>;

/** A pristine, uninitialized state derived from config (cold start for every source). */
export function emptyState(config: NotifierConfig): NotifierState {
  const youtube: Record<string, YoutubeChannelState> = {};
  for (const channel of config.youtube.channels) {
    youtube[channel] = { initialized: false, etag: null, last_modified: null, recent_seen: [] };
  }
  return {
    schema_version: NOTIFIER_SCHEMA_VERSION,
    youtube,
    awesome_stars: {
      initialized: false,
      repository: config.awesome_stars.repository,
      ref: config.awesome_stars.ref,
      paths: [...config.awesome_stars.paths],
      last_commit_sha: null,
    },
    pending: [],
    deliveries: [],
  };
}

function sameAwesomeSource(state: AwesomeStarsState, config: NotifierConfig): boolean {
  const a = config.awesome_stars;
  return (
    state.repository === a.repository &&
    state.ref === a.ref &&
    state.paths.length === a.paths.length &&
    state.paths.every((p, i) => p === a.paths[i])
  );
}

/**
 * Fold the current config into a loaded state WITHOUT discarding durable work:
 *   - a newly-configured YouTube channel is added as uninitialized (cold start);
 *   - channels dropped from config are retained (they may still hold pending
 *     work and delivery history; they simply stop being polled);
 *   - if the awesome-stars source (repository/ref/paths) changed, its baseline
 *     is RESET (initialized=false) so the new source is re-baselined instead of
 *     emitting a historical flood. Pending/deliveries are preserved.
 */
export function reconcileWithConfig(state: NotifierState, config: NotifierConfig): NotifierState {
  const youtube: Record<string, YoutubeChannelState> = { ...state.youtube };
  for (const channel of config.youtube.channels) {
    if (!youtube[channel]) {
      youtube[channel] = { initialized: false, etag: null, last_modified: null, recent_seen: [] };
    }
  }

  const awesome_stars: AwesomeStarsState = sameAwesomeSource(state.awesome_stars, config)
    ? state.awesome_stars
    : {
        initialized: false,
        repository: config.awesome_stars.repository,
        ref: config.awesome_stars.ref,
        paths: [...config.awesome_stars.paths],
        last_commit_sha: null,
      };

  return { ...state, youtube, awesome_stars };
}

/**
 * Parse + validate persisted state. A schema-invalid document throws (deferred):
 * the caller keeps the last-known-good remote rather than overwriting it with a
 * repaired guess. On success the current config is reconciled in.
 */
export function loadState(json: string, config: NotifierConfig): NotifierState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new DeferredError(
      `notifier state is not valid JSON: ${(err as Error).message}`,
      'STATE_INVALID',
    );
  }
  const result = NotifierStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new DeferredError('notifier state failed schema validation', 'STATE_INVALID');
  }
  return reconcileWithConfig(result.data, config);
}

// --- pure queries used by the run loop (kept here so they are unit-testable) ---

/** Is this source item already sitting in the durable pending queue? */
export function hasPending(state: NotifierState, item_key: string): boolean {
  return state.pending.some((p) => p.item_key === item_key);
}

/** Has this item already reached an item-level terminal outcome (skipped/permanent)? */
export function isItemTerminal(state: NotifierState, item_key: string): boolean {
  return state.deliveries.some(
    (d) =>
      d.notification_key === item_key &&
      (d.status === 'skipped_no_repo' || d.status === 'permanent_failure'),
  );
}

/** Has this exact per-repository notification already been sent (replay guard)? */
export function isNotificationSent(state: NotifierState, notification_key: string): boolean {
  return state.deliveries.some(
    (d) => d.notification_key === notification_key && d.status === 'sent',
  );
}

/**
 * Has this exact per-repository notification reached ANY terminal outcome — sent
 * OR permanently failed? This is the per-repo skip guard in the delivery loop: a
 * deterministically unsendable repository must not be retried forever, so once it
 * is recorded `permanent_failure` it is skipped just like a `sent` one.
 */
export function isNotificationTerminal(state: NotifierState, notification_key: string): boolean {
  return state.deliveries.some(
    (d) =>
      d.notification_key === notification_key &&
      (d.status === 'sent' || d.status === 'permanent_failure'),
  );
}

/**
 * Retention. recent_seen is capped per channel; the delivery log is pruned by
 * age THEN by count; pending is never touched (a failed item must survive any
 * pruning until it terminates — fix #2).
 */
export function pruneState(state: NotifierState, config: NotifierConfig, now: Date): NotifierState {
  const limit = config.youtube.recent_seen_limit;
  const youtube: Record<string, YoutubeChannelState> = {};
  for (const [id, channel] of Object.entries(state.youtube)) {
    youtube[id] = { ...channel, recent_seen: sortSeen(channel.recent_seen).slice(0, limit) };
  }

  const cutoff = now.getTime() - config.retention.delivery_days * 24 * 60 * 60 * 1000;
  let deliveries = state.deliveries.filter((d) => {
    const t = Date.parse(d.completed_at);
    return Number.isNaN(t) || t >= cutoff; // keep unparseable defensively
  });
  deliveries = sortDeliveries(deliveries);
  if (deliveries.length > config.retention.delivery_max) {
    deliveries = deliveries.slice(deliveries.length - config.retention.delivery_max);
  }

  return { ...state, youtube, deliveries };
}

// --- deterministic serialization (mirrors the exporter's canonical-bytes style) ---

function sortSeen(seen: readonly YoutubeSeen[]): YoutubeSeen[] {
  return [...seen].sort((a, b) => {
    if (a.seen_at !== b.seen_at) return a.seen_at < b.seen_at ? 1 : -1; // newest first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function sortDeliveries(deliveries: readonly DeliveryRecord[]): DeliveryRecord[] {
  return [...deliveries].sort((a, b) => {
    if (a.completed_at !== b.completed_at) return a.completed_at < b.completed_at ? -1 : 1;
    return a.notification_key < b.notification_key
      ? -1
      : a.notification_key > b.notification_key
        ? 1
        : 0;
  });
}

function sortPending(pending: readonly PendingNotification[]): PendingNotification[] {
  return [...pending].sort((a, b) => {
    if (a.first_seen_at !== b.first_seen_at) return a.first_seen_at < b.first_seen_at ? -1 : 1;
    return a.item_key < b.item_key ? -1 : a.item_key > b.item_key ? 1 : 0;
  });
}

function canonicalChannel(channel: YoutubeChannelState): Record<string, unknown> {
  return {
    initialized: channel.initialized,
    etag: channel.etag,
    last_modified: channel.last_modified,
    recent_seen: sortSeen(channel.recent_seen).map((s) => ({ id: s.id, seen_at: s.seen_at })),
  };
}

function canonicalItem(item: PendingNotification['item']): Record<string, unknown> {
  return {
    source: item.source,
    source_item_id: item.source_item_id,
    title: item.title,
    url: item.url,
    description: item.description,
    published_at: item.published_at,
    extraction_text: item.extraction_text,
    discovered_at: item.discovered_at,
  };
}

/**
 * Canonical bytes: fixed key order, sorted dynamic collections, 2-space indent,
 * single trailing newline. Independent of in-memory insertion order so an
 * unchanged state serializes byte-identically (the commit-on-change guard).
 */
export function serializeState(state: NotifierState): string {
  const channelIds = Object.keys(state.youtube).sort();
  const youtube: Record<string, unknown> = {};
  for (const id of channelIds) {
    const channel = state.youtube[id];
    if (channel) youtube[id] = canonicalChannel(channel);
  }

  const canonical = {
    schema_version: state.schema_version,
    youtube,
    awesome_stars: {
      initialized: state.awesome_stars.initialized,
      repository: state.awesome_stars.repository,
      ref: state.awesome_stars.ref,
      paths: [...state.awesome_stars.paths],
      last_commit_sha: state.awesome_stars.last_commit_sha,
    },
    pending: sortPending(state.pending).map((p) => ({
      item_key: p.item_key,
      item: canonicalItem(p.item),
      attempts: p.attempts,
      first_seen_at: p.first_seen_at,
      last_attempt_at: p.last_attempt_at,
      last_error: p.last_error,
    })),
    deliveries: sortDeliveries(state.deliveries).map((d) => ({
      notification_key: d.notification_key,
      status: d.status,
      completed_at: d.completed_at,
      detail: d.detail,
    })),
  };

  return JSON.stringify(canonical, null, 2) + '\n';
}
