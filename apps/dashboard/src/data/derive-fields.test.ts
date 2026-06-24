import { describe, expect, it } from 'vitest';
import { makeRepo } from '../test-utils';
import { deriveRepo } from './derive-fields';

const NOW = new Date('2026-06-19T00:00:00Z');

describe('deriveRepo', () => {
  it('stable release is three-state: has / none / unavailable', () => {
    const has = deriveRepo(
      makeRepo({
        latest_stable_release: {
          tag_name: 'v1',
          published_at: '2026-01-01T00:00:00Z',
          url: 'https://x/r',
        },
      }),
      NOW,
    );
    expect(has.stableRelease).toBe('has');

    const none = deriveRepo(makeRepo({ latest_stable_release: null }), NOW);
    expect(none.stableRelease).toBe('none');

    const unavailable = deriveRepo(
      makeRepo({
        hydration_status: 'failed',
        latest_stable_release: null,
        unavailable_fields: ['latest_stable_release'],
      }),
      NOW,
    );
    expect(unavailable.stableRelease).toBe('unavailable');
  });

  it('an unknown pushed_at is not stale', () => {
    const repo = deriveRepo(
      makeRepo({ hydration_status: 'failed', pushed_at: null, unavailable_fields: ['pushed_at'] }),
      NOW,
    );
    expect(repo.monthsSincePush).toBeNull();
    expect(repo.isStale).toBe(false);
  });

  it('an old pushed_at is stale; a recent one is not', () => {
    expect(deriveRepo(makeRepo({ pushed_at: '2024-01-01T00:00:00Z' }), NOW).isStale).toBe(true);
    expect(deriveRepo(makeRepo({ pushed_at: '2026-06-01T00:00:00Z' }), NOW).isStale).toBe(false);
  });

  it('stale threshold boundary: just under 12 months is not stale, just over is', () => {
    // STALE_MONTHS = 12 (~365.28 days) and the comparison is strict `>`.
    // NOW = 2026-06-19; 2025-06-19 is 365 days back (~11.99mo), 2025-06-18 is 366 (~12.02mo).
    expect(deriveRepo(makeRepo({ pushed_at: '2025-06-19T00:00:00Z' }), NOW).isStale).toBe(false);
    expect(deriveRepo(makeRepo({ pushed_at: '2025-06-18T00:00:00Z' }), NOW).isStale).toBe(true);
  });
});
