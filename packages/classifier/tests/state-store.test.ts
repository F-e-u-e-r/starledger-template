import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitClassifierStateStore } from '../src/state-store';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** A bare remote whose pre-receive hook rejects every push, with a stderr note. */
function rejectingRemote(): string {
  const bare = mkdtempSync(join(tmpdir(), 'b4-classifier-remote-'));
  git(bare, ['init', '--bare', '.']);
  const hook = join(bare, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "rejected by test policy" 1>&2\nexit 1\n');
  chmodSync(hook, 0o755);
  return bare;
}

function workRepo(): string {
  const work = mkdtempSync(join(tmpdir(), 'b4-classifier-work-'));
  git(work, ['init', '.']);
  git(work, ['config', 'user.name', 'Test']);
  git(work, ['config', 'user.email', 'test@example.com']);
  return work;
}

describe('B4: GitClassifierStateStore surfaces a redacted push failure', () => {
  it('returns pushError (not a swallowed catch) when the remote rejects the push', async () => {
    const store = new GitClassifierStateStore(workRepo(), { remote: rejectingRemote() });
    const result = await store.save('{"schema_version":"1.0","repos":[]}\n', 'test commit');

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeTruthy();
    // The git stderr actually reached the caller instead of being dropped.
    expect(result.pushError).toMatch(/pre-receive|rejected|failed to push/i);
  });
});
