import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeRepo, makeStarsFile } from '../test-utils';
import { DataLoadError, loadStars } from './load-stars';

/**
 * CANONICAL ACCEPTANCE PARITY (owner ruling R6-S1).
 *
 * Byte agreement is not acceptance agreement. The build refuses a dataset whose
 * `repo_count` disagrees with the repo list, or that repeats a `node_id`, and
 * for the CANONICAL dataset the runtime must refuse exactly the same artifacts —
 * otherwise "build and runtime agree" means only that they hash the same bytes.
 *
 * Both cases below carry a CORRECT digest and structurally valid JSON, so they
 * cannot be rejected for any other reason: the only thing that can stop them is
 * the invariant itself. Pinned at the `loadStars` boundary, not at a helper —
 * a guarantee is only as strong as the level it is pinned at.
 */

const utf8 = (text: string) => new TextEncoder().encode(text);
const sha256OfBytes = (bytes: Uint8Array) =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex');

function fetchFor(starsText: string, repoCount: number): typeof fetch {
  const metaJson = JSON.stringify({
    schema_version: '1.0',
    dataset_generated_at: '2026-06-18T00:00:00Z',
    stars_sha256: sha256OfBytes(utf8(starsText)),
    repo_count: repoCount,
  });
  return (async (url: string | URL) =>
    String(url).includes('dataset-meta.json')
      ? new Response(metaJson, { status: 200 })
      : new Response(Buffer.from(utf8(starsText)), { status: 200 })) as typeof fetch;
}

describe('CANON-PARITY: the runtime enforces the build-time canonical invariants', () => {
  it('CONTROL: a consistent dataset loads', async () => {
    const starsText = JSON.stringify(makeStarsFile([makeRepo({ node_id: 'R_1' })]));
    await expect(loadStars({ fetchImpl: fetchFor(starsText, 1) })).resolves.toBeTruthy();
  });

  it('rejects a repo_count that disagrees with the repo list', async () => {
    const starsText = JSON.stringify(makeStarsFile([makeRepo({ node_id: 'R_1' })]));
    // Digest is correct for these bytes; only the count is wrong.
    await expect(loadStars({ fetchImpl: fetchFor(starsText, 999) })).rejects.toBeInstanceOf(
      DataLoadError,
    );
  });

  it('rejects a duplicated node_id', async () => {
    const starsText = JSON.stringify(
      makeStarsFile([
        makeRepo({ node_id: 'R_dup', name_with_owner: 'acme/one' }),
        makeRepo({ node_id: 'R_dup', name_with_owner: 'acme/two' }),
      ]),
    );
    await expect(loadStars({ fetchImpl: fetchFor(starsText, 2) })).rejects.toBeInstanceOf(
      DataLoadError,
    );
  });
});
