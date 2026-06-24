import {
  type NotifierConfig,
  loadNotifierConfig,
  readGithubToken,
  readTelegramCredentials,
} from './config';
import { classifyDeliveryFailure } from './errors';
import { itemKey, notificationKey, type DiscoveryItem, type PendingNotification } from './models';
import {
  createOctokitRepositoryResolver,
  resolveDiscoveryItem,
  type RepositoryResolver,
} from './resolve-repo';
import {
  createHttpYoutubeFeedClient,
  createOctokitAwesomeStarsClient,
  runSources,
  type SourceClients,
  type SourceError,
} from './sources';
import {
  emptyState,
  hasPending,
  isItemTerminal,
  isNotificationTerminal,
  loadState,
  type NotifierState,
  NotifierStateSchema,
  pruneState,
  serializeState,
} from './state';
import { GitStateStore, type SaveResult, type StateStore } from './state-store';
import { DeterministicSummaryProvider, type SummaryProvider } from './summary';
import { createTelegramSender, renderTelegramMessage, type TelegramSender } from './telegram';
import { ExporterError, redactSecrets, TerminalError } from '@starred/github-client';

export const NOTIFIER_VERSION = '0.1.0';

const COMMIT_MESSAGE = 'chore(notifier): update discovery state';

export interface RunOptions {
  configPath?: string;
  /** Repository directory whose `origin` holds the state branch. */
  cwd?: string;
  clients?: SourceClients;
  store?: StateStore;
  resolver?: RepositoryResolver;
  summaryProvider?: SummaryProvider;
  telegramSender?: TelegramSender;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface NotifierRunError {
  source: SourceError['source'] | 'resolution' | 'summary' | 'render' | 'telegram';
  target: string;
  message: string;
}

/** A pending item still failing after the configured attempt threshold. */
export interface AttentionItem {
  item_key: string;
  attempts: number;
  last_error: string | null;
}

export interface RunOutcome {
  config: NotifierConfig;
  /** Items emitted by sources this run (new videos / newly-added repos). */
  discovered: number;
  /** New items durably appended to the pending queue this run. */
  enqueued: number;
  /** Pending queue size after this run. */
  pendingCount: number;
  /** Retryable failures this run (sources + deferred deliveries) — each keeps work pending. */
  errors: NotifierRunError[];
  /**
   * Per-repository notifications recorded `permanent_failure` THIS run. They are
   * NOT retried (they leave the queue), but they flip the exit code to 20 once so
   * a deterministic delivery defect surfaces instead of vanishing into a green run.
   */
  permanentFailures: NotifierRunError[];
  /** Pending items that have failed at least `retry.attention_after_attempts` times. */
  attention: AttentionItem[];
  save: SaveResult;
}

/**
 * Exit-code policy (parallels the exporter):
 *   - 20 — deferred/degraded: a retryable failure left work pending, a NEW
 *          permanent failure was recorded this run (one-time signal), or a
 *          content change did not land. The run is visibly incomplete.
 *   - 0  — clean: nothing pending failed and any change was pushed.
 * Run-level fatal failures (config / token / GitHub-or-Telegram credential /
 * invalid state) are thrown and carry their own exit code (10).
 */
export function runExitCode(outcome: RunOutcome): number {
  if (outcome.errors.length > 0) return 20;
  if (outcome.permanentFailures.length > 0) return 20;
  if (outcome.save.changed && !outcome.save.pushed) return 20;
  return 0;
}

function buildRealClients(config: NotifierConfig, env: NodeJS.ProcessEnv): SourceClients {
  const token = readGithubToken(env);
  return {
    youtube: createHttpYoutubeFeedClient(),
    awesomeStars: createOctokitAwesomeStarsClient(config.awesome_stars.repository, token),
  };
}

export interface PendingProcessor {
  resolver: RepositoryResolver;
  summaryProvider: SummaryProvider;
  telegramSender: TelegramSender;
}

function buildPendingProcessor(options: RunOptions, env: NodeJS.ProcessEnv): PendingProcessor {
  return {
    resolver: options.resolver ?? createOctokitRepositoryResolver(readGithubToken(env)),
    summaryProvider: options.summaryProvider ?? new DeterministicSummaryProvider(),
    telegramSender: options.telegramSender ?? createTelegramSender(readTelegramCredentials(env)),
  };
}

/**
 * Record the item-level `skipped_no_repo` terminal (no repository was involved).
 * Per-repository terminals (`sent`, `permanent_failure`) are written inline in
 * the delivery loop with their node-id-bearing key.
 */
function recordSkippedNoRepo(
  state: NotifierState,
  pending: PendingNotification,
  deliveries: NotifierState['deliveries'],
  detail: string,
  now: Date,
): void {
  const key = pending.item_key;
  if (isItemTerminal({ ...state, deliveries }, key)) return;
  deliveries.push({
    notification_key: key,
    status: 'skipped_no_repo',
    completed_at: now.toISOString(),
    detail,
  });
}

function safeErrorMessage(err: unknown, env: NodeJS.ProcessEnv): string {
  const message = err instanceof Error ? err.message : String(err);
  return redactSecrets(message, [
    env.STAR_SYNC_TOKEN,
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_CHAT_ID,
  ]);
}

function errorSource(err: unknown): 'resolution' | 'summary' | 'render' | 'telegram' {
  const stage = (err as { notifierStage?: unknown })?.notifierStage;
  return stage === 'summary' || stage === 'render' || stage === 'telegram' ? stage : 'resolution';
}

function stagedError(stage: 'resolution' | 'summary' | 'render' | 'telegram', err: unknown): Error {
  const out = err instanceof Error ? err : new Error(String(err));
  Object.defineProperty(out, 'notifierStage', { value: stage, enumerable: false });
  return out;
}

/**
 * Convert a fatal-disposition error into the run-level terminal error (exit 10).
 * An already-typed terminal error (GitHub `AuthError`, missing credentials) is
 * kept as-is; anything else (e.g. a fatal Telegram status) is wrapped with a
 * redacted message so no credential leaks into logs or persisted state.
 */
function toFatal(err: unknown, env: NodeJS.ProcessEnv): Error {
  if (err instanceof ExporterError && err.exitCode === 10) return err;
  return new TerminalError(safeErrorMessage(err, env), 'DELIVERY_FATAL');
}

export interface PendingProcessResult {
  state: NotifierState;
  errors: NotifierRunError[];
  permanentFailures: NotifierRunError[];
  attention: AttentionItem[];
}

/**
 * Processes the durable pending queue serially. Each referenced repository is
 * delivered independently and, on failure, classified (see
 * `classifyDeliveryFailure`):
 *
 *   - `sent`    — recorded immediately, so a later failure retries only the
 *                 not-yet-delivered repositories.
 *   - retryable — the item stays pending (attempts++, last_error); a transient
 *                 fault on one repository never blocks its siblings.
 *   - permanent — recorded `permanent_failure` for that repository and never
 *                 retried (a byte-identical retry fails identically); surfaced
 *                 once via the run exit code, then it leaves the queue.
 *   - fatal     — thrown out as a run-level terminal error (exit 10); nothing is
 *                 persisted this run, so a bad credential/destination is loud and
 *                 the last-known-good state is preserved.
 *
 * The single state push in `run` creates the accepted at-least-once window: a
 * process crash after Telegram accepts a message but before state persistence may
 * send that message once more next run.
 */
export async function processPendingNotifications(
  state: NotifierState,
  processor: PendingProcessor,
  config: NotifierConfig,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PendingProcessResult> {
  const pending: PendingNotification[] = [];
  const deliveries = [...state.deliveries];
  const errors: NotifierRunError[] = [];
  const permanentFailures: NotifierRunError[] = [];
  const attention: AttentionItem[] = [];
  const attentionThreshold = config.retry.attention_after_attempts;

  const keepPending = (entry: PendingNotification, message: string): void => {
    const attempts = entry.attempts + 1;
    pending.push({ ...entry, attempts, last_attempt_at: now.toISOString(), last_error: message });
    if (attempts >= attentionThreshold) {
      attention.push({ item_key: entry.item_key, attempts, last_error: message });
    }
  };

  for (const entry of state.pending) {
    // 1. Resolution is item-level: a fault keeps the whole item pending
    //    (retryable) or aborts the run (fatal, e.g. a bad GitHub PAT).
    let resolution;
    try {
      resolution = await resolveDiscoveryItem(entry.item, processor.resolver);
    } catch (err) {
      const staged = stagedError('resolution', err);
      if (classifyDeliveryFailure(staged) === 'fatal') throw toFatal(staged, env);
      const message = safeErrorMessage(staged, env);
      errors.push({ source: 'resolution', target: entry.item_key, message });
      keepPending(entry, message);
      continue;
    }

    if (resolution.repositories.length === 0) {
      const detail =
        resolution.candidateCount === 0
          ? 'No valid public GitHub repository candidate found'
          : 'No public GitHub repository resolved from candidates';
      recordSkippedNoRepo(state, entry, deliveries, detail, now);
      continue;
    }

    // 2. Deliver each referenced repository independently.
    let unfinished = false;
    let lastRetryMessage = '';
    for (const repository of resolution.repositories) {
      const key = notificationKey(entry.item.source, entry.item.source_item_id, repository.node_id);
      if (isNotificationTerminal({ ...state, deliveries }, key)) continue;

      try {
        let summary;
        try {
          summary = await processor.summaryProvider.summarize(repository);
        } catch (err) {
          throw stagedError('summary', err);
        }

        let message;
        try {
          message = renderTelegramMessage(entry.item, repository, summary, {
            disableWebPagePreview: config.telegram.disable_web_page_preview,
          });
        } catch (err) {
          throw stagedError('render', err);
        }

        try {
          await processor.telegramSender.send(message);
        } catch (err) {
          throw stagedError('telegram', err);
        }

        // Only Telegram success produces a sent record. If persistence later
        // fails, the remote still has the old pending entry: accepted at-least-once.
        deliveries.push({
          notification_key: key,
          status: 'sent',
          completed_at: now.toISOString(),
          detail: null,
        });
      } catch (err) {
        const disposition = classifyDeliveryFailure(err);
        if (disposition === 'fatal') throw toFatal(err, env);
        const message = safeErrorMessage(err, env);
        if (disposition === 'permanent') {
          // Deterministically unsendable for THIS repository: record it terminal
          // (per repo) so it never retries; surfaced once via the run exit code.
          deliveries.push({
            notification_key: key,
            status: 'permanent_failure',
            completed_at: now.toISOString(),
            detail: message,
          });
          permanentFailures.push({ source: errorSource(err), target: key, message });
          continue;
        }
        // retryable — a sibling repository may still succeed this run.
        unfinished = true;
        lastRetryMessage = message;
        errors.push({ source: errorSource(err), target: entry.item_key, message });
      }
    }

    // The item leaves the queue once every referenced repository reached a
    // terminal per-repo record (sent or permanent_failure). One retryable
    // repository keeps the whole item pending for the next run.
    if (unfinished) keepPending(entry, lastRetryMessage);
  }

  return { state: { ...state, pending, deliveries }, errors, permanentFailures, attention };
}

/**
 * Append genuinely-new discoveries to the durable pending queue. An item is
 * skipped if it is already pending or has already reached an item-level terminal
 * outcome; otherwise it is enqueued WITH its full payload so it survives the
 * source's recent window. P2.2/P2.3 then resolve and deliver items from that
 * durable queue.
 */
function enqueueDiscoveries(
  state: NotifierState,
  discoveries: readonly DiscoveryItem[],
): { state: NotifierState; enqueued: number } {
  const pending = [...state.pending];
  let enqueued = 0;
  for (const item of discoveries) {
    const key = itemKey(item.source, item.source_item_id);
    const working: NotifierState = { ...state, pending };
    if (hasPending(working, key) || isItemTerminal(state, key)) continue;
    pending.push({
      item_key: key,
      item,
      attempts: 0,
      first_seen_at: item.discovered_at,
      last_attempt_at: null,
      last_error: null,
    });
    enqueued += 1;
  }
  return { state: { ...state, pending }, enqueued };
}

/**
 * One notifier pass: load last-known-good state, poll sources (per-source
 * isolation), durably enqueue new discoveries, resolve/deliver the pending
 * queue, then validate and persist the next state as ONE change-gated commit.
 * A schema-invalid loaded state or a failed push leaves the remote's
 * last-known-good untouched.
 */
export async function run(options: RunOptions = {}): Promise<RunOutcome> {
  const env = options.env ?? process.env;
  const now = (options.now ?? (() => new Date()))();
  const cwd = options.cwd ?? process.cwd();
  const config = loadNotifierConfig(options.configPath);
  const store = options.store ?? new GitStateStore(cwd, config.state);

  const raw = await store.load();
  // loadState validates + reconciles; an invalid remote document throws
  // (deferred) so we never overwrite last-known-good with a repaired guess.
  const loaded = raw === null ? emptyState(config) : loadState(raw, config);

  const clients = options.clients ?? buildRealClients(config, env);
  const sources = await runSources(loaded, config, clients, now);

  const { state: withPending, enqueued } = enqueueDiscoveries(sources.nextState, sources.items);

  const processed: PendingProcessResult =
    withPending.pending.length === 0
      ? { state: withPending, errors: [], permanentFailures: [], attention: [] }
      : await processPendingNotifications(
          withPending,
          buildPendingProcessor(options, env),
          config,
          now,
          env,
        );

  const pruned = pruneState(processed.state, config, now);

  // Validate-before-persist: a malformed next state must never be written.
  const validated = NotifierStateSchema.parse(pruned);
  const save = await store.save(serializeState(validated), COMMIT_MESSAGE);

  return {
    config,
    discovered: sources.items.length,
    enqueued,
    pendingCount: validated.pending.length,
    errors: [...sources.errors, ...processed.errors],
    permanentFailures: processed.permanentFailures,
    attention: processed.attention,
    save,
  };
}
