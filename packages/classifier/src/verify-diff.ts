import { execFileSync, spawnSync } from 'node:child_process';

/** The only files an autonomous executor may propose for merge in P3. */
export const AGENT_EDITABLE_PATHS = new Set(['ai-annotations.json', 'ai-annotations-meta.json']);
const REQUIRED_ARTIFACT_PAIR = ['ai-annotations.json', 'ai-annotations-meta.json'] as const;

export interface GitDiffEntry {
  status: string;
  path: string;
  previousPath?: string;
}

export class AgentDiffError extends Error {
  constructor(paths: readonly string[], reason = 'agent branch violates the AI artifact gate') {
    super(`${reason}: ${paths.join(', ')}`);
    this.name = 'AgentDiffError';
  }
}

function normalizeRepoPath(path: string): string | null {
  if (!path || path.startsWith('/') || path.includes('\\')) return null;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    return null;
  return segments.join('/');
}

/** Throws unless every changed path is exactly one committed AI artifact path. */
export function verifyAgentDiffPaths(paths: readonly string[]): void {
  const rejected = paths.filter((path) => {
    const normalized = normalizeRepoPath(path);
    return normalized === null || !AGENT_EDITABLE_PATHS.has(normalized);
  });
  if (rejected.length > 0) {
    throw new AgentDiffError(
      rejected,
      'agent branch changes paths outside the AI artifact allowlist',
    );
  }
}

/** Throws unless the agent only adds or updates the complete artifact pair. */
export function verifyAgentDiffEntries(entries: readonly GitDiffEntry[]): void {
  const touchedPaths = entries.flatMap((entry) =>
    entry.previousPath === undefined ? [entry.path] : [entry.previousPath, entry.path],
  );
  verifyAgentDiffPaths(touchedPaths);

  const disallowedLifecycle = entries.filter(
    (entry) => entry.status.startsWith('D') || entry.status.startsWith('R'),
  );
  if (disallowedLifecycle.length > 0) {
    throw new AgentDiffError(
      disallowedLifecycle.flatMap(
        (entry) => [entry.previousPath, entry.path].filter(Boolean) as string[],
      ),
      'agent branch may not delete or rename AI artifacts',
    );
  }

  const unsupportedStatus = entries.filter((entry) => entry.status !== 'A' && entry.status !== 'M');
  if (unsupportedStatus.length > 0) {
    throw new AgentDiffError(
      unsupportedStatus.map((entry) => entry.path),
      'agent branch may only add or update AI artifacts',
    );
  }

  const changedArtifacts = new Set(entries.map((entry) => entry.path));
  if (changedArtifacts.size === 0) return;
  const missing = REQUIRED_ARTIFACT_PAIR.filter((path) => !changedArtifacts.has(path));
  if (missing.length > 0 || changedArtifacts.size !== REQUIRED_ARTIFACT_PAIR.length) {
    throw new AgentDiffError(
      [...missing, ...changedArtifacts],
      'agent branch must add or update the complete AI artifact pair',
    );
  }
}

/** Reads a NUL-delimited Git diff so unusual legal filenames cannot bypass checks. */
export function changedPathsSince(baseRef: string, cwd = process.cwd()): string[] {
  return changedPathsBetween(baseRef, 'HEAD', cwd);
}

/** Compares arbitrary Git refs so trusted CI need never check out agent code. */
export function changedPathsBetween(
  baseRef: string,
  headRef: string,
  cwd = process.cwd(),
): string[] {
  return changedPathEntriesBetween(baseRef, headRef, cwd).map((entry) => entry.path);
}

/** Reads NUL-delimited Git status records, including rename source+target paths. */
export function changedPathEntriesBetween(
  baseRef: string,
  headRef: string,
  cwd = process.cwd(),
): GitDiffEntry[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-status', '-z', '-M', `${baseRef}...${headRef}`],
    {
      encoding: 'buffer',
      cwd,
    },
  );
  const tokens = output
    .toString('utf8')
    .split('\0')
    .filter((path) => path.length > 0);
  const entries: GitDiffEntry[] = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (status === undefined) break;
    if (status.startsWith('R')) {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (previousPath === undefined || path === undefined) {
        throw new Error('malformed git rename diff output');
      }
      entries.push({ status, previousPath, path });
      continue;
    }
    const path = tokens[index++];
    if (path === undefined) throw new Error('malformed git diff output');
    entries.push({ status, path });
  }
  return entries;
}

/** Branch prefixes that identify an approved autonomous executor run. */
export const APPROVED_EXECUTOR_BRANCH_PREFIXES = ['claude/', 'codex/'] as const;

/** A branch-name convention only — it identifies the executor, it does not authorize it. */
export function isApprovedExecutorBranch(headBranch: string): boolean {
  return APPROVED_EXECUTOR_BRANCH_PREFIXES.some((prefix) => headBranch.startsWith(prefix));
}

/**
 * True when the diff adds, updates, deletes, or renames either public AI
 * artifact (renames are detected via the previous path too). This is the
 * PATH-based trigger: it decides whether the executor-identity rules apply, so a
 * renamed branch can never make an artifact change skip the gate.
 */
export function touchesAiArtifacts(entries: readonly GitDiffEntry[]): boolean {
  return entries.some(
    (entry) =>
      AGENT_EDITABLE_PATHS.has(entry.path) ||
      (entry.previousPath !== undefined && AGENT_EDITABLE_PATHS.has(entry.previousPath)),
  );
}

/**
 * Reads a single path at a Git ref as text, so trusted CI can inspect agent
 * artifacts as data without ever checking out or executing agent-controlled
 * code. Only the fixed AI artifact paths are ever passed here.
 */
export function readArtifactAtRef(ref: string, path: string, cwd = process.cwd()): string {
  return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', cwd });
}

/**
 * Like {@link readArtifactAtRef} but returns null — quietly — when the path is
 * absent at the ref (e.g. the first AI PR, where the base has no annotations
 * yet). Probing with `cat-file -e` keeps git's "does not exist" diagnostic off
 * stderr, so an expected absence is not mistaken for an error.
 */
export function tryReadArtifactAtRef(
  ref: string,
  path: string,
  cwd = process.cwd(),
): string | null {
  const probe = spawnSync('git', ['cat-file', '-e', `${ref}:${path}`], { cwd });
  if (probe.status !== 0) return null;
  return readArtifactAtRef(ref, path, cwd);
}
