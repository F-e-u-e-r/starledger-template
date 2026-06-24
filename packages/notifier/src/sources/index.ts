import type { NotifierConfig } from '../config';
import type { DiscoveryItem } from '../models';
import type { NotifierState, YoutubeChannelState } from '../state';
import { type AwesomeStarsClient, pollAwesomeStars } from './awesome-stars';
import { pollYoutubeChannel, type YoutubeFeedClient } from './youtube';

export * from './youtube';
export * from './awesome-stars';

export interface SourceClients {
  youtube: YoutubeFeedClient;
  awesomeStars: AwesomeStarsClient;
}

export interface SourceError {
  source: 'youtube' | 'awesome_stars';
  /** Channel id or repository — what failed. */
  target: string;
  message: string;
}

export interface RunSourcesResult {
  items: DiscoveryItem[];
  nextState: NotifierState;
  errors: SourceError[];
}

const COLD_CHANNEL: YoutubeChannelState = {
  initialized: false,
  etag: null,
  last_modified: null,
  recent_seen: [],
};

/**
 * Poll every configured source with per-source isolation: one source's failure
 * is recorded as a retryable error and leaves THAT source's cursor untouched (so
 * the change is re-observed next run) without blocking the others or advancing
 * their state. The returned `nextState` folds in only the successful advances;
 * pending/deliveries are left for the orchestrator to update.
 */
export async function runSources(
  state: NotifierState,
  config: NotifierConfig,
  clients: SourceClients,
  now: Date,
): Promise<RunSourcesResult> {
  const items: DiscoveryItem[] = [];
  const errors: SourceError[] = [];
  const youtube: Record<string, YoutubeChannelState> = { ...state.youtube };

  for (const channelId of config.youtube.channels) {
    const channelState = state.youtube[channelId] ?? COLD_CHANNEL;
    try {
      const res = await pollYoutubeChannel(channelId, channelState, clients.youtube, now);
      youtube[channelId] = res.nextState;
      items.push(...res.items);
    } catch (err) {
      youtube[channelId] = channelState; // no advance on a retryable failure
      errors.push({ source: 'youtube', target: channelId, message: (err as Error).message });
    }
  }

  let awesome_stars = state.awesome_stars;
  try {
    const res = await pollAwesomeStars(state.awesome_stars, clients.awesomeStars, now);
    awesome_stars = res.nextState;
    items.push(...res.items);
  } catch (err) {
    errors.push({
      source: 'awesome_stars',
      target: state.awesome_stars.repository,
      message: (err as Error).message,
    });
  }

  return { items, nextState: { ...state, youtube, awesome_stars }, errors };
}
