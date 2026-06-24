import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentDiffError,
  changedPathEntriesBetween,
  changedPathsBetween,
  verifyAgentDiffEntries,
  verifyAgentDiffPaths,
} from '../src/verify-diff';

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function initRepo(withArtifacts = false): { repo: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), 'starledger-agent-diff-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'StarLedger Test']);
  git(repo, ['config', 'user.email', 'starledger-test@example.com']);
  if (withArtifacts) {
    writeArtifacts(repo, 'base');
    git(repo, ['add', 'ai-annotations.json', 'ai-annotations-meta.json']);
  }
  git(repo, ['commit', '--allow-empty', '-m', 'base']);
  return { repo, base: git(repo, ['rev-parse', 'HEAD']) };
}

function writeArtifacts(repo: string, value: string): void {
  writeFileSync(join(repo, 'ai-annotations.json'), `${value}-annotations\n`, 'utf8');
  writeFileSync(join(repo, 'ai-annotations-meta.json'), `${value}-meta\n`, 'utf8');
}

describe('agent diff allowlist', () => {
  it('DIFF-1: accepts only the two public AI artifact paths', () => {
    expect(() => {
      verifyAgentDiffPaths(['ai-annotations.json', 'ai-annotations-meta.json']);
    }).not.toThrow();
  });

  it('DIFF-2/DIFF-3: rejects canonical datasets, source, workflow, and configuration changes', () => {
    for (const path of [
      'stars.json',
      'dataset-meta.json',
      'packages/classifier/src/cli.ts',
      '.github/workflows/classify.yml',
      'config/ai.yaml',
      '../ai-annotations.json',
    ]) {
      expect(() => verifyAgentDiffPaths([path])).toThrow(AgentDiffError);
    }
  });

  it('DIFF-4: artifact pair add is allowed', () => {
    const { repo, base } = initRepo();
    writeArtifacts(repo, 'head');
    git(repo, ['add', 'ai-annotations.json', 'ai-annotations-meta.json']);
    git(repo, ['commit', '-m', 'agent artifacts']);
    const allowedPaths = changedPathsBetween(base, 'HEAD', repo);
    expect(allowedPaths.sort()).toEqual(['ai-annotations-meta.json', 'ai-annotations.json']);
    expect(() =>
      verifyAgentDiffEntries(changedPathEntriesBetween(base, 'HEAD', repo)),
    ).not.toThrow();
  });

  it('DIFF-5: artifact pair update is allowed', () => {
    const { repo, base } = initRepo(true);
    writeArtifacts(repo, 'updated');
    git(repo, ['add', 'ai-annotations.json', 'ai-annotations-meta.json']);
    git(repo, ['commit', '-m', 'agent artifact update']);
    expect(() =>
      verifyAgentDiffEntries(changedPathEntriesBetween(base, 'HEAD', repo)),
    ).not.toThrow();
  });

  it('DIFF-6: deleting one artifact is rejected', () => {
    const { repo, base } = initRepo(true);
    git(repo, ['rm', 'ai-annotations.json']);
    git(repo, ['commit', '-m', 'delete one artifact']);
    expect(() => verifyAgentDiffEntries(changedPathEntriesBetween(base, 'HEAD', repo))).toThrow(
      AgentDiffError,
    );
  });

  it('DIFF-7: deleting both artifacts is rejected', () => {
    const { repo, base } = initRepo(true);
    git(repo, ['rm', 'ai-annotations.json', 'ai-annotations-meta.json']);
    git(repo, ['commit', '-m', 'delete both artifacts']);
    expect(() => verifyAgentDiffEntries(changedPathEntriesBetween(base, 'HEAD', repo))).toThrow(
      AgentDiffError,
    );
  });

  it('DIFF-8: renaming an artifact is rejected', () => {
    const { repo, base } = initRepo(true);
    git(repo, ['mv', 'ai-annotations.json', 'ai-annotations-renamed.json']);
    git(repo, ['commit', '-m', 'rename artifact']);
    expect(() => verifyAgentDiffEntries(changedPathEntriesBetween(base, 'HEAD', repo))).toThrow(
      AgentDiffError,
    );
  });
});
