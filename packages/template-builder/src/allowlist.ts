/**
 * The template allowlist. This is the single source of truth that mirrors
 * docs/P4-template-inventory.md. The builder copies ONLY what is allowed here,
 * so anything not listed is excluded by default — a fail-closed posture: a new
 * personal file added to the repo will not leak into the template unless it is
 * explicitly allowed.
 */
import { sep } from 'node:path';

/** Top-level directories copied recursively (minus EXCLUDE). */
export const ALLOW_DIRS = ['apps', 'packages', 'schemas', 'prompts', 'docs', '.github', 'config'];

/** Top-level files copied verbatim if present. */
export const ALLOW_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'vitest.config.ts',
  'eslint.config.js',
  '.prettierrc.json',
  '.prettierignore',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  'LICENSE',
  // The root EXPORTER example config — easy to miss because it is not under config/.
  'config.example.yaml',
];

/** Path segments that exclude a file anywhere in the tree. */
export const EXCLUDE_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  '.git',
  '.ai-runs',
]);

/**
 * Basenames that must never ship even if added under an allowed directory
 * (defense-in-depth — these normally live at the repo root, which is allowlisted
 * file-by-file and therefore already excludes them).
 */
export const EXCLUDE_BASENAMES = new Set([
  'stars.json',
  'dataset-meta.json',
  'ai-annotations.json',
  'ai-annotations-meta.json',
  'run-meta.json',
  'ai-run-meta.json',
  'notifier-state.json',
  'classifier-state.json',
  '.DS_Store',
  'config.yaml',
  'ai.yaml',
  'notifier.yaml',
]);

/** Workflows whose `schedule:` trigger is neutralized (dispatch-only) in the template. */
export const NEUTRALIZE_SCHEDULE_WORKFLOWS = new Set([
  'sync-stars.yml',
  'notify.yml',
  'ai-state.yml',
]);

/** The personal README is replaced by this file, renamed to README.md. */
export const README_TEMPLATE = 'README.template.md';
export const README_OUTPUT = 'README.md';

function segments(rel: string): string[] {
  return rel.split(sep).filter((s) => s.length > 0);
}

/**
 * True if a repo-relative path must be excluded. Applies segment, basename, and
 * a config-directory rule: under `config/`, only `*.example.yaml` ships (so the
 * live `config/ai.yaml` / `config/notifier.yaml` never leak).
 */
export function isExcluded(rel: string): boolean {
  const segs = segments(rel);
  if (segs.some((s) => EXCLUDE_SEGMENTS.has(s))) return true;
  const base = segs[segs.length - 1] ?? '';
  if (EXCLUDE_BASENAMES.has(base)) return true;
  // Secrets must never ride along inside an otherwise-allowed directory such
  // as `apps/` or `packages/`. This covers `.env`, `.env.local`, `.envrc`, etc.
  if (base.startsWith('.env')) return true;
  if (base.endsWith('.tsbuildinfo') || base.endsWith('.swp')) return true;
  if (segs[0] === 'config' && !base.endsWith('.example.yaml')) return true;
  return false;
}
