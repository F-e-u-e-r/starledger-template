import { describe, expect, it } from 'vitest';
import {
  buildClassificationManifest,
  ClassificationManifestSchema,
  serializeClassificationManifest,
  type PlanSummary,
} from '../src/manifest';
import { makeJob } from './helpers';

const BASE = {
  promptVersion: 'classify-v1',
  executionProfileVersion: 'agent-v1',
  executorKind: 'claude-routine' as const,
  datasetSha256: 'd'.repeat(64),
};

const DRAINED: PlanSummary = {
  eligible_new: 0,
  eligible_retry: 0,
  eligible_refresh: 0,
  omitted_unfetchable: 0,
  deferred_retry: 0,
  deferred_terminal: 0,
  empty_reason: 'drained-at-base',
};

describe('ClassificationManifest — plan_summary diagnostics (issue #207)', () => {
  it('is optional and omitted from serialization when absent (backward compatible)', () => {
    const m = buildClassificationManifest({ ...BASE, jobs: [] });
    expect(m.plan_summary).toBeUndefined();
    const text = serializeClassificationManifest(m);
    expect(text).not.toContain('plan_summary');
    // an old-shape (no plan_summary) manifest still parses
    expect(() => ClassificationManifestSchema.parse(JSON.parse(text))).not.toThrow();
  });

  it('carries and round-trips plan_summary on an empty manifest', () => {
    const m = buildClassificationManifest({ ...BASE, jobs: [], planSummary: DRAINED });
    expect(m.plan_summary).toEqual(DRAINED);
    const parsed = ClassificationManifestSchema.parse(
      JSON.parse(serializeClassificationManifest(m)),
    );
    expect(parsed.plan_summary).toEqual(DRAINED);
  });

  it('serializes plan_summary before jobs, keys in fixed order, deterministically', () => {
    const m = buildClassificationManifest({ ...BASE, jobs: [], planSummary: DRAINED });
    const text = serializeClassificationManifest(m);
    expect(text.indexOf('"plan_summary"')).toBeLessThan(text.indexOf('"jobs"'));
    const order = [
      'eligible_new',
      'eligible_retry',
      'eligible_refresh',
      'omitted_unfetchable',
      'deferred_retry',
      'deferred_terminal',
      'empty_reason',
    ];
    const positions = order.map((k) => text.indexOf(`"${k}"`));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(serializeClassificationManifest(m)).toBe(text); // deterministic
  });

  it('allows empty_reason null when jobs are present', () => {
    const m = buildClassificationManifest({
      ...BASE,
      jobs: [makeJob()],
      planSummary: { ...DRAINED, eligible_new: 1, empty_reason: null },
    });
    expect(m.plan_summary?.empty_reason).toBeNull();
    expect(m.jobs).toHaveLength(1);
  });

  it('INVARIANT: rejects empty_reason=null on an empty manifest', () => {
    const valid = buildClassificationManifest({ ...BASE, jobs: [], planSummary: DRAINED });
    expect(() =>
      ClassificationManifestSchema.parse({
        ...valid,
        plan_summary: { ...DRAINED, empty_reason: null },
      }),
    ).toThrow(/empty_reason must be set when jobs is empty/);
  });

  it('INVARIANT: rejects a non-null empty_reason when jobs are present', () => {
    const valid = buildClassificationManifest({
      ...BASE,
      jobs: [makeJob()],
      planSummary: { ...DRAINED, eligible_new: 1, empty_reason: null },
    });
    expect(() =>
      ClassificationManifestSchema.parse({
        ...valid,
        plan_summary: { ...DRAINED, eligible_new: 1, empty_reason: 'drained-at-base' },
      }),
    ).toThrow(/empty_reason must be null when jobs is non-empty/);
  });

  it('rejects unknown keys inside plan_summary (strict)', () => {
    const valid = buildClassificationManifest({ ...BASE, jobs: [], planSummary: DRAINED });
    expect(() =>
      ClassificationManifestSchema.parse({ ...valid, plan_summary: { ...DRAINED, bogus: 1 } }),
    ).toThrow();
  });

  it('requires deferred_terminal (a plan_summary missing it is rejected)', () => {
    // #207 5b: deferred_terminal is a required count, symmetric with deferred_retry
    // — a manifest predating it cannot prove the terminal residual is absent, so
    // parsing must fail closed rather than default it in.
    const valid = buildClassificationManifest({ ...BASE, jobs: [], planSummary: DRAINED });
    const withoutTerminal = {
      eligible_new: 0,
      eligible_retry: 0,
      eligible_refresh: 0,
      omitted_unfetchable: 0,
      deferred_retry: 0,
      empty_reason: 'drained-at-base',
    };
    expect(() =>
      ClassificationManifestSchema.parse({ ...valid, plan_summary: withoutTerminal }),
    ).toThrow();
  });

  it('rejects negative or non-integer eligible counts', () => {
    const valid = buildClassificationManifest({ ...BASE, jobs: [], planSummary: DRAINED });
    expect(() =>
      ClassificationManifestSchema.parse({
        ...valid,
        plan_summary: { ...DRAINED, eligible_new: -1 },
      }),
    ).toThrow();
    expect(() =>
      ClassificationManifestSchema.parse({
        ...valid,
        plan_summary: { ...DRAINED, eligible_refresh: 1.5 },
      }),
    ).toThrow();
  });

  it('rejects an invalid empty_reason value', () => {
    const valid = buildClassificationManifest({ ...BASE, jobs: [], planSummary: DRAINED });
    expect(() =>
      ClassificationManifestSchema.parse({
        ...valid,
        plan_summary: { ...DRAINED, empty_reason: 'nonsense' },
      }),
    ).toThrow();
  });
});
