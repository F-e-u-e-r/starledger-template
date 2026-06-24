/**
 * Pure, individually testable checks. File/config checks are synchronous and
 * operate on a root directory; the two network checks take an injected `fetch`
 * so tests never touch the network.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CheckResult } from './report';

function pass(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: 'pass', detail };
}
function warn(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: 'warn', detail };
}
function incomplete(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: 'incomplete', detail };
}
function invalid(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: 'invalid', detail };
}

function has(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── local group ────────────────────────────────────────────────────────────

export function checkNodeVersion(version: string): CheckResult {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  const ok = Number.isFinite(major) && major >= 22;
  return ok
    ? pass('local.node-version', 'Node >= 22', `node ${version}`)
    : incomplete(
        'local.node-version',
        'Node >= 22',
        `node ${version}; install Node 22+ (see .nvmrc)`,
      );
}

export function checkPnpmWorkspace(root: string): CheckResult {
  const lock = has(root, 'pnpm-lock.yaml');
  const ws = has(root, 'pnpm-workspace.yaml');
  if (lock && ws)
    return pass('local.pnpm', 'pnpm workspace', 'lockfile + workspace manifest present');
  const missing = [!ws && 'pnpm-workspace.yaml', !lock && 'pnpm-lock.yaml']
    .filter(Boolean)
    .join(', ');
  return incomplete('local.pnpm', 'pnpm workspace', `missing: ${missing}`);
}

const REQUIRED_FILES = [
  'package.json',
  'tsconfig.base.json',
  'vitest.config.ts',
  'apps/dashboard',
  'packages/exporter',
  'packages/schema',
];

export function checkRequiredFiles(root: string): CheckResult {
  const missing = REQUIRED_FILES.filter((f) => !has(root, f));
  return missing.length === 0
    ? pass('local.required-files', 'Required workspace files', 'all present')
    : incomplete(
        'local.required-files',
        'Required workspace files',
        `missing: ${missing.join(', ')}`,
      );
}

const EXAMPLE_FILES = [
  'config.example.yaml',
  'config/ai.example.yaml',
  'config/notifier.example.yaml',
  'config/template.example.yaml',
];

export function checkConfigExamples(root: string): CheckResult {
  const missing = EXAMPLE_FILES.filter((f) => !has(root, f));
  return missing.length === 0
    ? pass('local.config-examples', 'Config examples', 'all example configs present')
    : incomplete('local.config-examples', 'Config examples', `missing: ${missing.join(', ')}`);
}

const REQUIRED_WORKFLOWS = ['sync-stars.yml', 'pages.yml', 'ci.yml'];

export function checkWorkflows(root: string): CheckResult {
  const missing = REQUIRED_WORKFLOWS.filter((w) => !has(root, `.github/workflows/${w}`));
  return missing.length === 0
    ? pass('local.workflows', 'GitHub Actions workflows', 'core workflows present')
    : incomplete('local.workflows', 'GitHub Actions workflows', `missing: ${missing.join(', ')}`);
}

/**
 * The exporter only publishes its dataset when the checked-in sync workflow
 * explicitly requests `contents: write`. The repository-level Actions setting
 * still has to allow that permission; that remote setting cannot be read
 * reliably with the deliberately read-only STAR_SYNC_TOKEN.
 */
export function checkSyncWorkflowWritePermission(root: string): CheckResult {
  const id = 'github.workflow-write';
  const title = 'Sync workflow contents permission';
  const p = join(root, '.github/workflows/sync-stars.yml');
  if (!existsSync(p)) return incomplete(id, title, 'sync-stars.yml missing');
  try {
    const yaml = readFileSync(p, 'utf8');
    const hasWritePermission =
      /^permissions:\s*\n(?:^[ \t].*\n)*?^[ \t]+contents:\s*write\s*$/m.test(yaml);
    return hasWritePermission
      ? pass(id, title, 'sync-stars.yml requests contents: write')
      : invalid(id, title, 'sync-stars.yml must request contents: write to publish generated data');
  } catch (e) {
    return invalid(id, title, `cannot read sync-stars.yml: ${errMessage(e)}`);
  }
}

interface StarsShape {
  schema_version?: unknown;
  repos?: unknown;
}

