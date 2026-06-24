import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface SaveResult {
  /** The serialized state differed from the remote's last-known-good. */
  changed: boolean;
  /** A commit object was created. */
  committed: boolean;
  /** The commit reached the remote. `false` ⇒ the remote is unchanged. */
  pushed: boolean;
}

/**
 * Persistence boundary for the notifier state. The store deals in raw bytes;
 * schema validation lives in the caller (`loadState`), so a schema-invalid
 * remote document is never silently repaired — the caller defers and keeps the
 * last-known-good.
 */
export interface StateStore {
  /** Last-known-good state bytes, or null if no state has ever been persisted. */
  load(): Promise<string | null>;
  /** Validate-before-replace is the caller's job; this writes ONE commit + push. */
  save(bytes: string, message: string): Promise<SaveResult>;
}

export interface GitStateStoreOptions {
  branch?: string;
  file?: string;
  remote?: string;
}

/**
 * Git-backed state store targeting a dedicated branch (default
 * `starledger-state`). It commits via plumbing — `hash-object` → `write-tree`
 * (atop the previous tree, preserving any other files on the branch) →
 * `commit-tree` → `push <sha>:refs/heads/<branch>` — so it NEVER checks out a
 * worktree, touches HEAD, or disturbs the working tree of the main checkout.
 *
 * Safety properties (mirroring the exporter's publish discipline):
 *   - commit-on-change: identical serialized bytes ⇒ identical blob ⇒ no commit;
 *   - a push failure (incl. non-fast-forward from a concurrent writer) leaves the
 *     remote branch unchanged and reports `pushed:false`;
 *   - a transient remote/network error during `load` THROWS rather than being
 *     mistaken for "branch absent" — otherwise a flaky network would look like a
 *     cold start and overwrite good remote state with a re-baseline.
 *
 * Requires a configured git identity (`user.name`/`user.email`) in `cwd`, exactly
 * as the exporter's commit step does.
 */
export class GitStateStore implements StateStore {
  private readonly branch: string;
  private readonly file: string;
  private readonly remote: string;

  constructor(
    private readonly cwd: string,
    opts: GitStateStoreOptions = {},
  ) {
    this.branch = opts.branch ?? 'starledger-state';
    this.file = opts.file ?? 'notifier-state.json';
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

    const tmp = mkdtempSync(join(tmpdir(), 'notifier-state-'));
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
