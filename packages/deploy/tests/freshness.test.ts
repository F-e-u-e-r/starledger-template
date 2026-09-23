import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFixtureDataset } from '../src/fixture';
import {
  checkFreshness,
  compareFreshness,
  deriveLiveMetaUrl,
  evaluateDeployFreshness,
  parseLiveStarsSha,
} from '../src/freshness';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const validLiveMeta = JSON.stringify({
  schema_version: '1.0',
  dataset_generated_at: '2026-07-07T00:00:00.000Z',
  stars_sha256: SHA_A,
  repo_count: 550,
});

/**
 * A REAL Response, not a hand-rolled double: the guard reads the raw bytes
 * (`arrayBuffer`) so its decode matches the build's BOM-preserving one, and a
 * text-only double cannot express that distinction (`ok` derives from status).
 */
function mockFetch(body: string, _ok = true, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

const URL = 'https://example.github.io/repo/dataset-meta.json';

describe('deploy freshness guard (OPS-A)', () => {
  it('BOM-PARITY: a BOM-prefixed live meta is never reported fresh', async () => {
    // Round-9 finding (luna@ultra, author-reproduced): `Response.text()` strips
    // a leading BOM, so the monitor called a BOM-prefixed live meta `fresh`
    // while the runtime's BOM-preserving decoder REJECTS the same bytes and
    // the base dashboard fails closed — a false-green production monitor, the
    // exact reading OPS-A forbids ("never 'fresh' from unverifiable"). A real
    // `Response` is required: a hand-rolled double exposing only `text()`
    // cannot express the distinction under test.
    const bomBody = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(validLiveMeta, 'utf8'),
    ]);
    const fetchImpl = (async () => new Response(bomBody, { status: 200 })) as typeof fetch;
    await expect(checkFreshness({ url: URL, expectedSha: SHA_A, fetchImpl })).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('MATCH: live fingerprint equals main HEAD → fresh', async () => {
    const r = await checkFreshness({
      url: URL,
      expectedSha: SHA_A,
      fetchImpl: mockFetch(validLiveMeta),
    });
    expect(r.status).toBe('fresh');
    expect(r.liveSha).toBe(SHA_A);
  });

  it('MISMATCH: live differs from main HEAD → drift (both fingerprints surfaced)', async () => {
    const r = await checkFreshness({
      url: URL,
      expectedSha: SHA_B,
      fetchImpl: mockFetch(validLiveMeta),
    });
    expect(r.status).toBe('drift');
    expect(r.liveSha).toBe(SHA_A);
    expect(r.expectedSha).toBe(SHA_B);
  });

  it('MISSING live meta: HTTP 404 → throws (cannot conclude fresh)', async () => {
    await expect(
      checkFreshness({
        url: URL,
        expectedSha: SHA_A,
        fetchImpl: mockFetch('not found', false, 404),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('MALFORMED live meta: invalid JSON → throws', async () => {
    await expect(
      checkFreshness({ url: URL, expectedSha: SHA_A, fetchImpl: mockFetch('{not json') }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('MALFORMED live meta: valid JSON but fails the dataset-meta schema → throws', () => {
    expect(() => parseLiveStarsSha(JSON.stringify({ stars_sha256: 'short' }))).toThrow(
      /schema validation/,
    );
  });

  it('NETWORK failure: fetch rejects → throws (never silently "fresh")', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(
      checkFreshness({ url: URL, expectedSha: SHA_A, fetchImpl: failing }),
    ).rejects.toThrow(/could not reach/);
  });

  it('compareFreshness is pure', () => {
    expect(compareFreshness(SHA_A, SHA_A).status).toBe('fresh');
    expect(compareFreshness(SHA_A, SHA_B).status).toBe('drift');
  });
});

describe('deriveLiveMetaUrl', () => {
  it('derives a project Pages URL with the owner login lowercased', () => {
    expect(deriveLiveMetaUrl('F-e-u-e-r/starledger')).toBe(
      'https://f-e-u-e-r.github.io/starledger/dataset-meta.json',
    );
  });

  it('returns undefined for a missing or malformed slug', () => {
    expect(deriveLiveMetaUrl(undefined)).toBeUndefined();
    expect(deriveLiveMetaUrl('noslash')).toBeUndefined();
    expect(deriveLiveMetaUrl('/repo')).toBeUndefined();
    expect(deriveLiveMetaUrl('owner/')).toBeUndefined();
  });
});

describe('evaluateDeployFreshness (CLI flow, verified main-HEAD fingerprint)', () => {
  const url = 'https://example.github.io/repo/dataset-meta.json';

  function fixtureDir(): { dir: string; sha: string } {
    const dir = mkdtempSync(join(tmpdir(), 'freshness-cli-'));
    writeFixtureDataset(dir);
    const sha = (
      JSON.parse(readFileSync(join(dir, 'dataset-meta.json'), 'utf8')) as {
        stars_sha256: string;
      }
    ).stars_sha256;
    return { dir, sha };
  }

  function liveMeta(sha: string): string {
    return JSON.stringify({
      schema_version: '1.0',
      dataset_generated_at: '2026-07-07T00:00:00.000Z',
      stars_sha256: sha,
      repo_count: 1,
    });
  }

  it('FRESH: live fingerprint equals the re-hashed main-HEAD dataset', async () => {
    const { dir, sha } = fixtureDir();
    const outcome = await evaluateDeployFreshness({
      dataDir: dir,
      url,
      fetchImpl: mockFetch(liveMeta(sha)),
    });
    expect(outcome.status).toBe('fresh');
    expect(outcome.expectedSha).toBe(sha);
    expect(outcome.url).toBe(url);
  });

  it('DRIFT: live fingerprint differs from main HEAD', async () => {
    const { dir, sha } = fixtureDir();
    const outcome = await evaluateDeployFreshness({
      dataDir: dir,
      url,
      fetchImpl: mockFetch(liveMeta('f'.repeat(64))),
    });
    expect(outcome.status).toBe('drift');
    expect(outcome.expectedSha).toBe(sha);
    expect(outcome.liveSha).toBe('f'.repeat(64));
  });

  it('throws when the committed dataset is absent (fail-closed)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'freshness-empty-'));
    await expect(evaluateDeployFreshness({ dataDir: empty, url })).rejects.toThrow(/not found/);
  });

  it('throws when the URL cannot be derived and none is passed', async () => {
    const { dir } = fixtureDir();
    await expect(evaluateDeployFreshness({ dataDir: dir, repoSlug: undefined })).rejects.toThrow(
      /could not derive the live URL/,
    );
  });

  it('propagates an unreachable live site (never silently "fresh")', async () => {
    const { dir } = fixtureDir();
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(
      evaluateDeployFreshness({ dataDir: dir, url, fetchImpl: failing }),
    ).rejects.toThrow(/could not reach/);
  });
});
