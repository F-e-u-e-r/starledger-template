import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUnpinnedActionRefs } from '../src/workflows';

const SHA = '93cb6efe18208431cddfb8368fd83d5badbf9bfd';

describe('findUnpinnedActionRefs (S4, YAML-aware)', () => {
  it('accepts a 40-hex SHA-pinned ref (tag comment ignored)', () => {
    const wf = `jobs:
  build:
    steps:
      - uses: actions/checkout@${SHA} # v5
`;
    expect(findUnpinnedActionRefs(wf)).toEqual([]);
  });

  it('reports a mutable tag and a branch ref, across block and step forms', () => {
    const wf = `jobs:
  build:
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@main
      - uses: pnpm/action-setup@${SHA} # v6
`;
    expect(findUnpinnedActionRefs(wf).sort()).toEqual([
      'actions/checkout@v5',
      'actions/setup-node@main',
    ]);
  });

  it('catches quoted keys, quoted values, and flow-mapping forms', () => {
    const wf = `jobs:
  a:
    steps:
      - "uses": actions/checkout@v5
      - uses: "actions/setup-node@v5"
      - { uses: actions/upload-artifact@v4 }
`;
    expect(findUnpinnedActionRefs(wf).sort()).toEqual([
      'actions/checkout@v5',
      'actions/setup-node@v5',
      'actions/upload-artifact@v4',
    ]);
  });

  it('does NOT flag a pinned ref that is quoted (quotes are stripped by parsing)', () => {
    const wf = `jobs:
  a:
    steps:
      - uses: "actions/checkout@${SHA}"
`;
    expect(findUnpinnedActionRefs(wf)).toEqual([]);
  });

  it('ignores action-ref text inside a run: script block', () => {
    const wf = `jobs:
  a:
    steps:
      - run: |
          echo "docs example: uses: actions/checkout@v5"
      - uses: actions/checkout@${SHA} # v5
`;
    expect(findUnpinnedActionRefs(wf)).toEqual([]);
  });

  it('ignores local action and local reusable-workflow refs', () => {
    const wf = `jobs:
  call:
    uses: ./.github/workflows/reusable.yml
  build:
    steps:
      - uses: ./.github/actions/local
`;
    expect(findUnpinnedActionRefs(wf)).toEqual([]);
  });

  it('reports a ref with no @ pin at all', () => {
    const wf = `jobs:
  a:
    steps:
      - uses: actions/checkout
`;
    expect(findUnpinnedActionRefs(wf)).toEqual(['actions/checkout']);
  });

  it('reports an unparseable workflow rather than silently passing', () => {
    expect(findUnpinnedActionRefs('jobs: [unbalanced')[0]).toMatch(/unparseable/);
  });
});

describe('every action ref in .github/workflows is SHA-pinned (S4 guard)', () => {
  it('has no unpinned external action refs', () => {
    const dir = resolve(import.meta.dirname, '../../../.github/workflows');
    const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      for (const ref of findUnpinnedActionRefs(readFileSync(join(dir, file), 'utf8'))) {
        offenders.push(`${file}: ${ref}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
