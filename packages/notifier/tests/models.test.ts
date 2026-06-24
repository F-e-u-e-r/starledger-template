import { describe, expect, it } from 'vitest';
import {
  DeliveryRecordSchema,
  DiscoveryItemSchema,
  itemKey,
  notificationKey,
  PendingNotificationSchema,
  ResolvedRepositorySchema,
} from '../src/models';
import { makeDiscoveryItem } from './helpers';

describe('DiscoveryItem contract (fix #1: detection required, description optional)', () => {
  it('accepts a null description and empty extraction_text', () => {
    const parsed = DiscoveryItemSchema.safeParse(
      makeDiscoveryItem({ description: null, extraction_text: '' }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a missing source_item_id', () => {
    const item: Record<string, unknown> = { ...makeDiscoveryItem() };
    delete item.source_item_id;
    expect(DiscoveryItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    expect(DiscoveryItemSchema.safeParse({ ...makeDiscoveryItem(), surprise: 1 }).success).toBe(
      false,
    );
  });

  it('rejects a non-URL url', () => {
    expect(DiscoveryItemSchema.safeParse(makeDiscoveryItem({ url: 'not-a-url' })).success).toBe(
      false,
    );
  });
});

describe('ResolvedRepository contract', () => {
  const base = {
    node_id: 'R_1',
    name_with_owner: 'acme/widget',
    owner: 'acme',
    name: 'widget',
    url: 'https://github.com/acme/widget',
    description: null,
    primary_language: null,
    topics: [],
    stargazer_count: null,
    license_spdx: null,
    is_archived: null,
    is_fork: null,
    latest_release: null,
  };

  it('accepts a minimal resolved repo', () => {
    expect(ResolvedRepositorySchema.safeParse(base).success).toBe(true);
  });

  it('accepts a populated latest_release', () => {
    const parsed = ResolvedRepositorySchema.safeParse({
      ...base,
      latest_release: { tag_name: 'v1.0.0', published_at: null, url: 'https://example.com/r' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty node_id', () => {
    expect(ResolvedRepositorySchema.safeParse({ ...base, node_id: '' }).success).toBe(false);
  });
});

describe('DeliveryRecord contract (only terminal statuses)', () => {
  it('accepts the three terminal statuses', () => {
    for (const status of ['sent', 'skipped_no_repo', 'permanent_failure'] as const) {
      const parsed = DeliveryRecordSchema.safeParse({
        notification_key: 'youtube:V:R',
        status,
        completed_at: '2026-06-19T00:00:00Z',
        detail: null,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects "pending" as a delivery status', () => {
    const parsed = DeliveryRecordSchema.safeParse({
      notification_key: 'youtube:V:R',
      status: 'pending',
      completed_at: '2026-06-19T00:00:00Z',
      detail: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('PendingNotification carries the full payload (fix #2: survives the RSS window)', () => {
  it('embeds the discovery item', () => {
    const item = makeDiscoveryItem({ source_item_id: 'V2' });
    const parsed = PendingNotificationSchema.safeParse({
      item_key: 'youtube:V2',
      item,
      attempts: 1,
      first_seen_at: '2026-06-19T00:00:00Z',
      last_attempt_at: '2026-06-19T01:00:00Z',
      last_error: 'github-temporary-error',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.item.source_item_id).toBe('V2');
  });
});

describe('key helpers', () => {
  it('itemKey is source:source_item_id', () => {
    expect(itemKey('youtube', 'VIDEO_ID')).toBe('youtube:VIDEO_ID');
    expect(itemKey('awesome_stars', 'sindresorhus/awesome')).toBe(
      'awesome_stars:sindresorhus/awesome',
    );
  });

  it('notificationKey appends the repo node id', () => {
    expect(notificationKey('youtube', 'VIDEO_ID', 'R_NODE')).toBe('youtube:VIDEO_ID:R_NODE');
  });
});
