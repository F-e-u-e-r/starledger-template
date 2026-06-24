import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('P3 structural agent gate', () => {
  it('GATE-1: the workflow never checks out or executes agent-controlled code', () => {
    const workflow = readRepoFile('.github/workflows/ai-agent-pr.yml');
    expect(workflow).toContain('pull_request_target:');
    expect(workflow).toContain('ref: ${{ github.event.pull_request.base.sha }}');
    expect(workflow).toContain('refs/pull/${{ github.event.pull_request.number }}/head');
    expect(workflow).not.toContain('ref: ${{ github.event.pull_request.head');
  });

  it('GATE-2: the workflow has no secrets and only read-only contents permission', () => {
    const workflow = readRepoFile('.github/workflows/ai-agent-pr.yml');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toContain('secrets.');
  });

  it('GATE-3: the P3 spec describes the current gate as structural, not provenance validation', () => {
    const spec = readRepoFile('docs/P3-ai-spec.md');
    expect(spec).toMatch(/trusted structural\s+artifact gate/);
    expect(spec).toContain('does not prove classification provenance');
  });

  it('GATE-4: no scheduled Routine/Codex classifier workflow exists in P3.0', () => {
    expect(existsSync(resolve(root, '.github/workflows/classify.yml'))).toBe(false);
    expect(readRepoFile('.github/workflows/ai-agent-pr.yml')).not.toContain('schedule:');
  });

  it('FORMAT-1: deterministic AI artifacts are not rewritten by Prettier', () => {
    const ignored = readRepoFile('.prettierignore');
    expect(ignored).toMatch(/(^|\n)ai-annotations\.json(?:\n|$)/);
    expect(ignored).toMatch(/(^|\n)ai-annotations-meta\.json(?:\n|$)/);
  });

  it('GATE-13: the gate is path-triggered — no job-level branch condition, and it runs verify-agent-pr', () => {
    const raw = readRepoFile('.github/workflows/ai-agent-pr.yml');
    // The original bypass was a job-level branch-prefix `if:`. Guard it from returning.
    expect(raw).not.toContain('startsWith(github.event.pull_request.head.ref');
    const workflow = parseYaml(raw) as { jobs: Record<string, { if?: unknown } | undefined> };
    expect(workflow.jobs['verify-agent-artifacts']).toBeDefined();
    expect(workflow.jobs['verify-agent-artifacts']?.if).toBeUndefined();
    // The job must invoke the trusted, path-triggered gate command.
    expect(raw).toContain('verify-agent-pr');
  });

  it('PROV-GATE: the provenance workflow is base-checked-out, head-as-data, and runs verify-ai-provenance', () => {
    const raw = readRepoFile('.github/workflows/ai-provenance.yml');
    expect(raw).toContain('pull_request_target:');
    expect(raw).toContain('ref: ${{ github.event.pull_request.base.sha }}');
    expect(raw).toContain('refs/pull/${{ github.event.pull_request.number }}/head');
    expect(raw).not.toContain('ref: ${{ github.event.pull_request.head');
    expect(raw).toContain('permissions:\n  contents: read');
    expect(raw).toContain('verify-ai-provenance');
  });

  it('STATE-GATE: operational state is written by a trusted workflow, never by a PR-exposed one', () => {
    const raw = readRepoFile('.github/workflows/ai-state.yml');
    // Trusted: runs from the default branch on a schedule, never pull_request(_target).
    expect(raw).not.toContain('pull_request');
    expect(raw).toContain('schedule:');
    expect(raw).toContain('contents: write');
    // It writes state via the deterministic planner, not an executor.
    expect(raw).toContain('classifier/src/cli.ts plan');
    expect(raw).toContain('--save-state');
  });
});