export function checkStarsJson(root: string): CheckResult {
  const p = join(root, 'stars.json');
  if (!existsSync(p)) {
    return pass('local.stars-json', 'stars.json', 'absent — created by the first Sync stars run');
  }
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as StarsShape;
    if (
      !data ||
      typeof data !== 'object' ||
      data.schema_version !== '1.0' ||
      !Array.isArray(data.repos)
    ) {
      return invalid(
        'local.stars-json',
        'stars.json',
        'present but not a recognized dataset shape (expected schema_version "1.0" + repos array)',
      );
    }
    return pass('local.stars-json', 'stars.json', `valid — ${data.repos.length} repos`);
  } catch (e) {
    return invalid('local.stars-json', 'stars.json', `not valid JSON: ${errMessage(e)}`);
  }
}

interface DatasetMetaShape {
  schema_version?: unknown;
  dataset_generated_at?: unknown;
  stars_sha256?: unknown;
  repo_count?: unknown;
}

export function checkDatasetMeta(root: string): CheckResult {
  const p = join(root, 'dataset-meta.json');
  if (!existsSync(p)) {
    return pass('local.dataset-meta', 'dataset-meta.json', 'absent — created with stars.json');
  }
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as DatasetMetaShape;
    const ok =
      data &&
      typeof data === 'object' &&
      data.schema_version === '1.0' &&
      typeof data.dataset_generated_at === 'string' &&
      typeof data.stars_sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(data.stars_sha256) &&
      typeof data.repo_count === 'number' &&
      Number.isInteger(data.repo_count) &&
      data.repo_count >= 0;
    return ok
      ? pass('local.dataset-meta', 'dataset-meta.json', `valid — ${String(data.repo_count)} repos`)
      : invalid(
          'local.dataset-meta',
          'dataset-meta.json',
          'present but not a valid dataset-meta shape',
        );
  } catch (e) {
    return invalid('local.dataset-meta', 'dataset-meta.json', `not valid JSON: ${errMessage(e)}`);
  }
}

/** If both stars.json and dataset-meta.json exist, repo_count must agree. */
export function checkDatasetConsistency(root: string): CheckResult {
  const sp = join(root, 'stars.json');
  const mp = join(root, 'dataset-meta.json');
  const id = 'local.dataset-consistency';
  const title = 'Dataset / meta agreement';
  if (existsSync(sp) !== existsSync(mp)) {
    const present = existsSync(sp) ? 'stars.json' : 'dataset-meta.json';
    return invalid(id, title, `${present} present without its pair — publish them together`);
  }
  if (!existsSync(sp)) return pass(id, title, 'no dataset yet');
  try {
    const stars = JSON.parse(readFileSync(sp, 'utf8')) as StarsShape;
    const meta = JSON.parse(readFileSync(mp, 'utf8')) as DatasetMetaShape;
    const n = Array.isArray(stars.repos) ? stars.repos.length : undefined;
    if (typeof meta.repo_count === 'number' && n !== undefined && meta.repo_count !== n) {
      return invalid(
        id,
        title,
        `repo_count ${String(meta.repo_count)} != ${n} repos in stars.json`,
      );
    }
    const actualHash = createHash('sha256').update(readFileSync(sp)).digest('hex');
    if (typeof meta.stars_sha256 === 'string' && meta.stars_sha256 !== actualHash) {
      return invalid(id, title, 'stars_sha256 does not match the exact stars.json bytes');
    }
    return pass(id, title, 'stars.json and dataset-meta.json agree');
  } catch (e) {
    return invalid(id, title, `cannot compare: ${errMessage(e)}`);
  }
}

// ── AI group ─────────────────────────────────────────────────────────────────

export const VALID_EXECUTORS = ['claude-routine', 'codex-automation'];

interface AiConfigShape {
  ai?: {
    enabled?: unknown;
    executor_kind?: unknown;
    budget?: { max_total_per_run?: unknown };
  };
}

/**
 * `config/ai.yaml` is optional. Absent or `ai.enabled: false` is safe. When
 * enabled, executor_kind must be a known executor and the budget must be a
 * positive integer.
 */
export function checkAiConfig(root: string): CheckResult {
  const id = 'ai.config';
  const title = 'AI config';
  const p = join(root, 'config/ai.yaml');
  if (!existsSync(p)) return pass(id, title, 'config/ai.yaml absent — AI disabled');
  let parsed: AiConfigShape | null;
  try {
    parsed = parseYaml(readFileSync(p, 'utf8')) as AiConfigShape | null;
  } catch (e) {
    return invalid(id, title, `config/ai.yaml is not valid YAML: ${errMessage(e)}`);
  }
  const ai = parsed?.ai ?? {};
  if (ai.enabled !== true) return pass(id, title, 'ai.enabled: false — disabled (safe default)');
  const kind = ai.executor_kind;
  if (typeof kind !== 'string' || !VALID_EXECUTORS.includes(kind)) {
    return invalid(
      id,
      title,
      `ai.enabled: true but executor_kind is ${JSON.stringify(kind)}; use one of ${VALID_EXECUTORS.join(', ')}`,
    );
  }
  const total = ai.budget?.max_total_per_run;
  if (total !== undefined && (typeof total !== 'number' || total < 1 || !Number.isInteger(total))) {
    return invalid(
      id,
      title,
      `budget.max_total_per_run must be a positive integer, got ${JSON.stringify(total)}`,
    );
  }
  return pass(id, title, `ai.enabled: true, executor_kind: ${kind}`);
}

