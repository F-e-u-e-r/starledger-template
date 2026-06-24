import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
} from '@starred/ai-schema';
import { describe, expect, it } from 'vitest';
import {
  AgentGateError,
  type AgentPullRequestContext,
  verifyAgentPullRequest,
  verifyAgentPullRequestFromGit,
} from '../src/agent-gate';
import type { GitDiffEntry } from '../src/verify-diff';

const REPO = 'F-e-u-e-r/starledger';

function validArtifactPair(): { annotations: string; meta: string } {
  const annotations = serializeAnnotations([]);
  const meta = serializeAiAnnotationsMeta(
    buildAiAnnotationsMeta({
      annotationsBytes: annotations,
      annotationCount: 0,
      datasetSha256: 'd'.repeat(64),
      generatedAt: '2026-06-20T00:00:00Z',
    }),
  );
  return { annotations, meta };
}

const PAIR = validArtifactPair();
const readValid = (path: string): string =>
  path === 'ai-annotations.json' ? PAIR.annotations : PAIR.meta;
const readNever = (): string => {
  throw new Error('readArtifact must not be called');
};

const ARTIFACT_PAIR_ADD: GitDiffEntry[] = [
  { status: 'A', path: 'ai-annotations.json' },
  { status: 'A', path: 'ai-annotations-meta.json' },
];
const SOURCE_ONLY: GitDiffEntry[] = [{ status: 'M', path: 'packages/classifier/src/cli.ts' }];

function context(overrides: Partial<AgentPullRequestContext> = {}): AgentPullRequestContext {
  return {
    headBranch: 'claude/p3-run-1',
    headRepo: REPO,
    repo: REPO,
    entries: ARTIFACT_PAIR_ADD,
    readArtifact: readValid,
    ...overrides,
  };
}

describe('verifyAgentPullRequest — path-triggered, branch-identified', () => {
  it('GATE-5: a source-only PR is not gated and never reads artifacts', () => {
    const result = verifyAgentPullRequest(
      context({ headBranch: 'feature/anything', entries: SOURCE_ONLY, readArtifact: readNever }),
    );
    expect(result.touched).toBe(false);
  });

  it('GATE-6: a claude/* branch changing only the valid artifact pair passes', () => {
    expect(verifyAgentPullRequest(context({ headBranch: 'claude/run' })).touched).toBe(true);
  });

  it('GATE-7: a codex/* branch changing only the valid artifact pair passes', () => {
    expect(verifyAgentPullRequest(context({ headBranch: 'codex/run' })).touched).toBe(true);
  });

  it('GATE-8: an artifact change on a non-approved branch FAILS instead of being skipped', () => {
    expect(() => verifyAgentPullRequest(context({ headBranch: 'ai/sneaky' }))).toThrow(
      AgentGateError,
    );
    expect(() => verifyAgentPullRequest(context({ headBranch: 'main' }))).toThrow(AgentGateError);
  });

  it('GATE-9: an approved branch changing artifacts PLUS source fails the path allowlist', () => {
    expect(() =>
      verifyAgentPullRequest(
        context({ entries: [...ARTIFACT_PAIR_ADD, { status: 'M', path: 'stars.json' }] }),
      ),
    ).toThrow();
  });

  it('GATE-10: a fork (or absent fork) changing artifacts fails same-repository enforcement', () => {
    expect(() => verifyAgentPullRequest(context({ headRepo: 'attacker/starledger' }))).toThrow(
      AgentGateError,
    );
    expect(() => verifyAgentPullRequest(context({ headRepo: '' }))).toThrow(AgentGateError);
  });

  it('GATE-11: deleting an artifact is rejected regardless of branch name', () => {
    const del: GitDiffEntry[] = [{ status: 'D', path: 'ai-annotations.json' }];
    expect(() => verifyAgentPullRequest(context({ entries: del }))).toThrow();
    expect(() =>
      verifyAgentPullRequest(context({ entries: del, headBranch: 'feature/x' })),
    ).toThrow(AgentGateError);
  });

  it('rejects a touched artifact whose bytes fail the schema/hash check', () => {
    expect(() =>
      verifyAgentPullRequest(context({ readArtifact: () => '{"not":"valid"}' })),
    ).toThrow();
  });
});

// --- git-backed wrapper: proves the changed-paths + read-as-data wiring ---

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function initRepo(): { repo: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), 'starledger-agent-pr-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'StarLedger Test']);
  git(repo, ['config', 'user.email', 'starledger-test@example.com']);
  git(repo, ['commit', '--allow-empty', '-m', 'base']);
  return { repo, base: git(repo, ['rev-parse', 'HEAD']) };
}

describe('verifyAgentPullRequestFromGit — real Git', () => {
  it('passes an approved same-repo branch that adds a valid artifact pair', () => {
    const { repo, base } = initRepo();
    try {
      writeFileSync(join(repo, 'ai-annotations.json'), PAIR.annotations, 'utf8');
      writeFileSync(join(repo, 'ai-annotations-meta.json'), PAIR.meta, 'utf8');
      git(repo, ['add', 'ai-annotations.json', 'ai-annotations-meta.json']);
      git(repo, ['commit', '-m', 'agent artifacts']);
      const result = verifyAgentPullRequestFromGit({
        baseRef: base,
        headGitRef: 'HEAD',
        headBranch: 'claude/p3-run',
        headRepo: REPO,
        repo: REPO,
        cwd: repo,
      });
      expect(result.touched).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('passes a source-only change without requiring executor identity', () => {
    const { repo, base } = initRepo();
    try {
      writeFileSync(join(repo, 'README.md'), 'docs change\n', 'utf8');
      git(repo, ['add', 'README.md']);
      git(repo, ['commit', '-m', 'docs']);
      const result = verifyAgentPullRequestFromGit({
        baseRef: base,
        headGitRef: 'HEAD',
        headBranch: 'feature/docs',
        headRepo: 'somebody/fork',
        repo: REPO,
        cwd: repo,
      });
      expect(result.touched).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
