import { existsSync, readFileSync } from 'node:fs';
import { TerminalError } from '@starred/github-client';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Versioned notifier configuration. Secrets are NEVER configured here — the
 * GitHub PAT and the Telegram bot token/chat id are read from the environment
 * (see the env readers below).
 */
export const NotifierConfigSchema = z
  .object({
    youtube: z
      .object({
        /** Channel ids to poll (the `channel_id` in the Atom feed URL). */
        channels: z.array(z.string().min(1)).default([]),
        /** Per-channel cap on the retained "recently seen video" window (fix #2/#3). */
        recent_seen_limit: z.number().int().min(50).max(500).default(100),
      })
      .strict()
      .default({}),

    awesome_stars: z
      .object({
        repository: z.string().min(1).default('maguowei/awesome-stars'),
        // maguowei/awesome-stars defaults to `master`, not `main`. Configurable.
        ref: z.string().min(1).default('master'),
        // P2 watches README.md only, but the contract allows adding paths later.
        paths: z.array(z.string().min(1)).min(1).default(['README.md']),
      })
      .strict()
      .default({}),

    telegram: z
      .object({
        /** Telegram caps text at 4096 chars AFTER entity parsing (enforced in P2.3). */
        disable_web_page_preview: z.boolean().default(true),
      })
      .strict()
      .default({}),

    state: z
      .object({
        // Dedicated branch so notifier state never touches main / stars.json.
        branch: z.string().min(1).default('starledger-state'),
        file: z.string().min(1).default('notifier-state.json'),
        remote: z.string().min(1).default('origin'),
      })
      .strict()
      .default({}),

    retention: z
      .object({
        // Delivery log is pruned by age OR count; pending is NEVER pruned.
        delivery_days: z.number().int().min(1).default(90),
        delivery_max: z.number().int().min(1).default(2000),
      })
      .strict()
      .default({}),

    summary: z
      .object({
        // RESERVED. LLM summarization is a P3 concern; P2 always uses the
        // deterministic summary. Setting this true is REJECTED (see the
        // superRefine below) rather than silently ignored, so the config never
        // promises behavior that does not exist.
        use_llm: z.boolean().default(false),
      })
      .strict()
      .default({}),

    retry: z
      .object({
        // A pending item still failing after this many attempts is surfaced as
        // `attention` telemetry. It STAYS pending and is never auto-discarded —
        // the threshold only makes a stuck item visible to an operator.
        attention_after_attempts: z.number().int().min(1).default(6),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.summary.use_llm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'use_llm'],
        message:
          'summary.use_llm is reserved for a future milestone; LLM summarization is not available in P2. Remove it or set it to false.',
      });
    }
  });

export type NotifierConfig = z.infer<typeof NotifierConfigSchema>;

export function loadNotifierConfig(path?: string): NotifierConfig {
  if (path !== undefined && existsSync(path)) {
    const raw: unknown = parseYaml(readFileSync(path, 'utf8')) ?? {};
    return NotifierConfigSchema.parse(raw);
  }
  return NotifierConfigSchema.parse({});
}

// --- environment-supplied secrets (terminal, exit 10, when a required one is missing) ---

export class MissingGithubTokenError extends TerminalError {
  constructor() {
    super(
      'STAR_SYNC_TOKEN is not set. Provide a fine-grained PAT with `Contents: read` (read-only).',
      'MISSING_TOKEN',
    );
  }
}

export class MissingTelegramCredentialsError extends TerminalError {
  constructor(which: string) {
    super(
      `${which} is not set. Telegram delivery requires a bot token and a chat id.`,
      'MISSING_TELEGRAM',
    );
  }
}

/** GitHub PAT used to read commit SHAs / file contents and to resolve repositories. */
export function readGithubToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.STAR_SYNC_TOKEN?.trim();
  if (!token) throw new MissingGithubTokenError();
  return token;
}

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

/** Telegram bot credentials, required only when actually delivering (P2.3). */
export function readTelegramCredentials(env: NodeJS.ProcessEnv = process.env): TelegramCredentials {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) throw new MissingTelegramCredentialsError('TELEGRAM_BOT_TOKEN');
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) throw new MissingTelegramCredentialsError('TELEGRAM_CHAT_ID');
  return { botToken, chatId };
}
