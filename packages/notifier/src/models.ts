import { z } from 'zod';

/**
 * Schema version for the notifier's state document and contracts. This is
 * DELIBERATELY separate from `@starred/schema`'s `SCHEMA_VERSION` (which
 * versions the canonical stars.json): the notifier state and the stars dataset
 * evolve independently, so coupling their versions would be wrong.
 */
export const NOTIFIER_SCHEMA_VERSION = '1.0';

/**
 * Which discovery source produced an item. These literal values are part of the
 * `notification_key` / `item_key` contract and of the persisted state shape — do
 * not rename them casually (it would orphan in-flight pending items and
 * delivery history).
 */
export const SourceKindSchema = z.enum(['youtube', 'awesome_stars']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * A change observed by a source.
 *
 * Detection (a new video / a new repo in the list) is REQUIRED; description
 * enrichment is best-effort, so `description` is nullable and source ingestion
 * never depends on it. `extraction_text` is the text P2.2 scans for GitHub
 * repository URLs:
 *   - youtube: the (optional) video description — may be empty;
 *   - awesome_stars: the single added repository URL.
 *
 * An item with no extractable repository becomes a terminal `skipped_no_repo`
 * delivery — it does NOT fail the source run.
 */
export const DiscoveryItemSchema = z
  .object({
    source: SourceKindSchema,
    /** Stable id within the source. youtube: video id. awesome_stars: normalized `owner/repo`. */
    source_item_id: z.string().min(1),
    /** Human-facing title for rendering (video title / repo full name). */
    title: z.string(),
    /** Canonical source URL (watch url / repo url). */
    url: z.string().url(),
    /** Best-effort enrichment; may be absent. NEVER required for ingestion. */
    description: z.string().nullable(),
    /** ISO-8601 publish/commit time if the source provides one. */
    published_at: z.string().nullable(),
    /** Text scanned for GitHub repository candidates during resolution (P2.2). */
    extraction_text: z.string(),
    /** ISO-8601 time this notifier first observed the item. */
    discovered_at: z.string(),
  })
  .strict();
export type DiscoveryItem = z.infer<typeof DiscoveryItemSchema>;

/** A repository's "latest" release, as surfaced by GitHub. */
export const RepoReleaseSchema = z
  .object({
    tag_name: z.string().min(1),
    published_at: z.string().nullable(),
    url: z.string().url(),
  })
  .strict();
export type RepoRelease = z.infer<typeof RepoReleaseSchema>;

/**
 * A GitHub repository resolved from a discovery candidate (P2.2). Identity
 * fields are the HYDRATED current values: a renamed/transferred repo carries its
 * current `name_with_owner` and `url`, and `node_id` is the stable key used for
 * de-duplication and for the third segment of a `notification_key`.
 *
 * The metadata fields are exactly what the deterministic summary needs
 * (description, primary language, topics, stars, latest release) so P2.3 never
 * depends on an LLM being configured.
 */
export const ResolvedRepositorySchema = z
  .object({
    node_id: z.string().min(1),
    name_with_owner: z.string().min(1),
    owner: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
    description: z.string().nullable(),
    primary_language: z.string().nullable(),
    topics: z.array(z.string()),
    stargazer_count: z.number().int().nonnegative().nullable(),
    license_spdx: z.string().nullable(),
    is_archived: z.boolean().nullable(),
    is_fork: z.boolean().nullable(),
    latest_release: RepoReleaseSchema.nullable(),
  })
  .strict();
export type ResolvedRepository = z.infer<typeof ResolvedRepositorySchema>;

/**
 * Terminal delivery outcomes. These are the ONLY statuses that may end a
 * notification's lifecycle; `pending` is NOT a delivery status — a pending item
 * lives in the durable pending queue until it reaches one of these:
 *   - `sent`              — Telegram accepted a message for a specific repo;
 *   - `skipped_no_repo`   — the item contained no resolvable repository;
 *   - `permanent_failure` — a specific repository's message is deterministically
 *                           undeliverable (Telegram rejects it identically on
 *                           every retry), so it is recorded and not retried.
 *
 * A run-level credential/destination fault is NOT a delivery status: it aborts
 * the run (exit 10) and persists nothing (see `classifyDeliveryFailure`).
 */
export const DeliveryStatusSchema = z.enum(['sent', 'skipped_no_repo', 'permanent_failure']);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

/**
 * A terminal record in the delivery log. Its `notification_key` carries a
 * repository node id IFF a specific repository was involved:
 *   - `sent`              → `source:source_item_id:repo_node_id` (per repository);
 *   - `permanent_failure` → `source:source_item_id:repo_node_id` (per repository);
 *   - `skipped_no_repo`   → `source:source_item_id` (item-level, no repository).
 *
 * `sent` and `permanent_failure` records are the per-repository terminal guard: a
 * repeated run skips any `notification_key` already present with one of those
 * statuses (a `sent` repo is not re-sent; a permanently-failed repo is not retried).
 */
export const DeliveryRecordSchema = z
  .object({
    notification_key: z.string().min(1),
    status: DeliveryStatusSchema,
    completed_at: z.string(),
    /** Optional terminal detail (e.g. why it was skipped / permanently failed). */
    detail: z.string().nullable(),
  })
  .strict();
export type DeliveryRecord = z.infer<typeof DeliveryRecordSchema>;

/**
 * The durable unit of work: one observed source item awaiting a terminal
 * outcome. It carries the FULL discovery payload, so the item remains
 * processable even after it scrolls out of the source's recent window (the
 * failure mode that a bare "seen" set cannot survive). A pending entry leaves
 * the queue ONLY when every notification it implies has reached a terminal
 * delivery (every repo `sent` or `permanent_failure`, or an item-level
 * `skipped_no_repo` when there is no repository at all).
 */
export const PendingNotificationSchema = z
  .object({
    /** Item-level identity: `${source}:${source_item_id}`. */
    item_key: z.string().min(1),
    item: DiscoveryItemSchema,
    attempts: z.number().int().nonnegative(),
    first_seen_at: z.string(),
    last_attempt_at: z.string().nullable(),
    last_error: z.string().nullable(),
  })
  .strict();
export type PendingNotification = z.infer<typeof PendingNotificationSchema>;

/** Item-level key: identifies a source item across runs (`source:source_item_id`). */
export function itemKey(source: SourceKind, sourceItemId: string): string {
  return `${source}:${sourceItemId}`;
}

/**
 * Per-repository delivery key: `source:source_item_id:repo_node_id`. This is the
 * identity that the at-least-once replay guard de-duplicates on, so a single
 * video that references several repositories produces one key per repository.
 */
export function notificationKey(
  source: SourceKind,
  sourceItemId: string,
  repoNodeId: string,
): string {
  return `${source}:${sourceItemId}:${repoNodeId}`;
}
