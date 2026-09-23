import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCLUDE_WORKFLOWS, NEUTRALIZE_SCHEDULE_WORKFLOWS } from '../src/allowlist';
import { buildTemplate } from '../src/build';
import {
  OMIT_STEP_MARKER,
  hasActiveSchedule,
  neutralizeSchedule,
  stripOmittedSteps,
} from '../src/workflows';

const workflow = (steps: string): string =>
  [
    'name: ci',
    'on: [push]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    steps,
    '',
  ].join('\n');

const KEEP_A = ['      - name: a', '        run: echo a'].join('\n');
const KEEP_C = ['      - name: c', '        run: echo c'].join('\n');
const OMIT_B = [
  `      ${OMIT_STEP_MARKER}`,
  '      # b describes itself here',
  '      - name: b',
  '        run: |',
  '          node scripts/parent-only.mjs',
  '          node scripts/parent-only-2.mjs',
].join('\n');
const OMIT_D = [
  `      ${OMIT_STEP_MARKER}`,
  '      - name: d',
  '        run: bash scripts/d.sh',
].join('\n');

describe('stripOmittedSteps (fail-closed, idempotent)', () => {
  it('STRIP-1: omits exactly the one marked step and keeps single blank separators', () => {
    const input = workflow([KEEP_A, '', OMIT_B, '', KEEP_C].join('\n'));
    const { text, changed, omitted } = stripOmittedSteps(input);
    expect(changed).toBe(true);
    expect(omitted).toEqual(['b']);
    expect(text).toBe(workflow([KEEP_A, '', KEEP_C].join('\n')));
    expect(text).not.toContain('scripts/');
    expect(text).not.toContain('\n\n\n');
  });

  it('STRIP-2: omits multiple marked steps in document order', () => {
    const input = workflow([KEEP_A, '', OMIT_B, '', KEEP_C, '', OMIT_D].join('\n'));
    const { text, omitted } = stripOmittedSteps(input);
    expect(omitted).toEqual(['b', 'd']);
    expect(text).toBe(workflow([KEEP_A, '', KEEP_C].join('\n')));
  });

  it('STRIP-3: input without a marker is returned unchanged', () => {
    const input = workflow([KEEP_A, '', KEEP_C].join('\n'));
    const result = stripOmittedSteps(input);
    expect(result.changed).toBe(false);
    expect(result.omitted).toEqual([]);
    expect(result.text).toBe(input);
  });

  it('STRIP-4a: a malformed marker fails the build', () => {
    const input = workflow(
      [
        KEEP_A,
        '',
        `      ${OMIT_STEP_MARKER} because reasons`,
        '      - name: b',
        '        run: echo b',
      ].join('\n'),
    );
    expect(() => stripOmittedSteps(input)).toThrow(/malformed marker/);
  });

  it('STRIP-4b: an orphaned marker (no step follows) fails the build', () => {
    const noStep = workflow(
      [KEEP_A, '', `      ${OMIT_STEP_MARKER}`, '        run: echo orphan'].join('\n'),
    );
    expect(() => stripOmittedSteps(noStep)).toThrow(/orphaned marker/);
    const wrongIndent = workflow(
      [KEEP_A, '', `    ${OMIT_STEP_MARKER}`, '      - name: b', '        run: echo b'].join('\n'),
    );
    expect(() => stripOmittedSteps(wrongIndent)).toThrow(/orphaned marker/);
    const atEnd = workflow([KEEP_A, '', `      ${OMIT_STEP_MARKER}`].join('\n'));
    expect(() => stripOmittedSteps(atEnd)).toThrow(/orphaned marker/);
  });

  it('STRIP-5: a second pass over the output produces no further change', () => {
    const input = workflow([KEEP_A, '', OMIT_B, '', KEEP_C].join('\n'));
    const first = stripOmittedSteps(input);
    const second = stripOmittedSteps(first.text);
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });
});