interface AnnotationsShape {
  schema_version?: unknown;
  taxonomy_version?: unknown;
  annotations?: unknown;
}
interface AnnotationsMetaShape {
  schema_version?: unknown;
  annotations_sha256?: unknown;
  annotation_count?: unknown;
  taxonomy_version?: unknown;
  dataset_sha256?: unknown;
  generated_at?: unknown;
}

/** The annotations artifact and its meta must be present (or absent) together. */
export function checkAiArtifactPair(root: string): CheckResult {
  const id = 'ai.artifact-pair';
  const title = 'AI artifact pair';
  const ann = has(root, 'ai-annotations.json');
  const meta = has(root, 'ai-annotations-meta.json');
  if (!ann && !meta) return pass(id, title, 'no AI artifacts present');
  if (ann !== meta) {
    const lonely = ann
      ? 'ai-annotations.json without ai-annotations-meta.json'
      : 'ai-annotations-meta.json without ai-annotations.json';
    return invalid(id, title, `incomplete pair — ${lonely}`);
  }
  try {
    const annotationsPath = join(root, 'ai-annotations.json');
    const annotationsBytes = readFileSync(annotationsPath);
    const a = JSON.parse(annotationsBytes.toString('utf8')) as AnnotationsShape;
    const m = JSON.parse(
      readFileSync(join(root, 'ai-annotations-meta.json'), 'utf8'),
    ) as AnnotationsMetaShape;
    const n = Array.isArray(a.annotations) ? a.annotations.length : undefined;
    const invalidShape =
      a.schema_version !== '1.0' ||
      typeof a.taxonomy_version !== 'string' ||
      n === undefined ||
      m.schema_version !== '1.0' ||
      typeof m.annotations_sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(m.annotations_sha256) ||
      typeof m.annotation_count !== 'number' ||
      !Number.isInteger(m.annotation_count) ||
      m.annotation_count < 0 ||
      typeof m.taxonomy_version !== 'string' ||
      typeof m.dataset_sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(m.dataset_sha256) ||
      typeof m.generated_at !== 'string';
    if (invalidShape) return invalid(id, title, 'artifact or meta does not have a valid P3 shape');
    if (typeof m.annotation_count === 'number' && n !== undefined && m.annotation_count !== n) {
      return invalid(
        id,
        title,
        `annotation_count ${String(m.annotation_count)} != ${n} annotations`,
      );
    }
    const actualHash = createHash('sha256').update(annotationsBytes).digest('hex');
    if (m.annotations_sha256 !== actualHash) {
      return invalid(
        id,
        title,
        'annotations_sha256 does not match the exact ai-annotations.json bytes',
      );
    }
    if (m.taxonomy_version !== a.taxonomy_version) {
      return invalid(id, title, 'taxonomy_version differs between artifact and meta');
    }
    return pass(id, title, `valid pair — ${n ?? '?'} annotations`);
  } catch (e) {
    return invalid(id, title, `AI artifact JSON is malformed: ${errMessage(e)}`);
  }
}

// ── template-clean group ─────────────────────────────────────────────────────

const PERSONAL_ARTIFACTS = [
  'stars.json',
  'dataset-meta.json',
  'ai-annotations.json',
  'ai-annotations-meta.json',
  'run-meta.json',
  'ai-run-meta.json',
  '.ai-runs',
  'notifier-state.json',
  'classifier-state.json',
];

const LIVE_CONFIGS = ['config/ai.yaml', 'config/notifier.yaml', 'config.yaml'];

