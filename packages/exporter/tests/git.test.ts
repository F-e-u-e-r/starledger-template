import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isNonFastForward, RealGitPublisher, redactGitOutput } from '../src/git';

/** Run git in `cwd`, returning trimmed stdout. */
function g(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A bare "remote" plus a work clone whose `main` is pushed and checked out. */
function initRepo(): { work: string; remote: string; c0: string } {
  const base = mkdtempSync(join(tmpdir(), 'stars-git-'));
  const remote = join(base, 'remote.git');
  const work = join(base, 'work');
  execFileSync('git', ['init', '--bare', remote]);
  // Cloning the freshly-init'd bare repo prints "warning: You appear to have
  // cloned an empty repository." to stderr even with --quiet; ignore it so the
  // test logs stay clean (a real clone failure still throws on non-zero exit).
  execFileSync('git', ['clone', '--quiet', remote, work], { stdio: 'ignore' });
  g(work, 'config', 'user.email', 'tester@example.com');
  g(work, 'config', 'user.name', 'Tester');
  writeFileSync(join(work, 'stars.json'), '{"repos":[]}\n');
  g(work, 'add', 'stars.json');
  g(work, 'commit', '--quiet', '-m', 'init');
  g(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  return { work, remote, c0: g(work, 'rev-parse', 'HEAD') };
}

/** Detach HEAD at `sha` and stage a new dataset commit (no push yet). */
function detachAndCommit(work: string, sha: string, content: string): void {
  g(work, 'checkout', '--quiet', '--detach', sha);
  writeFileSync(join(work, 'stars.json'), content);
  g(work, 'add', 'stars.json');
  g(work, 'commit', '--quiet', '-m', 'chore(data): update starred repositories');
}

describe('RealGitPublisher.push — detached-HEAD publication', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.STARLEDGER_PUBLISH_BRANCH;
    delete process.env.GITHUB_REF_NAME;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('publishes from detached HEAD to STARLEDGER_PUBLISH_BRANCH (the CI failure)', async () => {
    const { work, remote, c0 } = initRepo();
    detachAndCommit(work, c0, '{"repos":[{"node_id":"R_1"}]}\n');
    process.env.STARLEDGER_PUBLISH_BRANCH = 'main';

    await new RealGitPublisher(work).push();

    expect(g(remote, 'rev-parse', 'refs/heads/main')).toBe(g(work, 'rev-parse', 'HEAD'));
  });

  it('falls back to GITHUB_REF_NAME when no explicit branch is set', async () => {
    const { work, remote, c0 } = initRepo();
    detachAndCommit(work, c0, '{"repos":[{"node_id":"R_2"}]}\n');
    process.env.GITHUB_REF_NAME = 'main';

    await new RealGitPublisher(work).push();

    expect(g(remote, 'rev-parse', 'refs/heads/main')).toBe(g(work, 'rev-parse', 'HEAD'));
  });

  it('explicit STARLEDGER_PUBLISH_BRANCH wins over GITHUB_REF_NAME', async () => {
    const { work, remote, c0 } = initRepo();
    detachAndCommit(work, c0, '{"repos":[{"node_id":"R_3"}]}\n');
    process.env.STARLEDGER_PUBLISH_BRANCH = 'main';
    process.env.GITHUB_REF_NAME = 'does-not-exist';

    await new RealGitPublisher(work).push();

    expect(g(remote, 'rev-parse', 'refs/heads/main')).toBe(g(work, 'rev-parse', 'HEAD'));
    // The wrong branch was never created on the remote. Use `show-ref --verify
    // --quiet`, which exits non-zero SILENTLY for a missing ref, so the negative
    // assertion does not spew a git "ambiguous argument" fatal into the logs.
    expect(() =>
      g(remote, 'show-ref', '--verify', '--quiet', 'refs/heads/does-not-exist'),
    ).toThrow();
  });

  it('fails closed with an actionable message when the branch is unresolvable', async () => {
    const { work, c0 } = initRepo();
    detachAndCommit(work, c0, '{"repos":[{"node_id":"R_4"}]}\n');
    // Detached HEAD and neither env var set.
    await expect(new RealGitPublisher(work).push()).rejects.toThrow(
      /cannot determine target branch/,
    );
  });

  it('rebases the dataset commit onto an advanced remote and publishes (no conflict)', async () => {
    const { work, remote, c0 } = initRepo();
    // A concurrent commit advanced remote main, touching an UNRELATED file.
    writeFileSync(join(work, 'README.md'), '# advanced\n');
    g(work, 'add', 'README.md');
    g(work, 'commit', '--quiet', '-m', 'docs: advance remote');
    g(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
    const c1 = g(work, 'rev-parse', 'HEAD');

    // Our sync ran from the now-stale c0 checkout and produced a data commit.
    detachAndCommit(work, c0, '{"repos":[{"node_id":"FRESH"}]}\n');
    process.env.STARLEDGER_PUBLISH_BRANCH = 'main';

    await new RealGitPublisher(work).push();

    // Remote advanced to our rebased HEAD; the concurrent commit is preserved
    // (it is an ancestor) and both files coexist at the tip.
    expect(g(remote, 'rev-parse', 'refs/heads/main')).toBe(g(work, 'rev-parse', 'HEAD'));
    expect(() => g(work, 'merge-base', '--is-ancestor', c1, 'HEAD')).not.toThrow();
    expect(g(work, 'show', 'HEAD:README.md')).toContain('advanced');
    expect(g(work, 'show', 'HEAD:stars.json')).toContain('FRESH');
  });

  it('fails closed without force-pushing when a concurrent data commit conflicts', async () => {
    const { work, remote, c0 } = initRepo();
    // A concurrent run advanced remote main with ITS OWN stars.json (the conflict).
    writeFileSync(join(work, 'stars.json'), '{"repos":[{"node_id":"CONCURRENT"}]}\n');
    g(work, 'add', 'stars.json');
    g(work, 'commit', '--quiet', '-m', 'concurrent data commit');
    g(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
    const remoteTip = g(remote, 'rev-parse', 'refs/heads/main');

    // Our run, from the stale c0 checkout, produced a different dataset.
    detachAndCommit(work, c0, '{"repos":[{"node_id":"OURS"}]}\n');
    process.env.STARLEDGER_PUBLISH_BRANCH = 'main';

    const err = await new RealGitPublisher(work).push().then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    // Fail-closed messaging, and the underlying git conflict is surfaced (not swallowed).
    expect(err?.message).toMatch(/aborted to preserve the remote last-known-good/);
    expect(err?.message).toMatch(/conflict/i);

    // Remote last-known-good is untouched (no force-push) and the aborted rebase
    // left the work tree clean.
    expect(g(remote, 'rev-parse', 'refs/heads/main')).toBe(remoteTip);
    expect(g(work, 'status', '--porcelain')).toBe('');
  });
});

/**
 * The fetch→rebase→push retry control flow, exercised through the injected git
 * executor. A genuine non-fast-forward-then-success race is impractical to stage
 * against a real remote, so we drive the executor's responses directly.
 */
describe('RealGitPublisher.push — non-fast-forward retry', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.GITHUB_REF_NAME;
    process.env.STARLEDGER_PUBLISH_BRANCH = 'main';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const rejected = (): Error =>
    new Error(
      'git push origin HEAD:refs/heads/main failed: ! [rejected] main -> main (fetch first)\n' +
        'error: failed to push some refs to origin',
    );

  it('retries once when the push is rejected non-fast-forward, then succeeds', async () => {
    const verbs: string[] = [];
    let pushes = 0;
    const run = async (args: readonly string[]): Promise<string> => {
      verbs.push(args[0] ?? '');
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw rejected();
      }
      return '';
    };

    await new RealGitPublisher('/unused', run).push();

    // Exactly one retry: two full fetch→rebase→push cycles.
    expect(verbs).toEqual(['fetch', 'rebase', 'push', 'fetch', 'rebase', 'push']);
    expect(pushes).toBe(2);
  });

  it('fails closed after a single retry when the push keeps being rejected', async () => {
    let pushes = 0;
    const run = async (args: readonly string[]): Promise<string> => {
      if (args[0] === 'push') {
        pushes += 1;
        throw rejected();
      }
      return '';
    };

    await expect(new RealGitPublisher('/unused', run).push()).rejects.toThrow(
      /rejected|fetch first/i,
    );
    expect(pushes).toBe(2); // initial + one retry, then give up — never an unbounded loop
  });

  it('does not retry a non-race push failure (fails closed immediately)', async () => {
    let pushes = 0;
    const run = async (args: readonly string[]): Promise<string> => {
      if (args[0] === 'push') {
        pushes += 1;
        throw new Error(
          'git push origin HEAD:refs/heads/main failed: fatal: Authentication failed',
        );
      }
      return '';
    };

    await expect(new RealGitPublisher('/unused', run).push()).rejects.toThrow(
      /Authentication failed/,
    );
    expect(pushes).toBe(1); // an auth failure is not a lost race; do not retry
  });

  it('never issues a force push or --force-with-lease', async () => {
    const seen: string[][] = [];
    const run = async (args: readonly string[]): Promise<string> => {
      seen.push([...args]);
      return '';
    };

    await new RealGitPublisher('/unused', run).push();

    const flat = seen.flat();
    expect(flat).not.toContain('--force');
    expect(flat).not.toContain('-f');
    expect(flat.some((a) => a.startsWith('--force-with-lease'))).toBe(false);
  });
});

describe('isNonFastForward', () => {
  it.each([
    '! [rejected]        main -> main (fetch first)',
    '! [rejected]        main -> main (non-fast-forward)',
    'Updates were rejected because the remote contains work that you do not have locally.',
    'Updates were rejected because the tip of your current branch is behind its remote counterpart.',
  ])('classifies a lost-race rejection as retryable: %s', (msg) => {
    expect(isNonFastForward(msg)).toBe(true);
  });

  it.each(['fatal: Authentication failed', 'fatal: unable to access', 'pre-receive hook declined'])(
    'treats a non-race failure as terminal: %s',
    (msg) => {
      expect(isNonFastForward(msg)).toBe(false);
    },
  );
});

describe('redactGitOutput', () => {
  it('strips embedded credentials from remote URLs', () => {
    expect(
      redactGitOutput(
        "fatal: unable to access 'https://x-access-token:ghs_SECRET@github.com/o/r.git/'",
      ),
    ).toBe("fatal: unable to access 'https://***@github.com/o/r.git/'");
  });

  it('leaves credential-free output unchanged', () => {
    expect(redactGitOutput('fatal: You are not currently on a branch')).toBe(
      'fatal: You are not currently on a branch',
    );
  });
});
