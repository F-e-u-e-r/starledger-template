/** Orchestration: resolve which check groups to run, then run them. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  checkAiArtifactPair,
  checkAiConfig,
  checkConfigExamples,
  checkDatasetConsistency,
  checkDatasetMeta,
  checkNodeVersion,
  checkPnpmWorkspace,
  checkRequiredFiles,
  checkStarsJson,
  checkStarsRead,
  checkSyncWorkflowWritePermission,
  checkTelegramBot,
  checkTelegramChat,
  checkTemplateClean,
  checkWorkflows,
} from './checks';
import type { CheckResult } from './report';
import { dedupeById } from './report';

export type Mode = 'local' | 'github-actions' | 'telegram' | 'ai' | 'template-clean';

export const ALL_MODES: Mode[] = ['local', 'github-actions', 'telegram', 'ai', 'template-clean'];

export interface DoctorOptions {
  /** Repo root to inspect (default: cwd). */
  root?: string;
  /** Environment to read secrets from (default: process.env). */
  env?: Record<string, string | undefined>;
  /** Explicit modes. Empty/undefined → local + deployable core + opted-in features. */
  modes?: Mode[];
  /** Skip all network checks. */
  offline?: boolean;
  /** Override the reported Node version (tests). */
  nodeVersion?: string;
  /** Injected fetch for the network checks (tests). */
  fetchImpl?: typeof fetch;
}

interface TemplateFeatures {
  notifier: boolean;
  ai: boolean;
}

function readTemplateFeatures(root: string): TemplateFeatures {
  const p = join(root, 'config/template.yaml');
  if (!existsSync(p)) return { notifier: false, ai: false };
  try {
    const cfg = parseYaml(readFileSync(p, 'utf8')) as {
      features?: { notifier?: { enabled?: unknown }; ai?: { enabled?: unknown } };
    } | null;
    return {
      notifier: cfg?.features?.notifier?.enabled === true,
      ai: cfg?.features?.ai?.enabled === true,
    };
  } catch {
    return { notifier: false, ai: false };
  }
}

/**
 * With no explicit modes, check the deployable core as well as local hygiene.
 * A fresh clone without STAR_SYNC_TOKEN must not look ready merely because its
 * files are well formed; the token is required for the first Sync stars run.
 * Optional Telegram/AI checks remain feature-gated by config/template.yaml.
 */
export function resolveModes(explicit: Mode[] | undefined, root: string): Set<Mode> {
  if (explicit && explicit.length > 0) return new Set(explicit);
  const modes = new Set<Mode>(['local', 'github-actions']);
  const features = readTemplateFeatures(root);
  if (features.notifier) modes.add('telegram');
  if (features.ai) modes.add('ai');
  return modes;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<CheckResult[]> {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;
  const offline = options.offline ?? false;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const modes = resolveModes(options.modes, root);
  const results: CheckResult[] = [];

  if (modes.has('local')) {
    results.push(checkNodeVersion(options.nodeVersion ?? process.version));
    results.push(checkPnpmWorkspace(root));
    results.push(checkRequiredFiles(root));
    results.push(checkConfigExamples(root));
    results.push(checkWorkflows(root));
    results.push(checkStarsJson(root));
    results.push(checkDatasetMeta(root));
    results.push(checkDatasetConsistency(root));
    results.push(checkAiConfig(root));
    results.push(checkAiArtifactPair(root));
  }

  if (modes.has('template-clean')) {
    results.push(...checkTemplateClean(root));
    results.push(checkConfigExamples(root));
  }

  if (modes.has('github-actions')) {
    results.push(checkWorkflows(root));
    results.push(checkSyncWorkflowWritePermission(root));
    const token = env.STAR_SYNC_TOKEN;
    if (!token) {
      results.push({
        id: 'github.token',
        title: 'STAR_SYNC_TOKEN',
        status: 'incomplete',
        detail: 'not set — required to read stars (see docs/setup/secrets.md)',
      });
    } else {
      results.push({
        id: 'github.token',
        title: 'STAR_SYNC_TOKEN',
        status: 'pass',
        detail: 'present',
      });
      if (!offline) results.push(await checkStarsRead(token, fetchImpl));
    }
    results.push({
      id: 'github.repository-write',
      title: 'Repository workflow-write setting',
      status: 'warn',
      detail: 'cannot verify from CLI — set Actions → Workflow permissions to Read and write',
    });
  }

  if (modes.has('telegram')) {
    const bot = env.TELEGRAM_BOT_TOKEN;
    const chat = env.TELEGRAM_CHAT_ID;
    if (bot && chat) {
      results.push({
        id: 'telegram.secrets',
        title: 'Telegram secrets',
        status: 'pass',
        detail: 'bot token + chat id present',
      });
    } else {
      const missing = [!bot && 'TELEGRAM_BOT_TOKEN', !chat && 'TELEGRAM_CHAT_ID']
        .filter(Boolean)
        .join(', ');
      results.push({
        id: 'telegram.secrets',
        title: 'Telegram secrets',
        status: 'incomplete',
        detail: `not set: ${missing}`,
      });
    }
    if (bot && !offline) {
      const botResult = await checkTelegramBot(bot, chat, fetchImpl);
      results.push(botResult);
      if (chat && botResult.status === 'pass')
        results.push(await checkTelegramChat(bot, chat, fetchImpl));
    }
  }

  if (modes.has('ai')) {
    results.push(checkAiConfig(root));
    results.push(checkAiArtifactPair(root));
  }

  return dedupeById(results);
}
