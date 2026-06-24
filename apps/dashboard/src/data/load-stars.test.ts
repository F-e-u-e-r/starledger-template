import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeRepo, makeStarsFile } from '../test-utils';
import { DataLoadError, loadStars } from './load-stars';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

interface FakeOpts {
  metaJson: string;
  starsText: string;
  metaStatus?: number;
  starsStatus?: number;
  onUrl?: (url: string) => void;
}

function fakeFetch(opts: FakeOpts): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    opts.onUrl?.(u);
    if (u.includes('dataset-meta.json'))
      return new Response(opts.metaJson, { status: opts.metaStatus ?? 200 });
    if (u.includes('stars.json'))
      return new Response(opts.starsText, { status: opts.starsStatus ?? 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function meta(starsText: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: '1.0',
    dataset_generated_at: '2026-06-18T00:00:00Z',
    stars_sha256: sha(starsText),
    repo_count: 1,
    ...overrides,
  });
}

/** Serves a different meta+stars pair per full snapshot (a snapshot starts on each meta fetch). */
function snapshotFetch(
  snapshots: ReadonlyArray<{ metaJson: string; starsText: string }>,
  onMetaFetch?: () => void,
): typeof fetch {
  let round = -1;
  const at = (i: number) => snapshots[Math.min(i, snapshots.length - 1)];
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('dataset-meta.json')) {
      round += 1;
      onMetaFetch?.();
      return new Response(at(round)?.metaJson ?? '{}', { status: 200 });
    }
    if (u.includes('stars.json')) {
      return new Response(at(Math.max(round, 0))?.starsText ?? '{}', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('loadStars (trusted loading)', () => {
  it('DATA-1: valid meta + stars passes schema and integrity and returns the dataset', async () => {
    const starsText = JSON.stringify(
      makeStarsFile([makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' })]),
    );
    const result = await loadStars({
      fetchImpl: fakeFetch({ metaJson: meta(starsText), starsText }),
    });
    expect(result.stars.repos).toHaveLength(1);
    expect(result.stars.repos[0]?.name_with_owner).toBe('a/one');
  });

  it('DATA-2: schema-invalid stars.json fails closed (kind=schema)', async () => {
    const starsText = '{"schema_version":"1.0","repos":[{"bad":true}]}';
    await expect(
      loadStars({
        fetchImpl: fakeFetch({ metaJson: meta(starsText, { repo_count: 1 }), starsText }),
      }),
    ).rejects.toMatchObject({ kind: 'schema' });
  });

  it('DATA-3: a sha mismatch is an integrity error', async () => {
    const starsText = JSON.stringify(makeStarsFile([makeRepo({ node_id: 'R_1' })]));
    const badMeta = meta(starsText, { stars_sha256: '0'.repeat(64) });
    await expect(
      loadStars({ fetchImpl: fakeFetch({ metaJson: badMeta, starsText }) }),
    ).rejects.toMatchObject({ kind: 'integrity' });
  });

  it('DATA-3B: a transient cross-deploy mismatch recovers on a full retry', async () => {
    const stars = JSON.stringify(
      makeStarsFile([makeRepo({ node_id: 'R_1', name_with_owner: 'a/one' })]),
    );
    const snapshots = [
      { metaJson: meta(stars, { stars_sha256: '0'.repeat(64) }), starsText: stars }, // race: wrong hash
      { metaJson: meta(stars), starsText: stars }, // settled: correct hash
    ];
    const result = await loadStars({ fetchImpl: snapshotFetch(snapshots) });
    expect(result.stars.repos[0]?.name_with_owner).toBe('a/one');
  });

  it('DATA-3C: a persistent mismatch fails closed after retrying the whole snapshot', async () => {
    const stars = JSON.stringify(makeStarsFile([makeRepo({ node_id: 'R_1' })]));
    let metaFetches = 0;
    const bad = { metaJson: meta(stars, { stars_sha256: '0'.repeat(64) }), starsText: stars };
    await expect(
      loadStars({ fetchImpl: snapshotFetch([bad, bad], () => (metaFetches += 1)) }),
    ).rejects.toMatchObject({ kind: 'integrity' });
    expect(metaFetches).toBe(2); // the whole snapshot was re-fetched once
  });

  it('EMPTY-1: an empty dataset loads cleanly (not an error)', async () => {
    const starsText = JSON.stringify(makeStarsFile([]));
    const result = await loadStars({
      fetchImpl: fakeFetch({ metaJson: meta(starsText, { repo_count: 0 }), starsText }),
    });
    expect(result.stars.repos).toHaveLength(0);
  });

  it('PATH-1: requests are prefixed with the base path and sha-busted', async () => {
    const starsText = JSON.stringify(makeStarsFile([makeRepo({ node_id: 'R_1' })]));
    const urls: string[] = [];
    await loadStars({
      base: '/starledger/',
      fetchImpl: fakeFetch({ metaJson: meta(starsText), starsText, onUrl: (u) => urls.push(u) }),
    });
    expect(urls[0]).toBe('/starledger/dataset-meta.json');
    expect(urls[1]).toMatch(/^\/starledger\/stars\.json\?sha=[0-9a-f]{64}$/);
  });

  it('a fetch failure is a fetch error (fail closed)', async () => {
    await expect(
      loadStars({ fetchImpl: fakeFetch({ metaJson: '{}', starsText: '{}', metaStatus: 404 }) }),
    ).rejects.toBeInstanceOf(DataLoadError);
  });
});
