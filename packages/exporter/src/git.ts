import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

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
  constructor(private readonly cwd: string) {}

  async commit(files: readonly string[], message: string): Promise<void> {
    await exec('git', ['add', '--', ...files], { cwd: this.cwd });
    await exec('git', ['commit', '-m', message], { cwd: this.cwd });
  }

  async push(): Promise<void> {
    await exec('git', ['push'], { cwd: this.cwd });
  }
}