describe('buildTemplate (workflow contract)', () => {
  it('BUILD-1: parent-only workflows are skipped and marked steps are omitted', () => {
    const src = mkdtempSync(join(tmpdir(), 'tb-src-'));
    const out = mkdtempSync(join(tmpdir(), 'tb-out-'));
    mkdirSync(join(src, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(src, 'README.template.md'), '# T\n');
    writeFileSync(
      join(src, '.github', 'workflows', 'ci.yml'),
      workflow([KEEP_A, '', OMIT_B, '', KEEP_C].join('\n')),
    );
    writeFileSync(join(src, '.github', 'workflows', 'template-smoke.yml'), workflow(KEEP_A));
    writeFileSync(join(src, '.github', 'workflows', 'ai-stall-watch.yml'), workflow(KEEP_A));

    const manifest = buildTemplate({ srcRoot: src, outDir: out });

    expect(manifest.skipped).toEqual(
      expect.arrayContaining([
        join('.github', 'workflows', 'template-smoke.yml'),
        join('.github', 'workflows', 'ai-stall-watch.yml'),
      ]),
    );
    expect(manifest.transformed).toContain(join('.github', 'workflows', 'ci.yml'));
    const emitted = readFileSync(join(out, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(emitted).toBe(workflow([KEEP_A, '', KEEP_C].join('\n')));
    expect(EXCLUDE_WORKFLOWS.has('template-smoke.yml')).toBe(true);
  });

  it('BUILD-2: a malformed marker fails the build even on --dry-run', () => {
    const src = mkdtempSync(join(tmpdir(), 'tb-src-'));
    mkdirSync(join(src, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(src, 'README.template.md'), '# T\n');
    writeFileSync(
      join(src, '.github', 'workflows', 'ci.yml'),
      workflow([`      ${OMIT_STEP_MARKER}`, '        run: orphan'].join('\n')),
    );
    expect(() => buildTemplate({ srcRoot: src, outDir: join(src, 'out'), dryRun: true })).toThrow(
      /orphaned marker/,
    );
  });
});

/** A workflow that fires on its own — the shape the template must never ship. */
const SCHEDULED = [
  'name: nightly',
  'on:',
  '  schedule:',
  "    - cron: '0 3 * * *'",
  '  workflow_dispatch:',
  'jobs:',
  '  run:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  KEEP_A,
  '',
].join('\n');

describe('hasActiveSchedule', () => {
  it('SCHED-1: detects block-style and flow-style schedule triggers', () => {
    expect(hasActiveSchedule(SCHEDULED)).toBe(true);
    expect(hasActiveSchedule("on: { schedule: [{ cron: '0 3 * * *' }] }\njobs: {}\n")).toBe(true);
  });

  it('SCHED-2: no trigger in push/list forms, nor in the neutralized output', () => {
    expect(hasActiveSchedule(workflow(KEEP_A))).toBe(false); // on: [push]
    expect(hasActiveSchedule('on: push\njobs: {}\n')).toBe(false);
    expect(hasActiveSchedule(neutralizeSchedule(SCHEDULED).text)).toBe(false);
  });

  it('SCHED-3: `schedule` inside a comment or a run script is not a trigger', () => {
    const decoy = workflow(
      [
        '      # schedule: nightly, see docs',
        '      - name: a',
        '        run: |',
        '          echo "schedule: 0 3 * * *"',
      ].join('\n'),
    );
    expect(hasActiveSchedule(decoy)).toBe(false);
  });

  it('SCHED-4: an unparseable workflow fails closed', () => {
    expect(() => hasActiveSchedule('on: [\njobs')).toThrow(/does not parse/);
  });
});

describe('buildTemplate (schedule contract)', () => {
  function scheduledRepo(): { src: string; out: string } {
    const src = mkdtempSync(join(tmpdir(), 'tb-src-'));
    const out = mkdtempSync(join(tmpdir(), 'tb-out-'));
    mkdirSync(join(src, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(src, 'README.template.md'), '# T\n');
    writeFileSync(join(src, '.github', 'workflows', 'ci.yml'), workflow(KEEP_A));
    return { src, out };
  }

  it('BUILD-3: a scheduled workflow that is neither neutralized nor excluded fails the build', () => {
    const { src, out } = scheduledRepo();
    writeFileSync(join(src, '.github', 'workflows', 'nightly.yml'), SCHEDULED);
    expect(() => buildTemplate({ srcRoot: src, outDir: out, dryRun: true })).toThrow(
      /nightly\.yml.*schedule/,
    );
    expect(() => buildTemplate({ srcRoot: src, outDir: out })).toThrow(
      /NEUTRALIZE_SCHEDULE_WORKFLOWS/,
    );
    expect(existsSync(join(out, '.github', 'workflows', 'nightly.yml'))).toBe(false);
  });

  it('BUILD-4: every listed workflow ships dispatch-only and nothing emitted fires on its own', () => {
    const { src, out } = scheduledRepo();
    expect(NEUTRALIZE_SCHEDULE_WORKFLOWS.has('deploy-freshness.yml')).toBe(true);
    for (const name of NEUTRALIZE_SCHEDULE_WORKFLOWS) {
      writeFileSync(join(src, '.github', 'workflows', name), SCHEDULED.replace('nightly', name));
    }

    const manifest = buildTemplate({ srcRoot: src, outDir: out });

    for (const name of NEUTRALIZE_SCHEDULE_WORKFLOWS) {
      const emitted = readFileSync(join(out, '.github', 'workflows', name), 'utf8');
      expect(hasActiveSchedule(emitted)).toBe(false);
      expect(emitted).toContain("  #   - cron: '0 3 * * *'");
      expect(emitted).toContain('workflow_dispatch:');
      expect(manifest.transformed).toContain(join('.github', 'workflows', name));
    }
    const workflowsDir = join('.github', 'workflows');
    for (const rel of [...manifest.copied, ...manifest.transformed]) {
      if (!rel.startsWith(workflowsDir)) continue;
      expect(hasActiveSchedule(readFileSync(join(out, rel), 'utf8'))).toBe(false);
    }
  });
});
