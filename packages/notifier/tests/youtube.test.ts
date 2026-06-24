import { describe, expect, it } from 'vitest';
import type { YoutubeChannelState } from '../src/state';
import { parseAtomFeed, pollYoutubeChannel } from '../src/sources';
import { FakeYoutubeFeedClient, youtubeEntry, youtubeFeed } from './helpers';

const NOW = new Date('2026-06-19T12:00:00Z');
const COLD: YoutubeChannelState = {
  initialized: false,
  etag: null,
  last_modified: null,
  recent_seen: [],
};

describe('parseAtomFeed (YT-4: detection required, description optional, entities decoded)', () => {
  it('parses entries and tolerates a missing description', () => {
    const xml = youtubeFeed([
      youtubeEntry({
        id: 'v1',
        title: 'First &amp; best',
        description: 'see https://github.com/a/b',
      }),
      youtubeEntry({ id: 'v2', title: 'No description', description: null }),
    ]);
    const entries = parseAtomFeed(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      videoId: 'v1',
      title: 'First & best', // entity decoded
      description: 'see https://github.com/a/b',
    });
    expect(entries[1]?.description).toBeNull(); // absent description ⇒ null, still detected
  });

  it('skips entries without a video id', () => {
    const xml = youtubeFeed(['<entry><title>no id</title></entry>', youtubeEntry({ id: 'ok' })]);
    expect(parseAtomFeed(xml).map((e) => e.videoId)).toEqual(['ok']);
  });
});

describe('pollYoutubeChannel', () => {
  it('YT-1: cold start baselines current videos and emits nothing', async () => {
    const client = new FakeYoutubeFeedClient({
      UC_x: {
        status: 200,
        body: youtubeFeed([youtubeEntry({ id: 'v1' }), youtubeEntry({ id: 'v2' })]),
        etag: 'E1',
        lastModified: null,
      },
    });
    const { items, nextState } = await pollYoutubeChannel('UC_x', COLD, client, NOW);
    expect(items).toEqual([]);
    expect(nextState.initialized).toBe(true);
    expect(nextState.recent_seen.map((s) => s.id).sort()).toEqual(['v1', 'v2']);
    expect(nextState.etag).toBe('E1');
  });

  it('YT-2: emits only videos not already seen', async () => {
    const seenState: YoutubeChannelState = {
      initialized: true,
      etag: 'E1',
      last_modified: null,
      recent_seen: [{ id: 'v1', seen_at: '2026-06-18T00:00:00Z' }],
    };
    const client = new FakeYoutubeFeedClient({
      UC_x: {
        status: 200,
        body: youtubeFeed([
          youtubeEntry({ id: 'v2', description: 'https://github.com/acme/widget' }),
          youtubeEntry({ id: 'v1' }), // already seen
        ]),
        etag: 'E2',
        lastModified: null,
      },
    });
    const { items, nextState } = await pollYoutubeChannel('UC_x', seenState, client, NOW);
    expect(items.map((i) => i.source_item_id)).toEqual(['v2']);
    expect(items[0]?.extraction_text).toBe('https://github.com/acme/widget');
    expect(items[0]?.source).toBe('youtube');
    // newly seen prepended; previous retained
    expect(nextState.recent_seen.map((s) => s.id)).toEqual(['v2', 'v1']);
    expect(nextState.etag).toBe('E2');
  });

  it('YT-3: a 304 advances nothing', async () => {
    const seenState: YoutubeChannelState = {
      initialized: true,
      etag: 'E1',
      last_modified: 'Wed, 18 Jun 2026 00:00:00 GMT',
      recent_seen: [{ id: 'v1', seen_at: '2026-06-18T00:00:00Z' }],
    };
    const client = new FakeYoutubeFeedClient({
      UC_x: { status: 304, body: null, etag: 'E1', lastModified: 'Wed, 18 Jun 2026 00:00:00 GMT' },
    });
    const { items, nextState } = await pollYoutubeChannel('UC_x', seenState, client, NOW);
    expect(items).toEqual([]);
    expect(nextState).toBe(seenState); // identical reference: nothing changed
  });

  it('YT-5: sends stored validators and stores the response validators', async () => {
    const seenState: YoutubeChannelState = {
      initialized: true,
      etag: 'E-old',
      last_modified: 'Wed, 18 Jun 2026 00:00:00 GMT',
      recent_seen: [],
    };
    const client = new FakeYoutubeFeedClient({
      UC_x: {
        status: 200,
        body: youtubeFeed([]),
        etag: 'E-new',
        lastModified: 'Thu, 19 Jun 2026 00:00:00 GMT',
      },
    });
    const { nextState } = await pollYoutubeChannel('UC_x', seenState, client, NOW);
    // request carried the previously stored conditional validators
    expect(client.calls[0]?.conditional).toEqual({
      etag: 'E-old',
      lastModified: 'Wed, 18 Jun 2026 00:00:00 GMT',
    });
    // response validators are persisted for next time
    expect(nextState.etag).toBe('E-new');
    expect(nextState.last_modified).toBe('Thu, 19 Jun 2026 00:00:00 GMT');
  });
});
