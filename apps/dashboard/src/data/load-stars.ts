import {
  type DatasetMeta,
  DatasetMetaSchema,
  type StarsFile,
  StarsFileSchema,
} from '@starred/schema';

export type DataLoadKind = 'fetch' | 'schema' | 'integrity';

export class DataLoadError extends Error {
  constructor(
    message: string,
    readonly kind: DataLoadKind,
  ) {
    super(message);
    this.name = 'DataLoadError';
  }
}

export interface LoadedDataset {
  stars: StarsFile;
  meta: DatasetMeta;
}

export interface LoadOptions {
  /** Base path (GitHub Pages project sites serve from /<repo>/). */
  base?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Verify the stars.json bytes against dataset-meta.stars_sha256 (default true). */
  verifyBytes?: boolean;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface Snapshot {
  meta: DatasetMeta;
  starsText: string;
}

/** Fetch + validate dataset-meta, then fetch the sha-busted stars bytes (unparsed). */
async function fetchSnapshot(base: string, doFetch: typeof fetch): Promise<Snapshot> {
  const metaRes = await doFetch(`${base}dataset-meta.json`, { cache: 'no-cache' });
  if (!metaRes.ok) throw new DataLoadError(`dataset-meta.json HTTP ${metaRes.status}`, 'fetch');
  const metaParsed = DatasetMetaSchema.safeParse(await metaRes.json());
  if (!metaParsed.success) throw new DataLoadError('dataset-meta.json failed validation', 'schema');
  const meta = metaParsed.data;

  const starsRes = await doFetch(`${base}stars.json?sha=${meta.stars_sha256}`);
  if (!starsRes.ok) throw new DataLoadError(`stars.json HTTP ${starsRes.status}`, 'fetch');
  return { meta, starsText: await starsRes.text() };
}

/**
 * Trusted data loading, extending the P0 publication contract to the reader:
 *
 *   1. fetch dataset-meta.json (no-cache) → JSON parse → DatasetMetaSchema
 *   2. take stars_sha256
 *   3. fetch stars.json?sha=<hash>  (busts stale Pages/CDN/browser caches)
 *   4. verify the raw bytes' SHA-256 == stars_sha256 (integrity) BEFORE parsing
 *   5. parse + StarsFileSchema validation
 *
 * A single integrity mismatch is most likely a cross-deployment read race on
 * GitHub Pages (old meta + new stars, or vice versa), so the WHOLE snapshot is
 * re-fetched once before failing. Any failure throws a typed DataLoadError and
 * the UI fails closed.
 */
export async function loadStars(opts: LoadOptions = {}): Promise<LoadedDataset> {
  const base = opts.base ?? '/';
  const doFetch = opts.fetchImpl ?? fetch;

  let snapshot = await fetchSnapshot(base, doFetch);

  if (opts.verifyBytes !== false) {
    if ((await sha256Hex(snapshot.starsText)) !== snapshot.meta.stars_sha256) {
      // Re-fetch the whole snapshot once to rule out a deployment switch race.
      snapshot = await fetchSnapshot(base, doFetch);
      if ((await sha256Hex(snapshot.starsText)) !== snapshot.meta.stars_sha256) {
        throw new DataLoadError('stars.json integrity check failed (sha mismatch)', 'integrity');
      }
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.starsText);
  } catch {
    throw new DataLoadError('stars.json is not valid JSON', 'schema');
  }
  const starsParsed = StarsFileSchema.safeParse(parsed);
  if (!starsParsed.success) throw new DataLoadError('stars.json failed validation', 'schema');

  return { stars: starsParsed.data, meta: snapshot.meta };
}
