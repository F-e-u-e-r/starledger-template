import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Strip embedded credentials from any remote URL in git output (e.g. the
 * `https://x-access-token:<TOKEN>@github.com/...` form a CI token push uses), so
 * a surfaced git error can never leak the push credential into logs.
 */
export function redactGitOutput(s: string): string {
  return s.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@');
}

/**
 * Run a git subcommand, surfacing git's own (redacted) stderr on failure.
 * execFile rejects with an Error whose `.stderr` holds git's diagnostics;
 * without forwarding it the real reason (e.g. "You are not currently on a
 * branch") is lost and the caller sees only an opaque non-zero exit.
 */
async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', [...args], { cwd });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = redactGitOutput((e.stderr || e.message || '').trim());
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

/**
 * The Git publication boundary. The remote publication unit is a single commit
 * containing both stars.json and dataset-meta.json; a reader only ever sees the
 * previous valid commit or the next complete one. Injected for tests.
 */
export interface GitPublisher {
  /** Stage the given files (relative to the repo) and create ONE commit. */
  commit(files: readonly string[], message: string): Promise<void>;
  push(): Promise<void>;
}

export class RealGitPublisher implements GitPublisher {
  private readonly run: (args: readonly string[]) => Promise<string>;

  /**
   * `run` is the git executor; it defaults to the real (redacting) `git` helper
   * and exists only as a seam so the rebase/retry control flow can be exercised
   * deterministically — a non-fast-forward-then-success race is impractical to
   * stage with a real remote.
   */
  constructor(
    private readonly cwd: string,
    run?: (args: readonly string[]) => Promise<string>,
  ) {
    this.run = run ?? ((args) => git(cwd, args));
  }

  async commit(files: readonly string[], message: string): Promise<void> {
    await this.run(['add', '--', ...files]);
    await this.run(['commit', '-m', message]);
  }

  /**
   * Publish the dataset commit to the target branch.
   *
   * CI checks out the event SHA in DETACHED HEAD (actions/checkout pins the
   * commit, not the branch), so we push an explicit refspec — also correct on a
   * branch. But the publish branch moves under us: a daily sync spends minutes
   * hydrating and can race a PR merge, so a plain push is rejected
   * non-fast-forward. Rebase the single dataset commit onto the current remote
   * tip first, then push; one bounded retry covers a second racer that lands in
   * the narrow fetch→push window.
   *
   * Safety boundary: never force-push. A rebase conflict means a concurrent
   * commit already changed stars.json/dataset-meta.json on the remote; that is
   * fail-closed (abort + surface), leaving the remote last-known-good intact
   * rather than clobbering another dataset.
   */
  async push(): Promise<void> {
    const branch = await this.resolvePushBranch();
    const remoteRef = `refs/remotes/origin/${branch}`;
    // `+` force-updates only the LOCAL remote-tracking ref to match the remote
    // (standard fetch behavior); it never rewrites the remote branch.
    const fetchRefspec = `+refs/heads/${branch}:${remoteRef}`;
    const pushRefspec = `HEAD:refs/heads/${branch}`;

    const maxAttempts = 2; // initial attempt + at most one retry
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.fetchAndRebase(fetchRefspec, remoteRef);
      try {
        await this.run(['push', 'origin', pushRefspec]);
        return;
      } catch (err) {
        const message = (err as Error).message;
        // Only a non-fast-forward rejection is a race worth repeating: rebase
        // onto the freshly-advanced tip and push again. Anything else (auth,
        // network, a rejecting hook) fails closed immediately.
        if (attempt < maxAttempts && isNonFastForward(message)) continue;
        throw err;
      }
    }
  }

  /** Fetch the remote branch and replay HEAD onto it; abort + fail closed on conflict. */
  private async fetchAndRebase(fetchRefspec: string, remoteRef: string): Promise<void> {
    await this.run(['fetch', 'origin', fetchRefspec]);
    try {
      await this.run(['rebase', remoteRef]);
    } catch (err) {
      await this.abortRebase();
      throw new Error(
        `cannot rebase the dataset commit onto ${remoteRef} without force-pushing ` +
          `(a concurrent commit likely changed stars.json/dataset-meta.json); ` +
          `aborted to preserve the remote last-known-good: ${(err as Error).message}`,
      );
    }
  }

  /** Best-effort cleanup so a failed rebase never strands the work tree mid-rebase. */
  private async abortRebase(): Promise<void> {
    try {
      await this.run(['rebase', '--abort']);
    } catch {
      // No rebase in progress (the failure was not a conflict): nothing to undo.
    }
  }

  /**
   * Determine which remote branch HEAD should be published to. Explicit config
   * wins so the same exporter behaves identically across the production repo,
   * the template, and forks with a non-`main` default branch:
   *   1. STARLEDGER_PUBLISH_BRANCH (operator-set, e.g. from the workflow);
   *   2. GITHUB_REF_NAME (GitHub Actions provides the triggering branch);
   *   3. the checked-out branch, if not detached;
   *   4. else fail closed with an actionable message.
   */
  private async resolvePushBranch(): Promise<string> {
    const explicit = process.env.STARLEDGER_PUBLISH_BRANCH?.trim();
    if (explicit) return explicit;

    const ciBranch = process.env.GITHUB_REF_NAME?.trim();
    if (ciBranch) return ciBranch;

    try {
      const head = (await this.run(['symbolic-ref', '--short', 'HEAD'])).trim();
      if (head) return head;
    } catch {
      // Detached HEAD: `symbolic-ref` exits non-zero; fall through to error.
    }

    throw new Error(
      'cannot determine target branch to push: detached HEAD and neither ' +
        'STARLEDGER_PUBLISH_BRANCH nor GITHUB_REF_NAME is set. Set one, or run on a branch.',
    );
  }
}

/**
 * Whether a failed push was rejected because the remote advanced (a lost race),
 * as opposed to a terminal failure (auth, network, a declining hook). Matching
 * is fail-safe: an unrecognized message is treated as non-retryable.
 */
export function isNonFastForward(message: string): boolean {
  return /non-fast-forward|fetch first|\[rejected\]|tip of your current branch is behind|remote contains work that you do not have/i.test(
    message,
  );
}
