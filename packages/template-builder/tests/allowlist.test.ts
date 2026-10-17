import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOW_FILES, isExcluded } from '../src/allowlist';

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

  it('excludes skills classification artifacts even under an allowed directory (defense-in-depth)', () => {
    // These owner/generated artifacts live at the repo root today, where the
    // file-by-file ALLOW_FILES list already keeps them out. The basename deny is
    // defense-in-depth: if a future allowlist change ever places one under an
    // allowed directory, the exclusion must still outrank the directory allow.
    for (const base of [
      'skills-classification.json',
      'skills-classification-meta.json',
      'skills-classified.md',
    ]) {
      expect(isExcluded(base)).toBe(true); // bare root form
      expect(isExcluded(join('docs', base))).toBe(true); // under an allowed dir
      expect(isExcluded(join('apps', 'dashboard', 'src', 'data', base))).toBe(true);
    }
    // Sibling files that legitimately ship must NOT be caught by the new rule.
    expect(isExcluded(join('schemas', 'skills-classification.schema.json'))).toBe(false);
    expect(isExcluded(join('schemas', 'skills-classification-meta.schema.json'))).toBe(false);
    expect(
      isExcluded(join('apps', 'dashboard', 'src', 'data', 'load-skills-classification.ts')),
    ).toBe(false);
    expect(
      isExcluded(join('apps', 'dashboard', 'src', 'data', 'use-skills-classification.ts')),
    ).toBe(false);
  });

  it('never allow-lists an excluded root file (deny outranks a positive allow decision)', () => {
    // The root-file loop vetoes via isExcluded, so the deny outranks a positive
    // allow decision. No ALLOW_FILES entry may be excluded, or that veto would
    // silently drop a legitimate root file; this guards the whole predicate, not
    // just EXCLUDE_BASENAMES, and fail-closes a mistaken allow-listing.
    for (const f of ALLOW_FILES) {
      expect(isExcluded(f)).toBe(false);
    }
  });

  it('excludes local review drafts under docs/reviews/ (anchored, not a bare segment)', () => {
    // docs/reviews/ is gitignored local code-review scratch; the builder walks the
    // filesystem, so it needs an explicit veto. The rule is anchored to docs/reviews
    // so a legitimate `reviews/` directory elsewhere in the tree still ships.
    expect(isExcluded(join('docs', 'reviews', 'local-review.md'))).toBe(true);
    expect(isExcluded(join('docs', 'reviews', 'nested', 'deep.md'))).toBe(true);
    // Sibling docs and the inventory specs continue to ship.
    expect(isExcluded(join('docs', 'public-guide.md'))).toBe(false);
    expect(isExcluded(join('docs', 'P4-template-spec.md'))).toBe(false);
    // Narrowness: a `reviews` segment outside docs/ is NOT excluded (no overbreadth).
    expect(isExcluded(join('packages', 'x', 'reviews', 'data.json'))).toBe(false);
    expect(isExcluded(join('apps', 'dashboard', 'src', 'reviews', 'Panel.tsx'))).toBe(false);
    // A file literally named reviews.md under docs/ is not the reviews directory.
    expect(isExcluded(join('docs', 'reviews.md'))).toBe(false);
  });
});
