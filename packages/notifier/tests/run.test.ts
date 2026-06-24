import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeferredError, TerminalError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { TelegramSendError } from '../src/errors';
import { run, runExitCode } from '../src/run';
import { emptyState, loadState, type NotifierState, serializeState } from '../src/state';
import type { StateStore } from '../src/state-store';
import {
  FakeAwesomeStarsClient,
  FakeRepositoryResolver,
  FakeTelegramSender,
  FakeYoutubeFeedClient,
  makeConfig,
  makeResolvedRepository,
  makeState,
  MemoryStateStore,
  youtubeEntry,
  youtubeFeed,
} from './helpers';

const NOW = new Date('2026-06-19T12:00:00Z');
const now = (): Date => NOW;

/** An initialized state whose awesome-stars cursor is `sha_old`, ready to diff. */
function initializedBytes(): string {
  const state: NotifierState = makeState();
  state.awesome_stars = {
    initialized: true,
    repository: 'maguowei/awesome-stars',
    ref: 'master',
    paths: ['README.md'],
    last_commit_sha: 'sha_old',
  };
  return serializeState(state);
}

/** awesome-stars client that surfaces one freshly-added repo between sha_old → sha_new. */
function addsOneRepoClient(): FakeAwesomeStarsClient {
  return new FakeAwesomeStarsClient(
    { 'README.md': { sha: 'sha_new', committedAt: '2026-06-19T00:00:00Z' } },
    {
      'sha_old:README.md': 'https://github.com/acme/widget',
      'sha_new:README.md': 'https://github.com/acme/widget https://github.com/freshorg/proj',
    },
  );
}

const emptyYoutube = new FakeYoutubeFeedClient({});

