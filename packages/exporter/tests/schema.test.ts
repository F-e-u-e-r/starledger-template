import { CanonicalRepoSchema } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { makeRepo } from './helpers';

describe('CanonicalRepo cross-field invariants', () => {
  it('accepts a valid fully-hydrated record', () => {
    expect(CanonicalRepoSchema.safeParse(makeRepo()).success).toBe(true);
  });

  it('Invariant A: hydration_status "ok" forbids non-empty unavailable_fields', () => {
    const bad = makeRepo({ hydration_status: 'ok', unavailable_fields: ['latest_stable_release'] });
    expect(CanonicalRepoSchema.safeParse(bad).success).toBe(false);
  });

  it('Invariant B: a field listed unavailable must be empty/null, not concrete', () => {
    const bad = makeRepo({
      hydration_status: 'partial',
      unavailable_fields: ['stargazer_count'],
      stargazer_count: 42, // concrete value contradicts "unavailable"
    });
    expect(CanonicalRepoSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a valid partial record: unknown field is null and listed', () => {
    const ok = makeRepo({
      hydration_status: 'partial',
      unavailable_fields: ['latest_stable_release'],
      latest_stable_release: null,
    });
    expect(CanonicalRepoSchema.safeParse(ok).success).toBe(true);
  });

  it('distinguishes confirmed-absent (null, not listed) from unknown (null, listed)', () => {
    const confirmedAbsent = makeRepo({
      hydration_status: 'ok',
      latest_stable_release: null,
      unavailable_fields: [],
    });
    expect(CanonicalRepoSchema.safeParse(confirmedAbsent).success).toBe(true);
  });

  it('Invariant: hydration_status "failed" must list unavailable_fields', () => {
    const bad = makeRepo({ hydration_status: 'failed', unavailable_fields: [] });
    expect(CanonicalRepoSchema.safeParse(bad).success).toBe(false);
  });
});
