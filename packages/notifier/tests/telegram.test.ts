import { describe, expect, it } from 'vitest';
import { redactSecrets } from '@starred/github-client';
import { TelegramSendError } from '../src/errors';
import { makeDiscoveryItem, makeResolvedRepository } from './helpers';
import {
  createTelegramSender,
  escapeTelegramHtml,
  renderTelegramMessage,
  TELEGRAM_TEXT_LIMIT,
} from '../src/telegram';

describe('Telegram HTML rendering', () => {
  it('escapes every external text field before rendering HTML', () => {
    const message = renderTelegramMessage(
      makeDiscoveryItem({
        title: 'Video <title> & details',
        url: 'https://example.test/source?a=1&b=2',
      }),
      makeResolvedRepository({
        url: 'https://github.com/acme/widget?x=1&y=2',
      }),
      { title: 'acme/<widget> & co', body: 'Use <this> & keep it safe.' },
    );

    expect(escapeTelegramHtml('<&>')).toBe('&lt;&amp;&gt;');
    expect(message.text).toContain('<b>acme/&lt;widget&gt; &amp; co</b>');
    expect(message.text).toContain('Use &lt;this&gt; &amp; keep it safe.');
    expect(message.text).toContain('Video &lt;title&gt; &amp; details');
    expect(message.text).toContain('https://github.com/acme/widget?x=1&amp;y=2');
    expect(message.text).not.toContain('Use <this>');
  });

  it('budgets fields before rendering and never breaks HTML or entities', () => {
    const message = renderTelegramMessage(
      makeDiscoveryItem({ title: '<source> & '.repeat(200) }),
      makeResolvedRepository(),
      {
        title: '<title> & '.repeat(300),
        body: 'A<&>'.repeat(2_000),
      },
      { maxLength: 300 },
    );

    expect(message.text.length).toBeLessThanOrEqual(300);
    expect(message.text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(message.text).toMatch(/^<b>.*<\/b>/s);
    expect(message.text).not.toMatch(/&(?:[^a-z#]|$)/);
    expect(message.text).not.toMatch(/&(amp|lt|gt|quot)(?!;)/);
  });
});

describe('createTelegramSender', () => {
  it('only resolves after Telegram returns an accepted response', async () => {
    const requests: RequestInit[] = [];
    const sender = createTelegramSender(
      { botToken: '123456789:abcdefghijklmnopqrstuvwx', chatId: '-1001234567' },
      async (_url, init) => {
        requests.push(init ?? {});
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    );

    await expect(sender.send({ text: '<b>Hi</b>', disable_web_page_preview: true })).resolves.toBe(
      undefined,
    );
    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      chat_id: '-1001234567',
      text: '<b>Hi</b>',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  });

  it('rejects a non-success response without including credentials in the error', async () => {
    const token = '123456789:abcdefghijklmnopqrstuvwx';
    const chatId = '-1001234567';
    const sender = createTelegramSender(
      { botToken: token, chatId },
      async () => new Response('forbidden', { status: 403 }),
    );

    await expect(sender.send({ text: 'hello', disable_web_page_preview: true })).rejects.toThrow(
      'HTTP 403',
    );
  });

  it('throws a TelegramSendError carrying the HTTP status and description for classification', async () => {
    const sender = createTelegramSender(
      { botToken: '123456789:abcdefghijklmnopqrstuvwx', chatId: '-1001234567' },
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: 'Bad Request: chat not found',
          }),
          { status: 400 },
        ),
    );
    const error = await sender
      .send({ text: 'hello', disable_web_page_preview: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramSendError);
    expect((error as TelegramSendError).httpStatus).toBe(400);
    expect((error as TelegramSendError).description).toBe('Bad Request: chat not found');
  });

  it('redacts configured tokens, chat IDs, and authorization headers before logging', () => {
    const githubToken = 'github_pat_abcdefghijklmnopqrstuvwxyz_123456';
    const telegramToken = '123456789:abcdefghijklmnopqrstuvwx';
    const chatId = '-1001234567';
    const raw = [
      `Authorization: Bearer ${githubToken}`,
      `telegram=${telegramToken}`,
      `chat=${chatId}`,
    ].join('\n');
    const redacted = redactSecrets(raw, [githubToken, telegramToken, chatId]);

    expect(redacted).not.toContain(githubToken);
    expect(redacted).not.toContain(telegramToken);
    expect(redacted).not.toContain(chatId);
    expect(redacted).toContain('Authorization: ***');
    expect(redactSecrets('chat=123', ['123'])).toBe('chat=***');
  });
});
