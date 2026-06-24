import { type NotifierConfig, NotifierConfigSchema } from '../src/config';
import type {
  DeliveryRecord,
  DiscoveryItem,
  PendingNotification,
  ResolvedRepository,
} from '../src/models';
import type {
  AwesomeStarsClient,
  CommitRef,
  FeedConditional,
  FeedResponse,
  YoutubeFeedClient,
} from '../src/sources';
import type { RepositoryResolver } from '../src/resolve-repo';
import { emptyState, type NotifierState } from '../src/state';
import type { SaveResult, StateStore } from '../src/state-store';
import type { TelegramMessage, TelegramSender } from '../src/telegram';

/** Parse a partial raw config (as YAML would yield) through the schema's defaults. */
export function makeConfig(raw: unknown = {}): NotifierConfig {
  return NotifierConfigSchema.parse(raw);
}

export function makeDiscoveryItem(overrides: Partial<DiscoveryItem> = {}): DiscoveryItem {
  return {
    source: 'youtube',
    source_item_id: 'VIDEO1',
    title: 'A video',
    url: 'https://www.youtube.com/watch?v=VIDEO1',
    description: null,
    published_at: '2026-06-19T00:00:00Z',
    extraction_text: '',
    discovered_at: '2026-06-19T00:00:00Z',
    ...overrides,
  };
}

export function makeResolvedRepository(
  overrides: Partial<ResolvedRepository> = {},
): ResolvedRepository {
  return {
    node_id: 'R_node',
    name_with_owner: 'acme/widget',
    owner: 'acme',
    name: 'widget',
    url: 'https://github.com/acme/widget',
    description: 'A useful widget',
    primary_language: 'TypeScript',
    topics: ['tooling'],
    stargazer_count: 1234,
    license_spdx: 'MIT',
    is_archived: false,
    is_fork: false,
    latest_release: null,
    ...overrides,
  };
}

export function makePending(overrides: Partial<PendingNotification> = {}): PendingNotification {
  const item = overrides.item ?? makeDiscoveryItem();
  return {
    item_key: `${item.source}:${item.source_item_id}`,
    item,
    attempts: 0,
    first_seen_at: '2026-06-19T00:00:00Z',
    last_attempt_at: null,
    last_error: null,
    ...overrides,
  };
}

export function makeDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    notification_key: 'youtube:VIDEO1:R_node',
    status: 'sent',
    completed_at: '2026-06-19T00:00:00Z',
    detail: null,
    ...overrides,
  };
}

export function makeState(overrides: Partial<NotifierState> = {}): NotifierState {
  return { ...emptyState(makeConfig()), ...overrides };
}

// --- in-memory state store (the real GitStateStore is covered by the real-git smoke) ---

export class MemoryStateStore implements StateStore {
  saved: string | null;
  readonly saveCalls: { bytes: string; message: string }[] = [];

  constructor(
    initial: string | null = null,
    private readonly opts: { pushed?: boolean } = {},
  ) {
    this.saved = initial;
  }

  async load(): Promise<string | null> {
    return this.saved;
  }

  async save(bytes: string, message: string): Promise<SaveResult> {
    this.saveCalls.push({ bytes, message });
    const changed = bytes !== this.saved;
    const pushed = this.opts.pushed ?? true;
    if (changed && pushed) this.saved = bytes; // a failed push leaves the remote unchanged
    return { changed, committed: changed, pushed: changed ? pushed : false };
  }
}

// --- fake source clients ---

type FeedReply = FeedResponse | (() => FeedResponse | Promise<FeedResponse>);

export class FakeYoutubeFeedClient implements YoutubeFeedClient {
  readonly calls: { channelId: string; conditional: FeedConditional }[] = [];

  constructor(private readonly replies: Record<string, FeedReply>) {}

  async fetchFeed(channelId: string, conditional: FeedConditional): Promise<FeedResponse> {
    this.calls.push({ channelId, conditional });
    const reply = this.replies[channelId];
    if (!reply) return { status: 200, body: youtubeFeed([]), etag: null, lastModified: null };
    return typeof reply === 'function' ? reply() : reply;
  }
}

export class FakeAwesomeStarsClient implements AwesomeStarsClient {
  readonly latestCalls: { ref: string; path: string }[] = [];
  readonly contentCalls: { ref: string; path: string }[] = [];

  constructor(
    private readonly commits: Record<string, CommitRef | null>,
    private readonly contents: Record<string, string | null>,
    private readonly opts: { throwOnLatest?: boolean } = {},
  ) {}

  async getLatestCommit(ref: string, path: string): Promise<CommitRef | null> {
    this.latestCalls.push({ ref, path });
    if (this.opts.throwOnLatest) throw new Error('simulated commits API failure');
    return this.commits[path] ?? null;
  }

  async getFileContent(ref: string, path: string): Promise<string | null> {
    this.contentCalls.push({ ref, path });
    return this.contents[`${ref}:${path}`] ?? null;
  }
}

export class FakeRepositoryResolver implements RepositoryResolver {
  readonly items: DiscoveryItem[] = [];

  constructor(
    private readonly resolveItem: (
      item: DiscoveryItem,
    ) => ResolvedRepository[] | Promise<ResolvedRepository[]>,
  ) {}

  async resolve(item: DiscoveryItem): Promise<ResolvedRepository[]> {
    this.items.push(item);
    return this.resolveItem(item);
  }
}

export class FakeTelegramSender implements TelegramSender {
  readonly messages: TelegramMessage[] = [];

  constructor(
    private readonly sendMessage: (message: TelegramMessage) => void | Promise<void> = () => {},
  ) {}

  async send(message: TelegramMessage): Promise<void> {
    this.messages.push(message);
    await this.sendMessage(message);
  }
}

// --- YouTube Atom feed fixtures ---

export function youtubeEntry(opts: {
  id: string;
  title?: string;
  published?: string;
  description?: string | null;
}): string {
  const desc =
    opts.description === undefined || opts.description === null
      ? ''
      : `<media:group><media:description>${opts.description}</media:description></media:group>`;
  return `<entry>
    <id>yt:video:${opts.id}</id>
    <yt:videoId>${opts.id}</yt:videoId>
    <title>${opts.title ?? opts.id}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${opts.id}"/>
    <published>${opts.published ?? '2026-06-19T00:00:00+00:00'}</published>
    ${desc}
  </entry>`;
}

export function youtubeFeed(entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Channel Title</title>
  ${entries.join('\n')}
</feed>`;
}