describe('run — discovery → durable enqueue → persist', () => {
  it('keeps a new discovery durable when downstream Telegram delivery fails', async () => {
    const store = new MemoryStateStore(initializedBytes());
    const outcome = await run({
      clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() },
      resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
      telegramSender: new FakeTelegramSender(() => {
        throw new Error('Telegram unavailable');
      }),
      store,
      now,
    });

    expect(outcome.discovered).toBe(1);
    expect(outcome.enqueued).toBe(1);
    expect(outcome.pendingCount).toBe(1);
    expect(outcome.save).toMatchObject({ changed: true, pushed: true });
    expect(runExitCode(outcome)).toBe(20);

    const persisted = loadState(store.saved!, makeConfig());
    expect(persisted.pending[0]?.item_key).toBe('awesome_stars:freshorg/proj');
    // the full payload is carried so resolution can run even after the window moves
    expect(persisted.pending[0]?.item.extraction_text).toBe('https://github.com/freshorg/proj');
    expect(persisted.awesome_stars.last_commit_sha).toBe('sha_new');
  });

  it('is idempotent after successful delivery: a second run writes nothing', async () => {
    const store = new MemoryStateStore(initializedBytes());
    const client = addsOneRepoClient();
    const resolver = new FakeRepositoryResolver(() => [makeResolvedRepository()]);
    const telegramSender = new FakeTelegramSender();
    await run({
      clients: { youtube: emptyYoutube, awesomeStars: client },
      resolver,
      telegramSender,
      store,
      now,
    });
    const second = await run({
      clients: { youtube: emptyYoutube, awesomeStars: client },
      resolver,
      telegramSender,
      store,
      now,
    });

    expect(second.enqueued).toBe(0);
    expect(second.pendingCount).toBe(0);
    expect(second.save.changed).toBe(false); // unchanged ⇒ no commit
    expect(telegramSender.messages).toHaveLength(1);
  });

  it('a retryable source failure defers (exit 20) but still persists successful advances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notifier-cfg-'));
    const cfg = join(dir, 'notifier.yaml');
    writeFileSync(cfg, 'youtube:\n  channels:\n    - UC_x\n');
    const config = makeConfig({ youtube: { channels: ['UC_x'] } });
    const state = emptyState(config);
    state.youtube['UC_x'] = {
      initialized: true,
      etag: 'E-old',
      last_modified: null,
      recent_seen: [{ id: 'v1', seen_at: '2026-06-18T00:00:00Z' }],
    };
    state.awesome_stars.initialized = true;
    state.awesome_stars.last_commit_sha = 'sha_old';
    const store = new MemoryStateStore(serializeState(state));
    const youtube = new FakeYoutubeFeedClient({
      UC_x: {
        status: 200,
        body: youtubeFeed([youtubeEntry({ id: 'v2', description: 'https://github.com/acme/new' })]),
        etag: 'E-new',
        lastModified: null,
      },
    });
    const outcome = await run({
      clients: {
        youtube,
        awesomeStars: new FakeAwesomeStarsClient({}, {}, { throwOnLatest: true }),
      },
      resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
      telegramSender: new FakeTelegramSender(() => {
        throw new Error('Telegram unavailable');
      }),
      configPath: cfg,
      store,
      now,
    });
    expect(outcome.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'awesome_stars' }),
        expect.objectContaining({ source: 'telegram', target: 'youtube:v2' }),
      ]),
    );
    expect(outcome.discovered).toBe(1);
    expect(outcome.enqueued).toBe(1);
    expect(outcome.pendingCount).toBe(1);
    expect(runExitCode(outcome)).toBe(20);

    const persisted = loadState(store.saved!, config);
    expect(persisted.pending[0]?.item_key).toBe('youtube:v2');
    expect(persisted.youtube['UC_x']?.etag).toBe('E-new');
    expect(persisted.awesome_stars.last_commit_sha).toBe('sha_old');
  });

  it('a schema-invalid remote state defers and never overwrites it', async () => {
    const store = new MemoryStateStore(JSON.stringify({ schema_version: '1.0' }));
    await expect(
      run({ clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() }, store, now }),
    ).rejects.toBeInstanceOf(DeferredError);
    expect(store.saveCalls).toHaveLength(0); // last-known-good untouched
  });

  it('a failed push reports exit 20 and leaves the remote unchanged', async () => {
    const before = initializedBytes();
    const store = new MemoryStateStore(before, { pushed: false });
    const outcome = await run({
      clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() },
      resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
      telegramSender: new FakeTelegramSender(),
      store,
      now,
    });
    expect(outcome.save).toMatchObject({ changed: true, pushed: false });
    expect(runExitCode(outcome)).toBe(20);
    expect(store.saved).toBe(before); // remote last-known-good preserved
  });

  it('documents the accepted at-least-once window after send success and state-push crash', async () => {
    const before = initializedBytes();
    const crashingStore: StateStore = {
      async load() {
        return before;
      },
      async save() {
        throw new Error('simulated process crash before state push');
      },
    };
    const resolver = new FakeRepositoryResolver(() => [makeResolvedRepository()]);
    const telegramSender = new FakeTelegramSender();

    await expect(
      run({
        clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() },
        resolver,
        telegramSender,
        store: crashingStore,
        now,
      }),
    ).rejects.toThrow('simulated process crash');
    expect(telegramSender.messages).toHaveLength(1);

    // The durable state is still `before`, so the already accepted message is
    // observed and sent once more on recovery. This is deliberate at-least-once.
    const recoveredStore = new MemoryStateStore(before);
    await run({
      clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() },
      resolver,
      telegramSender,
      store: recoveredStore,
      now,
    });
    expect(telegramSender.messages).toHaveLength(2);
  });

  it('cold start baselines a YouTube channel without notifying', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notifier-cfg-'));
    const cfg = join(dir, 'notifier.yaml');
    writeFileSync(cfg, 'youtube:\n  channels:\n    - UC_x\n');
    const store = new MemoryStateStore(null); // cold
    const youtube = new FakeYoutubeFeedClient({
      UC_x: {
        status: 200,
        body: youtubeFeed([youtubeEntry({ id: 'v1' }), youtubeEntry({ id: 'v2' })]),
        etag: 'E1',
        lastModified: null,
      },
    });
    const outcome = await run({
      configPath: cfg,
      clients: { youtube, awesomeStars: new FakeAwesomeStarsClient({}, {}) },
      store,
      now,
    });
    expect(outcome.discovered).toBe(0);
    expect(outcome.enqueued).toBe(0);

    const persisted = loadState(store.saved!, makeConfig({ youtube: { channels: ['UC_x'] } }));
    expect(persisted.youtube['UC_x']?.initialized).toBe(true);
    expect(persisted.youtube['UC_x']?.recent_seen.map((s) => s.id).sort()).toEqual(['v1', 'v2']);
  });

  it('aborts as fatal (exit 10) on an invalid Telegram destination and persists nothing', async () => {
    const before = initializedBytes();
    const store = new MemoryStateStore(before);
    await expect(
      run({
        clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() },
        resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
        telegramSender: new FakeTelegramSender(() => {
          throw new TelegramSendError(
            'Telegram sendMessage returned HTTP 403',
            403,
            403,
            'Forbidden: bot was blocked by the user',
          );
        }),
        store,
        now,
      }),
    ).rejects.toBeInstanceOf(TerminalError);
    expect(store.saveCalls).toHaveLength(0); // validate-before-mutate: no write on a fatal run
    expect(store.saved).toBe(before); // remote last-known-good preserved
  });

  it('records a deterministic Telegram rejection as permanent_failure: exit 20 once, then gone', async () => {
    const store = new MemoryStateStore(initializedBytes());
    const poisonTelegram = new FakeTelegramSender(() => {
      throw new TelegramSendError(
        'Telegram sendMessage returned HTTP 400',
        400,
        400,
        'Bad Request: message is too long',
      );
    });
    const first = await run({
      clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() },
      resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
      telegramSender: poisonTelegram,
      store,
      now,
    });
    expect(first.permanentFailures).toHaveLength(1);
    expect(first.pendingCount).toBe(0); // not retried — it left the queue
    expect(runExitCode(first)).toBe(20); // surfaced exactly once

    const persisted = loadState(store.saved!, makeConfig());
    expect(persisted.pending).toEqual([]);
    expect(persisted.deliveries.some((d) => d.status === 'permanent_failure')).toBe(true);
    expect(persisted.awesome_stars.last_commit_sha).toBe('sha_new'); // cursor still advanced

    // Second run: the cursor already advanced and the item is gone — a clean no-op.
    const second = await run({
      clients: { youtube: emptyYoutube, awesomeStars: addsOneRepoClient() },
      resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
      telegramSender: poisonTelegram,
      store,
      now,
    });
    expect(second.permanentFailures).toHaveLength(0);
    expect(second.enqueued).toBe(0);
    expect(runExitCode(second)).toBe(0);
  });
});
