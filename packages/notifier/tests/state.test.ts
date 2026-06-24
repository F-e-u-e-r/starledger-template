import { DeferredError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import {
  emptyState,
  hasPending,
  isItemTerminal,
  isNotificationSent,
  loadState,
  NotifierStateSchema,
  pruneState,
  reconcileWithConfig,
  serializeState,
} from '../src/state';
import { makeConfig, makeDelivery, makePending, makeState } from './helpers';

const NOW = new Date('2026-06-19T00:00:00Z');

describe('emptyState (cold start for every source — fix #3)', () => {
  it('marks every configured channel and awesome-stars uninitialized', () => {
    const state = emptyState(makeConfig({ youtube: { channels: ['UC_a', 'UC_b'] } }));
    expect(state.youtube['UC_a']?.initialized).toBe(false);
    expect(state.youtube['UC_b']?.recent_seen).toEqual([]);
    expect(state.awesome_stars.initialized).toBe(false);
    expect(state.awesome_stars.repository).toBe('maguowei/awesome-stars');
    expect(state.awesome_stars.ref).toBe('master');
    expect(state.awesome_stars.last_commit_sha).toBeNull();
  });
});

describe('loadState validation (invalid never replaces last-known-good)', () => {
  it('round-trips a serialized state', () => {
    const state = makeState({ pending: [makePending()], deliveries: [makeDelivery()] });
    const loaded = loadState(serializeState(state), makeConfig());
    expect(NotifierStateSchema.safeParse(loaded).success).toBe(true);
    expect(loaded.pending).toHaveLength(1);
  });

  it('throws DeferredError on non-JSON', () => {
    expect(() => loadState('{not json', makeConfig())).toThrow(DeferredError);
  });

  it('throws DeferredError on schema-invalid JSON', () => {
    expect(() => loadState(JSON.stringify({ schema_version: '1.0' }), makeConfig())).toThrow(
      DeferredError,
    );
  });

  it('throws on an unknown schema_version', () => {
    const bad = { ...makeState(), schema_version: '2.0' };
    expect(() => loadState(JSON.stringify(bad), makeConfig())).toThrow(DeferredError);
  });
});

describe('reconcileWithConfig', () => {
  it('adds a newly-configured channel as uninitialized, keeps existing data', () => {
    const state = makeState({
      youtube: { UC_old: { initialized: true, etag: 'e', last_modified: null, recent_seen: [] } },
    });
    const reconciled = reconcileWithConfig(
      state,
      makeConfig({ youtube: { channels: ['UC_new'] } }),
    );
    expect(reconciled.youtube['UC_old']?.initialized).toBe(true); // retained
    expect(reconciled.youtube['UC_new']?.initialized).toBe(false); // cold start
  });

  it('re-baselines awesome-stars when the watched source changes', () => {
    const state = makeState();
    state.awesome_stars = {
      initialized: true,
      repository: 'maguowei/awesome-stars',
      ref: 'master',
      paths: ['README.md'],
      last_commit_sha: 'abc123',
    };
    const reconciled = reconcileWithConfig(
      state,
      makeConfig({ awesome_stars: { repository: 'someone/else' } }),
    );
    expect(reconciled.awesome_stars.initialized).toBe(false);
    expect(reconciled.awesome_stars.repository).toBe('someone/else');
    expect(reconciled.awesome_stars.last_commit_sha).toBeNull();
  });

  it('leaves awesome-stars untouched when the source is unchanged', () => {
    const state = makeState();
    state.awesome_stars.initialized = true;
    state.awesome_stars.last_commit_sha = 'abc123';
    const reconciled = reconcileWithConfig(state, makeConfig());
    expect(reconciled.awesome_stars.last_commit_sha).toBe('abc123');
  });
});

describe('serializeState determinism (commit-on-change guard)', () => {
  it('produces identical bytes regardless of insertion order', () => {
    const a = makeState({
      youtube: {
        UC_b: {
          initialized: true,
          etag: null,
          last_modified: null,
          recent_seen: [
            { id: 'v1', seen_at: '2026-06-01T00:00:00Z' },
            { id: 'v2', seen_at: '2026-06-02T00:00:00Z' },
          ],
        },
        UC_a: { initialized: true, etag: null, last_modified: null, recent_seen: [] },
      },
      deliveries: [
        makeDelivery({ notification_key: 'z' }),
        makeDelivery({ notification_key: 'a' }),
      ],
    });
    const b = makeState({
      youtube: {
        UC_a: { initialized: true, etag: null, last_modified: null, recent_seen: [] },
        UC_b: {
          initialized: true,
          etag: null,
          last_modified: null,
          recent_seen: [
            { id: 'v2', seen_at: '2026-06-02T00:00:00Z' },
            { id: 'v1', seen_at: '2026-06-01T00:00:00Z' },
          ],
        },
      },
      deliveries: [
        makeDelivery({ notification_key: 'a' }),
        makeDelivery({ notification_key: 'z' }),
      ],
    });
    expect(serializeState(a)).toBe(serializeState(b));
  });

  it('ends with exactly one trailing newline', () => {
    const bytes = serializeState(makeState());
    expect(bytes.endsWith('}\n')).toBe(true);
    expect(bytes.endsWith('}\n\n')).toBe(false);
  });
});

describe('pruneState retention', () => {
  it('caps recent_seen per channel and never touches pending', () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      seen_at: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const state = makeState({
      youtube: {
        UC_a: { initialized: true, etag: null, last_modified: null, recent_seen: recent },
      },
      pending: [makePending(), makePending({ item_key: 'youtube:V2' })],
    });
    const pruned = pruneState(state, makeConfig({ youtube: { recent_seen_limit: 50 } }), NOW);
    // limit 50 keeps all 10; newest first
    expect(pruned.youtube['UC_a']?.recent_seen[0]?.id).toBe('v9');
    expect(pruned.pending).toHaveLength(2); // pending untouched
  });

  it('drops deliveries older than the retention window', () => {
    const state = makeState({
      deliveries: [
        makeDelivery({ notification_key: 'old', completed_at: '2026-01-01T00:00:00Z' }),
        makeDelivery({ notification_key: 'new', completed_at: '2026-06-18T00:00:00Z' }),
      ],
    });
    const pruned = pruneState(state, makeConfig({ retention: { delivery_days: 90 } }), NOW);
    expect(pruned.deliveries.map((d) => d.notification_key)).toEqual(['new']);
  });

  it('caps deliveries by count, keeping the newest', () => {
    const deliveries = Array.from({ length: 5 }, (_, i) =>
      makeDelivery({
        notification_key: `k${i}`,
        completed_at: `2026-06-1${i}T00:00:00Z`,
      }),
    );
    const state = makeState({ deliveries });
    const pruned = pruneState(state, makeConfig({ retention: { delivery_max: 2 } }), NOW);
    expect(pruned.deliveries.map((d) => d.notification_key)).toEqual(['k3', 'k4']);
  });
});

describe('pure queries', () => {
  it('hasPending / isItemTerminal / isNotificationSent', () => {
    const state = makeState({
      pending: [makePending({ item_key: 'youtube:V1' })],
      deliveries: [
        makeDelivery({ notification_key: 'youtube:V9', status: 'skipped_no_repo' }),
        makeDelivery({ notification_key: 'youtube:V1:R_a', status: 'sent' }),
      ],
    });
    expect(hasPending(state, 'youtube:V1')).toBe(true);
    expect(hasPending(state, 'youtube:V2')).toBe(false);
    expect(isItemTerminal(state, 'youtube:V9')).toBe(true);
    expect(isItemTerminal(state, 'youtube:V1')).toBe(false); // a sent record is not item-level terminal
    expect(isNotificationSent(state, 'youtube:V1:R_a')).toBe(true);
    expect(isNotificationSent(state, 'youtube:V1:R_b')).toBe(false);
  });
});
