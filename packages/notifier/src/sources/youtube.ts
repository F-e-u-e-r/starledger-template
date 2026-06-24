import type { DiscoveryItem } from '../models';
import type { YoutubeChannelState, YoutubeSeen } from '../state';

/**
 * YouTube channel source: poll the public Atom feed
 * (`/feeds/videos.xml?channel_id=...`) with conditional requests and turn new
 * entries into DiscoveryItems. Detection is required; the `media:description`
 * enrichment is best-effort and may be absent (fix #1).
 */

export interface FeedConditional {
  etag: string | null;
  lastModified: string | null;
}

export interface FeedResponse {
  status: 200 | 304;
  /** Feed XML for 200; null for 304. */
  body: string | null;
  etag: string | null;
  lastModified: string | null;
}

/** Injectable feed transport (production uses global fetch; tests inject a fake). */
export interface YoutubeFeedClient {
  fetchFeed(channelId: string, conditional: FeedConditional): Promise<FeedResponse>;
}

export interface YoutubeEntry {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  description: string | null;
}

export interface YoutubePollResult {
  items: DiscoveryItem[];
  nextState: YoutubeChannelState;
}

const ENTRY_RE = /<entry\b[\s\S]*?<\/entry>/gi;

/** Minimal, scoped XML text decode for this single stable feed format. */
function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // ampersand last, so "&amp;lt;" decodes to "&lt;" not "<"
}

function firstInner(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  return m?.[1] !== undefined ? decodeXml(m[1]) : null;
}

function entryVideoId(block: string): string | null {
  const direct = firstInner(block, 'yt:videoId');
  if (direct && direct.trim()) return direct.trim();
  const id = firstInner(block, 'id');
  const m = id ? /yt:video:(.+)/.exec(id.trim()) : null;
  return m?.[1] ?? null;
}

function entryUrl(block: string, videoId: string): string {
  const alt = /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block);
  if (alt?.[1]) return decodeXml(alt[1]);
  const any = /<link\b[^>]*href=["']([^"']+)["']/i.exec(block);
  if (any?.[1]) return decodeXml(any[1]);
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Parse the entries from a YouTube channel Atom feed. Entries without a video id are skipped. */
export function parseAtomFeed(xml: string): YoutubeEntry[] {
  const entries: YoutubeEntry[] = [];
  for (const m of xml.matchAll(ENTRY_RE)) {
    const block = m[0];
    const videoId = entryVideoId(block);
    if (!videoId) continue;
    const description = firstInner(block, 'media:description');
    const publishedAt = firstInner(block, 'published')?.trim() ?? null;
    entries.push({
      videoId,
      title: (firstInner(block, 'title') ?? '').trim(),
      url: entryUrl(block, videoId),
      publishedAt: publishedAt && publishedAt.length > 0 ? publishedAt : null,
      description: description && description.length > 0 ? description : null,
    });
  }
  return entries;
}

/**
 * Poll one channel. A 304 advances nothing. A 200 on a cold-start channel
 * baselines the current entries and emits NOTHING (fix #3); thereafter only
 * videos not in `recent_seen` are emitted, and they are recorded as seen
 * regardless of downstream success (the durable pending queue, not the seen-set,
 * guarantees they are not lost — fix #2).
 */
export async function pollYoutubeChannel(
  channelId: string,
  channelState: YoutubeChannelState,
  client: YoutubeFeedClient,
  now: Date,
): Promise<YoutubePollResult> {
  const res = await client.fetchFeed(channelId, {
    etag: channelState.etag,
    lastModified: channelState.last_modified,
  });

  if (res.status === 304) return { items: [], nextState: channelState };

  const entries = res.body ? parseAtomFeed(res.body) : [];
  const nowIso = now.toISOString();
  const baseState: YoutubeChannelState = {
    ...channelState,
    etag: res.etag ?? channelState.etag,
    last_modified: res.lastModified ?? channelState.last_modified,
  };

  if (!channelState.initialized) {
    const recent_seen: YoutubeSeen[] = entries.map((e) => ({ id: e.videoId, seen_at: nowIso }));
    return { items: [], nextState: { ...baseState, initialized: true, recent_seen } };
  }

  const seen = new Set(channelState.recent_seen.map((s) => s.id));
  const items: DiscoveryItem[] = [];
  const newlySeen: YoutubeSeen[] = [];
  for (const e of entries) {
    if (seen.has(e.videoId)) continue;
    newlySeen.push({ id: e.videoId, seen_at: nowIso });
    items.push({
      source: 'youtube',
      source_item_id: e.videoId,
      title: e.title,
      url: e.url,
      description: e.description,
      published_at: e.publishedAt,
      extraction_text: e.description ?? '',
      discovered_at: nowIso,
    });
  }

  return {
    items,
    nextState: { ...baseState, recent_seen: [...newlySeen, ...channelState.recent_seen] },
  };
}

const feedUrl = (channelId: string): string =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

/** Production feed client over global fetch, issuing conditional requests. */
export function createHttpYoutubeFeedClient(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): YoutubeFeedClient {
  return {
    async fetchFeed(channelId, conditional) {
      const headers: Record<string, string> = {};
      if (conditional.etag) headers['if-none-match'] = conditional.etag;
      if (conditional.lastModified) headers['if-modified-since'] = conditional.lastModified;
      const res = await fetchImpl(feedUrl(channelId), { headers });
      if (res.status === 304) {
        return {
          status: 304,
          body: null,
          etag: conditional.etag,
          lastModified: conditional.lastModified,
        };
      }
      if (!res.ok) throw new Error(`YouTube feed ${channelId} returned HTTP ${res.status}`);
      return {
        status: 200,
        body: await res.text(),
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
      };
    },
  };
}
