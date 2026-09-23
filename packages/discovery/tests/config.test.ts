import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDiscoveryDecisions, loadDiscoveryInboxConfig } from '../src/config';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(process.env.RUNNER_TEMP ?? '/tmp', `discovery-config-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadDiscoveryInboxConfig', () => {
  it('returns defaults when file does not exist', () => {
    const config = loadDiscoveryInboxConfig(join(tmpDir, 'nope.yaml'));
    expect(config.manual).toEqual([]);
  });

  it('parses valid manual entries', () => {
    const yaml = `
manual:
  - url: https://github.com/owner/repo
    note: some note
  - url: https://github.com/other/thing
`;
    writeFileSync(join(tmpDir, 'inbox.yaml'), yaml);
    const config = loadDiscoveryInboxConfig(join(tmpDir, 'inbox.yaml'));
    expect(config.manual).toHaveLength(2);
    expect(config.manual[0]!.url).toBe('https://github.com/owner/repo');
    expect(config.manual[0]!.note).toBe('some note');
    expect(config.manual[1]!.note).toBeUndefined();
  });

  it('rejects unknown fields', () => {
    const yaml = `
manual:
  - url: https://github.com/foo/bar
    unknown_field: bad
`;
    writeFileSync(join(tmpDir, 'bad.yaml'), yaml);
    expect(() => loadDiscoveryInboxConfig(join(tmpDir, 'bad.yaml'))).toThrow();
  });
});

describe('loadDiscoveryDecisions', () => {
  it('returns empty maps when file does not exist', () => {
    const decisions = loadDiscoveryDecisions(join(tmpDir, 'nope.yaml'));
    expect(decisions.dismissed.size).toBe(0);
    expect(decisions.promoted.size).toBe(0);
  });

  it('parses decisions and lowercases repo names', () => {
    const yaml = `
dismissed:
  - repo: Octocat/Hello-World
    reason: fixture
promoted:
  - repo: ActualBudget/Actual
    reason: worth reviewing
`;
    writeFileSync(join(tmpDir, 'decisions.yaml'), yaml);
    const decisions = loadDiscoveryDecisions(join(tmpDir, 'decisions.yaml'));
    expect(decisions.dismissed.has('octocat/hello-world')).toBe(true);
    expect(decisions.dismissed.get('octocat/hello-world')).toBe('fixture');
    expect(decisions.promoted.has('actualbudget/actual')).toBe(true);
  });
});
