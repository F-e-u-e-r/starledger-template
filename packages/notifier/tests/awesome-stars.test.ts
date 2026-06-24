import { describe, expect, it } from 'vitest';
import { pollAwesomeStars, runSources } from '../src/sources';
import type { AwesomeStarsState } from '../src/state';
import { FakeAwesomeStarsClient, makeConfig, makeState } from './helpers';

const NOW = new Date('2026-06-19T12:00:00Z');

function awesomeState(overrides: Partial<AwesomeStarsState> = {}): AwesomeStarsState {
  return {
    initialized: true,
    repository: 'maguowei/awesome-stars',
    ref: 'master',
    paths: ['README.md'],
    last_commit_sha: 'sha_old',
    ...overrides,
  };
}

describe('pollAwesomeStars', () => {
  it('AWS-3: cold start records the cursor and emits nothing', async () => {
    const client = new FakeAwesomeStarsClient(
      { 'README.md': { sha: 'sha_new', committedAt: '2026-06-19T00:00:00Z' } },
      {},
    );
    const { items, nextState } = await pollAwesomeStars(
      awesomeState({ initialized: false, last_commit_sha: null }),
      client,
      NOW,
    );
    expect(items).toEqual([]);
    expect(nextState.initialized).toBe(true);
    expect(nextState.last_commit_sha).toBe('sha_new');
    expect(client.contentCalls).toEqual([]); // no content fetch at cold start
  });

  it('AWS-1: an unchanged head SHA is a no-op', async () => {
    const client = new FakeAwesomeStarsClient(
      { 'README.md': { sha: 'sha_old', committedAt: '2026-06-18T00:00:00Z' } },
      {},
    );
    const { items, nextState } = await pollAwesomeStars(awesomeState(), client, NOW);
    expect(items).toEqual([]);
    expect(nextState.last_commit_sha).toBe('sha_old');
  });

  it('AWS-2: a changed head emits the repository SET difference (new − old)', async () => {
    const oldContent = `
      - [acme/widget](https://github.com/acme/widget) — a thing
      - [acme/gadget](https://github.com/acme/gadget) — another
    `;
    const newContent = `
      - [acme/widget](https://github.com/acme/widget) — a thing
      - [acme/gadget](https://github.com/acme/gadget) — another
      - [freshorg/proj](https://github.com/freshorg/proj) — freshly added
      - profile https://github.com/maguowei and topic https://github.com/topics/x (ignored)
    `;
    const client = new FakeAwesomeStarsClient(
      { 'README.md': { sha: 'sha_new', committedAt: '2026-06-19T00:00:00Z' } },
      { 'sha_old:README.md': oldContent, 'sha_new:README.md': newContent },
    );
    const { items, nextState } = await pollAwesomeStars(awesomeState(), client, NOW);
    expect(items.map((i) => i.source_item_id)).toEqual(['freshorg/proj']); // only the genuinely-new repo
    expect(items[0]).toMatchObject({
      source: 'awesome_stars',
      url: 'https://github.com/freshorg/proj',
      extraction_text: 'https://github.com/freshorg/proj',
      published_at: '2026-06-19T00:00:00Z',
    });
    expect(nextState.last_commit_sha).toBe('sha_new');
  });

  it('honors a configurable ref and multiple paths', async () => {
    const client = new FakeAwesomeStarsClient(
      {
        'README.md': { sha: 'sha_a', committedAt: '2026-06-18T00:00:00Z' },
        'topics.md': { sha: 'sha_b', committedAt: '2026-06-19T00:00:00Z' }, // newest ⇒ cursor
      },
      {
        'sha_old:README.md': '',
        'sha_old:topics.md': '',
        'sha_b:README.md': 'https://github.com/x/one',
        'sha_b:topics.md': 'https://github.com/y/two',
      },
    );
    const { items, nextState } = await pollAwesomeStars(
      awesomeState({ ref: 'trunk', paths: ['README.md', 'topics.md'] }),
      client,
      NOW,
    );
    expect(client.latestCalls.every((c) => c.ref === 'trunk')).toBe(true);
    expect(items.map((i) => i.source_item_id).sort()).toEqual(['x/one', 'y/two']);
    expect(nextState.last_commit_sha).toBe('sha_b'); // newest across paths
  });
});

describe('runSources isolation (retryable source failure does not advance state)', () => {
  it('records an error and leaves awesome-stars untouched on a commits-API failure', async () => {
    const state = makeState();
    state.awesome_stars = awesomeState();
    const clients = {
      youtube: {
        async fetchFeed() {
          return { status: 200 as const, body: null, etag: null, lastModified: null };
        },
      },
      awesomeStars: new FakeAwesomeStarsClient({}, {}, { throwOnLatest: true }),
    };
    const res = await runSources(state, makeConfig(), clients, NOW);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.source).toBe('awesome_stars');
    expect(res.nextState.awesome_stars).toEqual(state.awesome_stars); // cursor untouched
    expect(res.items).toEqual([]);
  });
});
