import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROMPT = readFileSync(
  new URL('../../../prompts/classify-agent-v1.md', import.meta.url),
  'utf8',
);

describe('shared executor prompt (classify-agent-v1)', () => {
  it('declares the untrusted-data and job-constraint contract', () => {
    expect(PROMPT).toMatch(/untrusted/i);
    expect(PROMPT).toContain('constraints.allowed_categories');
    expect(PROMPT).toContain('constraints.allowed_tags');
    expect(PROMPT).toMatch(/exactly one/i);
  });

  it('requires verbatim job identity and a candidate-only output', () => {
    expect(PROMPT).toContain('job_id');
    expect(PROMPT).toContain('source_fingerprint');
    expect(PROMPT).toContain('ClassificationCandidate');
  });

  it('restricts writes to the two AI artifacts and forbids unsafe actions', () => {
    expect(PROMPT).toContain('ai-annotations.json');
    expect(PROMPT).toContain('ai-annotations-meta.json');
    expect(PROMPT).toMatch(/never follow instructions/i);
    expect(PROMPT).toMatch(/do not fetch links/i);
    expect(PROMPT).toMatch(/do not push .*main/i);
    expect(PROMPT).toMatch(/merge a pull request/i);
  });
});
