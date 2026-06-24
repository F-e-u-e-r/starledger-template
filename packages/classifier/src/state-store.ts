import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * The dedicated branch + file for classifier operational state, kept distinct
 * from the notifier's `starledger-state` / `notifier-state.json` so the two
 * writers can never collide on one ref (STATE-3).
 */
export const CLASSIFIER_STATE_BRANCH = 'starledger-ai-state';
export const CLASSIFIER_STATE_FILE = 'classifier-state.json';

export interface SaveResult {
  /** The serialized state differed from the remote's last-known-good. */
  changed: boolean;
  /** A commit object was created. */
  committed: boolean;
  /** The commit reached the remote. `false` ⇒ the remote is unchanged. */
  pushed: boolean;
}

/**
 * Persistence boundary for the classifier state. The store deals in raw bytes;
 * schema validation lives in the caller (`loadClassifierState`), so a
 * schema-invalid remote document is never silently repaired — the caller keeps
 * the last-known-good (STATE-2).
 */
export interface StateStore {
  /** Last-known-good state bytes, or null if no state has ever been persisted. */
  load(): Promise<string | null>;
  /** Validate-before-replace is the caller's job; this writes ONE commit + push. */
  save(bytes: string, message: string): Promise<SaveResult>;
}

export interface GitClassifierStateStoreOptions {
  branch?: string;
  file?: string;
  remote?: string;
}

/**
 * Git-backed classifier state store. It mirrors the notifier's `GitStateStore`
 * plumbing — `hash-object` → `read-tree` (atop the previous tree) →
 * `update-index` → `write-tree` → `commit-tree` → `push <sha>:refs/heads/<branch>`
 * — so it NEVER checks out a worktree, touches HEAD, or disturbs the working
 * tree, and it preserves any other file on the branch.
 *
 * Safety properties:
 *   - commit-on-change: identical serialized bytes ⇒ identical blob ⇒ no commit;
 *   - a push failure (incl. non-fast-forward from a concurrent writer) leaves the
 *     remote branch unchanged and reports `pushed:false`;
 *   - a transient remote/network error during `load` THROWS rather than being
 *     mistaken for "branch absent", so a flaky network never looks like a cold
 *     start and re-baselines good remote state.
 *
 * NOTE: this deliberately duplicates the notifier store to keep P3.1 a
 * self-contained unit that does not modify the shipped P2 package. A future
 * refactor can extract a shared `GitFileStateStore`.
 */
export class GitClassifierStateStore implements StateStore {
  private readonly branch: string;
  private readonly file: string;
  private readonly remote: string;

  constructor(
    private readonly cwd: string,
    opts: GitClassifierStateStoreOptions = {},
  ) {
    this.branch = opts.branch ?? CLASSIFIER_STATE_BRANCH;
    this.file = opts.file ?? CLASSIFIER_STATE_FILE;
    this.remote = opts.remote ?? 'origin';
  }

  private git(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ stdout: string }> {
    return exec('git', args, { cwd: this.cwd, env, maxBuffer: 64 * 1024 * 1024 });
  }

  private async tryGit(args: string[]): Promise<{ ok: boolean; stdout: string }> {
    try {
      const { stdout } = await this.git(args);
      return { ok: true, stdout };
    } catch {
      return { ok: false, stdout: '' };
    }
  }

  /** Throws on a remote/transport error; only returns false on a clean "no such branch". */
  private async remoteBranchExists(): Promise<boolean> {
    const { stdout } = await this.git(['ls-remote', '--heads', this.remote, this.branch]);
    return stdout.trim().length > 0;
  }

  async load(): Promise<string | null> {
    if (!(await this.remoteBranchExists())) return null;
    await this.git(['fetch', this.remote, this.branch]);
    const show = await this.tryGit(['show', `FETCH_HEAD:${this.file}`]);
    return show.ok ? show.stdout : null; // branch exists but file absent ⇒ cold start
  }

  async save(bytes: string, message: string): Promise<SaveResult> {
    let parent: string | null = null;
    let previousBlob: string | null = null;
    if (await this.remoteBranchExists()) {
      await this.git(['fetch', this.remote, this.branch]);
      parent = (await this.git(['rev-parse', 'FETCH_HEAD'])).stdout.trim();
      const prev = await this.tryGit(['rev-parse', `FETCH_HEAD:${this.file}`]);
      previousBlob = prev.ok ? prev.stdout.trim() : null;
    }

    const tmp = mkdtempSync(join(tmpdir(), 'classifier-state-'));
    const blobFile = join(tmp, 'blob');
    const indexFile = join(tmp, 'index');
    try {
      writeFileSync(blobFile, bytes);
      const blob = (await this.git(['hash-object', '-w', '--', blobFile])).stdout.trim();

      // commit-on-change: identical content ⇒ identical blob ⇒ nothing to do.
      if (previousBlob !== null && previousBlob === blob) {
        return { changed: false, committed: false, pushed: false };
      }

      const env = { ...process.env, GIT_INDEX_FILE: indexFile };
      if (parent) await this.git(['read-tree', parent], env); // preserve other files on the branch
      await this.git(['update-index', '--add', '--cacheinfo', `100644,${blob},${this.file}`], env);
      const tree = (await this.git(['write-tree'], env)).stdout.trim();

      const commitArgs = ['commit-tree', tree, '-m', message];
      if (parent) commitArgs.push('-p', parent);
      const commit = (await this.git(commitArgs)).stdout.trim();

      try {
        await this.git(['push', this.remote, `${commit}:refs/heads/${this.branch}`]);
      } catch {
        return { changed: true, committed: true, pushed: false }; // remote unchanged
      }
      return { changed: true, committed: true, pushed: true };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}
