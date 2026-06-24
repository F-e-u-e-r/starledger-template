import { TerminalError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { TelegramSendError } from '../src/errors';
import { processPendingNotifications } from '../src/run';
import { notificationKey } from '../src/models';
import {
  makeConfig,
  makeDelivery,
  makePending,
  makeResolvedRepository,
  FakeRepositoryResolver,
  FakeTelegramSender,
  makeState,
} from './helpers';

const NOW = new Date('2026-06-19T12:00:00Z');

describe('processPendingNotifications', () => {
  it('marks an item skipped_no_repo when it contains no valid GitHub candidate', async () => {
    const item = makePending({ item: makePending().item });
    item.item.extraction_text = 'No repository link here';
    const result = await processPendingNotifications(
      makeState({ pending: [item] }),
      {
        resolver: new FakeRepositoryResolver(() => []),
        summaryProvider: {
          async summarize() {
            return { title: 'unused', body: 'unused' };
          },
        },
        telegramSender: new FakeTelegramSender(),
      },
      makeConfig(),
      NOW,
    );

    expect(result.errors).toEqual([]);
    expect(result.state.pending).toEqual([]);
    expect(result.state.deliveries).toEqual([
      expect.objectContaining({
        notification_key: 'youtube:VIDEO1',
        status: 'skipped_no_repo',
      }),
    ]);
  });

  it('records only successful sends and keeps the item pending after a later send fails', async () => {
    const item = makePending({
      item: makePending().item,
    });
    item.item.extraction_text = 'https://github.com/acme/one https://github.com/acme/two';
    const repoA = makeResolvedRepository({ node_id: 'R_a', name_with_owner: 'acme/one' });
    const repoB = makeResolvedRepository({ node_id: 'R_b', name_with_owner: 'acme/two' });
    let sends = 0;
    const result = await processPendingNotifications(
      makeState({ pending: [item] }),
      {
        resolver: new FakeRepositoryResolver(() => [repoA, repoB]),
        summaryProvider: {
          async summarize(repository) {
            return { title: repository.name_with_owner, body: 'summary' };
          },
        },
        telegramSender: new FakeTelegramSender(() => {
          sends += 1;
          if (sends === 2) throw new Error('Telegram 503');
        }),
      },
      makeConfig(),
      NOW,
    );

    expect(result.errors).toEqual([
      expect.objectContaining({ source: 'telegram', target: 'youtube:VIDEO1' }),
    ]);
    expect(result.state.pending).toEqual([
      expect.objectContaining({ attempts: 1, last_error: expect.stringContaining('Telegram 503') }),
    ]);
    expect(result.state.deliveries).toEqual([
      expect.objectContaining({
        notification_key: notificationKey('youtube', 'VIDEO1', 'R_a'),
        status: 'sent',
      }),
    ]);
  });

  it('replay skips existing sent keys and removes the now-complete pending item', async () => {
    const item = makePending();
    item.item.extraction_text = 'https://github.com/acme/widget';
    const repository = makeResolvedRepository({ node_id: 'R_sent' });
    const sender = new FakeTelegramSender();
    const result = await processPendingNotifications(
      makeState({
        pending: [item],
        deliveries: [
          makeDelivery({
            notification_key: notificationKey('youtube', 'VIDEO1', 'R_sent'),
            status: 'sent',
          }),
        ],
      }),
      {
        resolver: new FakeRepositoryResolver(() => [repository]),
        summaryProvider: {
          async summarize() {
            return { title: 'unused', body: 'unused' };
          },
        },
        telegramSender: sender,
      },
      makeConfig(),
      NOW,
    );

    expect(result.errors).toEqual([]);
    expect(result.state.pending).toEqual([]);
    expect(sender.messages).toEqual([]);
  });

  it('keeps an item pending when repository resolution partially fails', async () => {
    const item = makePending();
    item.item.extraction_text = 'https://github.com/acme/one https://github.com/acme/two';
    const result = await processPendingNotifications(
      makeState({ pending: [item] }),
      {
        resolver: new FakeRepositoryResolver(() => {
          throw new Error('GitHub temporarily unavailable');
        }),
        summaryProvider: {
          async summarize() {
            return { title: 'unused', body: 'unused' };
          },
        },
        telegramSender: new FakeTelegramSender(),
      },
      makeConfig(),
      NOW,
    );

    expect(result.state.pending).toEqual([expect.objectContaining({ attempts: 1 })]);
    expect(result.state.deliveries).toEqual([]);
    expect(result.errors[0]).toEqual(expect.objectContaining({ source: 'resolution' }));
  });

  it('records a deterministic Telegram 400 as a per-repo permanent_failure and stops retrying it', async () => {
    const item = makePending();
    item.item.extraction_text = 'https://github.com/acme/widget';
    const repository = makeResolvedRepository({ node_id: 'R_poison' });
    const result = await processPendingNotifications(
      makeState({ pending: [item] }),
      {
        resolver: new FakeRepositoryResolver(() => [repository]),
        summaryProvider: {
          async summarize() {
            return { title: 'acme/widget', body: 'summary' };
          },
        },
        telegramSender: new FakeTelegramSender(() => {
          throw new TelegramSendError('HTTP 400', 400, 400, 'Bad Request: message is too long');
        }),
      },
      makeConfig(),
      NOW,
    );

    expect(result.errors).toEqual([]); // a permanent failure is not a retryable error
    expect(result.permanentFailures).toEqual([
      expect.objectContaining({ target: notificationKey('youtube', 'VIDEO1', 'R_poison') }),
    ]);
    expect(result.state.pending).toEqual([]); // the item leaves the queue
    expect(result.state.deliveries).toEqual([
      expect.objectContaining({
        notification_key: notificationKey('youtube', 'VIDEO1', 'R_poison'),
        status: 'permanent_failure',
      }),
    ]);
  });

  it('aborts processing (throws fatal) on a bad Telegram destination and records nothing', async () => {
    const item = makePending();
    item.item.extraction_text = 'https://github.com/acme/widget';
    await expect(
      processPendingNotifications(
        makeState({ pending: [item] }),
        {
          resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
          summaryProvider: {
            async summarize() {
              return { title: 'x', body: 'y' };
            },
          },
          telegramSender: new FakeTelegramSender(() => {
            throw new TelegramSendError('HTTP 403', 403, 403, 'Forbidden: bot was blocked');
          }),
        },
        makeConfig(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(TerminalError);
  });

  it('surfaces a stuck item as attention once it reaches the configured attempt threshold', async () => {
    const item = makePending({ attempts: 1 }); // this run makes it attempt #2
    item.item.extraction_text = 'https://github.com/acme/widget';
    const result = await processPendingNotifications(
      makeState({ pending: [item] }),
      {
        resolver: new FakeRepositoryResolver(() => [makeResolvedRepository()]),
        summaryProvider: {
          async summarize() {
            return { title: 'x', body: 'y' };
          },
        },
        telegramSender: new FakeTelegramSender(() => {
          throw new Error('Telegram 503'); // retryable transport-style failure
        }),
      },
      makeConfig({ retry: { attention_after_attempts: 2 } }),
      NOW,
    );

    expect(result.state.pending[0]?.attempts).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.attention).toEqual([
      expect.objectContaining({ item_key: 'youtube:VIDEO1', attempts: 2 }),
    ]);
  });

  it('delivers repos independently: A permanent + B retryable keeps the item; next run skips A, sends B', async () => {
    const item = makePending();
    item.item.extraction_text = 'https://github.com/acme/one https://github.com/acme/two';
    const repoA = makeResolvedRepository({ node_id: 'R_a', name_with_owner: 'acme/one' });
    const repoB = makeResolvedRepository({ node_id: 'R_b', name_with_owner: 'acme/two' });
    const resolver = new FakeRepositoryResolver(() => [repoA, repoB]);
    const summaryProvider = {
      async summarize(repository: typeof repoA) {
        return { title: repository.name_with_owner, body: 'summary' };
      },
    };
    const keyA = notificationKey('youtube', 'VIDEO1', 'R_a');
    const keyB = notificationKey('youtube', 'VIDEO1', 'R_b');

    // Run 1: A hits a deterministic 400 (permanent); B hits a transient 503 (retryable).
    const first = await processPendingNotifications(
      makeState({ pending: [item] }),
      {
        resolver,
        summaryProvider,
        telegramSender: new FakeTelegramSender((message) => {
          if (message.text.includes('acme/one')) {
            throw new TelegramSendError('HTTP 400', 400, 400, 'Bad Request: message is too long');
          }
          throw new Error('Telegram 503');
        }),
      },
      makeConfig(),
      NOW,
    );
    expect(first.permanentFailures.map((p) => p.target)).toEqual([keyA]);
    expect(first.errors.map((e) => e.target)).toEqual(['youtube:VIDEO1']); // B is retryable
    expect(first.state.pending).toHaveLength(1); // one retryable repo keeps the whole item
    expect(first.state.deliveries).toEqual([
      expect.objectContaining({ notification_key: keyA, status: 'permanent_failure' }),
    ]);

    // Run 2 (fed run 1's state): A is already terminal → skipped; only B is retried, now succeeding.
    const sender2 = new FakeTelegramSender();
    const second = await processPendingNotifications(
      first.state,
      { resolver, summaryProvider, telegramSender: sender2 },
      makeConfig(),
      NOW,
    );
    expect(sender2.messages).toHaveLength(1); // only B is sent — A is never attempted again
    expect(sender2.messages[0]?.text).toContain('acme/two');
    expect(second.state.pending).toEqual([]); // B delivered → the item is complete
    expect(
      second.state.deliveries.some((d) => d.notification_key === keyB && d.status === 'sent'),
    ).toBe(true);
  });
});
