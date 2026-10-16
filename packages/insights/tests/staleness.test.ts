import { describe, expect, it } from 'vitest';
import { STALE_MONTHS, deriveStaleness } from '../src/staleness';

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
const asOf = new Date('2026-09-30T00:00:00Z');
/** Return an ISO instant exactly `months` before `asOf` (± a nudge in ms). */
const monthsAgo = (months: number, nudgeMs = 0): string =>
  new Date(asOf.getTime() - months * MS_PER_MONTH + nudgeMs).toISOString();

describe('deriveStaleness — the single shared staleness formula (explicit asOf)', () => {
  it('STALE_MONTHS is 12 (the M4.3a-pinned threshold)', () => {
    expect(STALE_MONTHS).toBe(12);
  });

  it('unknown/absent push date is NEVER stale and has null monthsSincePush', () => {
    expect(deriveStaleness(null, asOf)).toEqual({ monthsSincePush: null, isStale: false });
  });

  it('a fresh push (< threshold) is not stale', () => {
    const r = deriveStaleness(monthsAgo(3), asOf);
    expect(r.isStale).toBe(false);
    expect(r.monthsSincePush).toBeGreaterThan(2.9);
    expect(r.monthsSincePush).toBeLessThan(3.1);
  });

  it('an old push (> threshold) is stale', () => {
    expect(deriveStaleness(monthsAgo(18), asOf).isStale).toBe(true);
  });

  it('boundary: exactly STALE_MONTHS is NOT stale; just past it IS (strict >)', () => {
    // exactly 12 months ago → monthsSincePush ≈ 12 (not > 12)
    expect(deriveStaleness(monthsAgo(STALE_MONTHS), asOf).isStale).toBe(false);
    // a hair older than 12 months → > 12
    expect(deriveStaleness(monthsAgo(STALE_MONTHS, -60 * 60 * 1000), asOf).isStale).toBe(true);
  });

  it('is deterministic in asOf — no wall clock; a later asOf yields a larger age', () => {
    const pushed = '2025-01-01T00:00:00Z';
    const early = deriveStaleness(pushed, new Date('2026-01-01T00:00:00Z')).monthsSincePush!;
    const late = deriveStaleness(pushed, new Date('2026-09-01T00:00:00Z')).monthsSincePush!;
    expect(late).toBeGreaterThan(early);
    // pure function of (pushedAt, asOf): same inputs → identical output
    expect(deriveStaleness(pushed, new Date('2026-01-01T00:00:00Z')).monthsSincePush).toBe(early);
  });
});
