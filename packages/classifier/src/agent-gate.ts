import { verifyAiArtifacts } from './assemble';
import {
  changedPathEntriesBetween,
  type GitDiffEntry,
  isApprovedExecutorBranch,
  readArtifactAtRef,
  touchesAiArtifacts,
  verifyAgentDiffEntries,
} from './verify-diff';

const ANNOTATIONS_PATH = 'ai-annotations.json';
const META_PATH = 'ai-annotations-meta.json';

export class AgentGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentGateError';
  }
}

export interface AgentPullRequestContext {
  /** PR head branch name (attacker-controlled — never used as a shell argument). */
  headBranch: string;
  /** PR head repository `owner/name`; empty when the source fork no longer exists. */
  headRepo: string;
  /** The trusted base / current repository `owner/name`. */
  repo: string;
  /** The base...head diff entries, produced by trusted base-branch code. */
  entries: readonly GitDiffEntry[];
  /** Reads an artifact's bytes at the head ref. Called only once the pair is required. */
  readArtifact: (path: string) => string;
}

export interface AgentGateResult {
  /** Whether the PR touched a public AI artifact (and therefore ran the full gate). */
  touched: boolean;
}

/**
 * The PATH-TRIGGERED structural gate. Whether validation runs is decided by the
 * changed paths, never by the branch name:
 *
 *   - a PR that touches NO AI artifact passes with no executor checks (it is an
 *     ordinary source/human PR);
 *   - ANY PR that touches an AI artifact must come from an approved,
 *     same-repository executor branch and change only the complete, valid
 *     artifact pair — so renaming a branch (or a fork impersonating `claude/*`)
 *     can never bypass validation.
 *
 * It never trusts agent-supplied content: the artifact bytes are read with
 * `readArtifact` (a trusted Git ref) and validated against the shared schema.
 */
export function verifyAgentPullRequest(context: AgentPullRequestContext): AgentGateResult {
  if (!touchesAiArtifacts(context.entries)) return { touched: false };

  if (!isApprovedExecutorBranch(context.headBranch)) {
    throw new AgentGateError(
      'AI artifact changes must originate from an approved executor branch (claude/* or codex/*)',
    );
  }
  if (context.headRepo === '' || context.headRepo !== context.repo) {
    throw new AgentGateError(
      'AI artifact changes must originate from a same-repository executor branch, not a fork',
    );
  }

  // Structural artifact rules: allowlist, add/update only (no delete/rename), complete pair.
  verifyAgentDiffEntries(context.entries);

  // Schema, count, taxonomy, and exact-byte hash on the trusted-read pair.
  verifyAiArtifacts(context.readArtifact(ANNOTATIONS_PATH), context.readArtifact(META_PATH));
  return { touched: true };
}

export interface AgentPullRequestGitContext {
  /** Trusted base reference (e.g. the PR base SHA). */
  baseRef: string;
  /** Git ref holding the PR head commit, fetched as data (never checked out). */
  headGitRef: string;
  /** PR head branch name (executor identity). */
  headBranch: string;
  /** PR head repository `owner/name`. */
  headRepo: string;
  /** This (base) repository `owner/name`. */
  repo: string;
  cwd?: string;
}

/** Git-backed wrapper: builds the diff + artifact reader from trusted refs. */
export function verifyAgentPullRequestFromGit(
  context: AgentPullRequestGitContext,
): AgentGateResult {
  const cwd = context.cwd ?? process.cwd();
  return verifyAgentPullRequest({
    headBranch: context.headBranch,
    headRepo: context.headRepo,
    repo: context.repo,
    entries: changedPathEntriesBetween(context.baseRef, context.headGitRef, cwd),
    readArtifact: (path) => readArtifactAtRef(context.headGitRef, path, cwd),
  });
}
