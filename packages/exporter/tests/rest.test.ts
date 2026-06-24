import {
  createOctokitStarredClient,
  enumerateStarsRest,
  IncompleteEnumerationError,
  parseNextLink,
  RetryBudgetExhaustedError,
  type StarredPage,
  type StarredRestClient,
} from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { fakeRest, httpError, makeStarRow, makeTestCoordinator } from './helpers';

const NEXT = '<https://api.github.com/user/starred?page=2>; rel="next"';

describe('parseNextLink', () => {
  it('detects rel="next"', () => {
    expect(parseNextLink(NEXT)).toBe(true);
    expect(parseNextLink('<...>; rel="prev", <...>; rel="last"')).toBe(false);
    expect(parseNextLink(null)).toBe(false);
  });
});

describe('REST-1: OctokitStarredClient parses star+json', () => {
  it('sends the star+json Accept header and parses starred_at + node_id + Link', async () => {
    const fakeFetch = (async (_url: string | URL, init?: RequestInit) => {
      const accept = new Headers(init?.headers).get('accept') ?? '';
      expect(accept).toContain('application/vnd.github.star+json');
      const body = JSON.stringify([
        {
          starred_at: '2026-05-01T00:00:00Z',
          repo: { node_id: 'R_real', full_name: 'a/real', html_url: 'https://github.com/a/real' },
        },
      ]);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json', link: NEXT },
      });
    }) as typeof fetch;

    const client = createOctokitStarredClient({ fetch: fakeFetch });
    const page = await client.fetchStarredPage(1, 100);
    expect(page.rows[0]?.starred_at).toBe('2026-05-01T00:00:00Z');
    expect(page.rows[0]?.repo.node_id).toBe('R_real');
    expect(page.rows[0]?.repo.full_name).toBe('a/real');
    expect(parseNextLink(page.linkHeader)).toBe(true);
  });
});

describe('enumerateStarsRest', () => {
  it('REST-2: follows the Link chain across three pages with no omissions', async () => {
    const pages: StarredPage[] = [
      { rows: [makeStarRow('R_1', '2026-05-01T00:00:00Z')], linkHeader: NEXT },
      { rows: [makeStarRow('R_2', '2026-04-01T00:00:00Z')], linkHeader: NEXT },
      { rows: [makeStarRow('R_3', '2026-03-01T00:00:00Z')], linkHeader: null },
    ];
    const { seeds } = await enumerateStarsRest(fakeRest(pages));
    expect(seeds.map((s) => s.node_id)).toEqual(['R_1', 'R_2', 'R_3']);
  });

  it('REST-3: retries a transiently failing middle page, then succeeds', async () => {
    let page2Attempts = 0;
    const client: StarredRestClient = {
      async fetchStarredPage(page) {
        if (page === 1)
          return { rows: [makeStarRow('R_1', '2026-05-01T00:00:00Z')], linkHeader: NEXT };
        page2Attempts += 1;
        if (page2Attempts < 3) throw httpError(503, 'service unavailable');
        return { rows: [makeStarRow('R_2', '2026-04-01T00:00:00Z')], linkHeader: null };
      },
    };
    const { seeds } = await enumerateStarsRest(client, {
      coordinator: makeTestCoordinator({ maxAttempts: 4 }),
    });
    expect(seeds.map((s) => s.node_id)).toEqual(['R_1', 'R_2']);
    expect(page2Attempts).toBe(3);
  });

  it('REST-4: a permanently failing page exhausts retries → deferred (exit 20)', async () => {
    const client: StarredRestClient = {
      async fetchStarredPage() {
        throw httpError(503, 'service unavailable');
      },
    };
    await expect(
      enumerateStarsRest(client, { coordinator: makeTestCoordinator({ maxAttempts: 2 }) }),
    ).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
  });

  it('REST-5: dedups duplicate node_id + same starred_at (benign)', async () => {
    const pages: StarredPage[] = [
      { rows: [makeStarRow('R_dup', '2026-05-01T00:00:00Z')], linkHeader: NEXT },
      { rows: [makeStarRow('R_dup', '2026-05-01T00:00:00Z')], linkHeader: null },
    ];
    const { seeds, duplicateCount, duplicateConflictCount } = await enumerateStarsRest(
      fakeRest(pages),
    );
    expect(seeds).toHaveLength(1);
    expect(duplicateCount).toBe(1);
    expect(duplicateConflictCount).toBe(0);
  });

  it('fails closed when starred_at is missing (star+json not applied)', async () => {
    const pages: StarredPage[] = [{ rows: [makeStarRow('R_1', null)], linkHeader: null }];
    await expect(enumerateStarsRest(fakeRest(pages))).rejects.toBeInstanceOf(
      IncompleteEnumerationError,
    );
  });

  it('counts rows missing node_id as droppedUnidentifiable', async () => {
    const pages: StarredPage[] = [
      {
        rows: [
          makeStarRow(null, '2026-05-01T00:00:00Z'),
          makeStarRow('R_1', '2026-04-01T00:00:00Z'),
        ],
        linkHeader: null,
      },
    ];
    const { seeds, droppedUnidentifiable } = await enumerateStarsRest(fakeRest(pages));
    expect(seeds).toHaveLength(1);
    expect(droppedUnidentifiable).toBe(1);
  });

  it('DET-3: every produced seed has a non-null starred_at', async () => {
    const pages: StarredPage[] = [
      { rows: [makeStarRow('R_1', '2026-05-01T00:00:00Z')], linkHeader: NEXT },
      { rows: [makeStarRow('R_2', '2026-04-01T00:00:00Z')], linkHeader: null },
    ];
    const { seeds } = await enumerateStarsRest(fakeRest(pages));
    expect(seeds.every((s) => typeof s.starred_at === 'string' && s.starred_at.length > 0)).toBe(
      true,
    );
  });
});