/** Assert a directory is a pristine template: no personal data, no live config. */
export function checkTemplateClean(root: string): CheckResult[] {
  const personal = PERSONAL_ARTIFACTS.filter((f) => has(root, f));
  const live = LIVE_CONFIGS.filter((f) => has(root, f));
  const envFiles = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
        .map((entry) => entry.name)
    : [];
  const out: CheckResult[] = [];
  out.push(
    personal.length === 0
      ? pass('clean.personal-artifacts', 'No personal artifacts', 'none present')
      : invalid(
          'clean.personal-artifacts',
          'No personal artifacts',
          `present (must not ship): ${personal.join(', ')}`,
        ),
  );
  out.push(
    live.length === 0
      ? pass('clean.live-config', 'No live config', 'none present')
      : invalid(
          'clean.live-config',
          'No live config',
          `present (must not ship): ${live.join(', ')}`,
        ),
  );
  out.push(
    envFiles.length === 0
      ? pass('clean.env-files', 'No environment files', 'none present')
      : invalid(
          'clean.env-files',
          'No environment files',
          `present (must not ship): ${envFiles.join(', ')}`,
        ),
  );
  return out;
}

// ── network group (injected fetch) ───────────────────────────────────────────

interface GraphqlViewer {
  data?: { viewer?: { login?: string; starredRepositories?: { totalCount?: number } } };
  errors?: { message?: string }[];
}

/** Confirm STAR_SYNC_TOKEN can read the viewer's stars (GraphQL). */
export async function checkStarsRead(token: string, fetchImpl: typeof fetch): Promise<CheckResult> {
  const id = 'github.stars-read';
  const title = 'Token reads stars';
  try {
    const res = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'starledger-setup-doctor',
      },
      body: JSON.stringify({ query: '{ viewer { login starredRepositories { totalCount } } }' }),
    });
    if (res.status === 401 || res.status === 403) {
      return invalid(
        id,
        title,
        `GitHub rejected the token (HTTP ${res.status}); check STAR_SYNC_TOKEN + Starring:Read`,
      );
    }
    if (!res.ok) return warn(id, title, `could not verify now (HTTP ${res.status})`);
    const json = (await res.json()) as GraphqlViewer;
    if (json.errors?.length) {
      return invalid(id, title, `GraphQL error: ${json.errors[0]?.message ?? 'unknown'}`);
    }
    const login = json.data?.viewer?.login;
    if (!login) return invalid(id, title, 'token accepted but viewer.login missing — check scopes');
    const count = json.data?.viewer?.starredRepositories?.totalCount;
    return pass(id, title, `reads stars for @${login} (${count ?? '?'} starred)`);
  } catch {
    return warn(id, title, 'could not verify now (network error)');
  }
}

interface TelegramGetChat {
  ok?: boolean;
  description?: string;
  result?: { id?: number | string };
}

/**
 * Validate the configured Telegram destination without delivering a message.
 * `getMe` proves the token; `getChat` proves that this bot can reach the chat.
 */
export async function checkTelegramChat(
  token: string,
  chatId: string,
  fetchImpl: typeof fetch,
): Promise<CheckResult> {
  const id = 'telegram.chat';
  const title = 'Telegram destination chat';
  try {
    const endpoint = `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`;
    const res = await fetchImpl(endpoint);
    const json = (await res.json()) as TelegramGetChat;
    if (!res.ok || json.ok !== true) {
      const bad =
        res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404;
      const detail = json.description ?? `HTTP ${res.status}`;
      return bad
        ? invalid(id, title, `bot cannot access the configured chat: ${detail}`)
        : warn(id, title, `could not verify now: ${detail}`);
    }
    return pass(id, title, 'bot can access the configured chat');
  } catch {
    // See the equivalent comment in checkTelegramBot: do not risk including a
    // token-bearing endpoint in diagnostic output.
    return warn(id, title, 'could not verify now (network error)');
  }
}

interface TelegramGetMe {
  ok?: boolean;
  description?: string;
  result?: { username?: string };
}

/** Validate TELEGRAM_BOT_TOKEN via getMe (non-destructive — sends nothing). */
export async function checkTelegramBot(
  token: string,
  chatId: string | undefined,
  fetchImpl: typeof fetch,
): Promise<CheckResult> {
  const id = 'telegram.bot';
  const title = 'Telegram bot token';
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
    const json = (await res.json()) as TelegramGetMe;
    if (!res.ok || json.ok !== true) {
      const bad = res.status === 401 || res.status === 404;
      const detail = json.description ?? `HTTP ${res.status}`;
      return bad
        ? invalid(id, title, `invalid bot token: ${detail}`)
        : warn(id, title, `could not verify now: ${detail}`);
    }
    const suffix = chatId ? '' : ' (set TELEGRAM_CHAT_ID to deliver)';
    return pass(id, title, `bot @${json.result?.username ?? '?'} reachable${suffix}`);
  } catch {
    // The token is embedded in Telegram's endpoint URL; never echo a transport
    // error because a library could include that URL in its message.
    return warn(id, title, 'could not verify now (network error)');
  }
}
