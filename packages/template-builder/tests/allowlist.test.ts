import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isExcluded } from '../src/allowlist';

describe('isExcluded', () => {
  it('excludes personal root artifacts', () => {
    for (const f of [
      'stars.json',
      'dataset-meta.json',
      'ai-annotations.json',
      'ai-annotations-meta.json',
    ]) {
      expect(isExcluded(f)).toBe(true);
    }
  });

  it('excludes live config but keeps examples', () => {
    expect(isExcluded(join('config', 'ai.yaml'))).toBe(true);
    expect(isExcluded(join('config', 'notifier.yaml'))).toBe(true);
    expect(isExcluded(join('config', 'ai.example.yaml'))).toBe(false);
    expect(isExcluded(join('config', 'template.example.yaml'))).toBe(false);
    // The root exporter example is not under config/ and must not be caught.
    expect(isExcluded('config.example.yaml')).toBe(false);
  });

  it('excludes build output and editor/OS noise anywhere', () => {
    expect(isExcluded(join('packages', 'x', 'dist', 'cli.js'))).toBe(true);
    expect(isExcluded(join('apps', 'dashboard', 'node_modules', 'y.js'))).toBe(true);
    expect(isExcluded(join('apps', 'dashboard', '.vite', 'deps', 'z.js'))).toBe(true);
    expect(isExcluded(join('docs', '.P3.2-executor-runbook.md.swp'))).toBe(true);
    expect(isExcluded('packages/x/tsconfig.tsbuildinfo')).toBe(true);
    expect(isExcluded(join('apps', 'dashboard', '.env.local'))).toBe(true);
    expect(isExcluded(join('packages', 'notifier', 'notifier-state.json'))).toBe(true);
    expect(isExcluded(join('packages', 'classifier', 'classifier-state.json'))).toBe(true);
  });

  it('keeps real source, schemas, workflows, prompts', () => {
    expect(isExcluded(join('packages', 'exporter', 'src', 'index.ts'))).toBe(false);
    expect(isExcluded(join('schemas', 'stars.schema.json'))).toBe(false);
    expect(isExcluded(join('.github', 'workflows', 'ci.yml'))).toBe(false);
    expect(isExcluded(join('prompts', 'classify-agent-v1.md'))).toBe(false);
  });
});
