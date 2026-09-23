import {
  type DatasetMeta,
  DatasetMetaSchema,
  type StarsFile,
  StarsFileSchema,
  checkCanonicalDatasetInvariants,
} from '@starred/schema';
import { parseMetaJson, readBytesVerified, readMetaBytes } from './integrity';

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
}

interface Snapshot {
  meta: DatasetMeta;
  /**
   * Decoded ONLY when the received bytes hashed to `meta.stars_sha256`;
   * `null` marks an integrity mismatch. Integrity is not optional and cannot
   * be disabled by a caller.
   */
  starsText: string | null;
}

/** Fetch + validate dataset-meta, then fetch and byte-verify the sha-busted stars body. */
async function fetchSnapshot(base: string, doFetch: typeof fetch): Promise<Snapshot> {
  // EVERY failure below is converted to a typed DataLoadError. The transport
  // and JSON layers reject with their own error types — a rejected fetch, a
  // malformed meta body, a broken response stream — and letting those escape
  // untyped means the UI cannot tell a fetch problem from a schema problem and
  // falls back to a generic "something went wrong" (review finding).
  const metaRes = await typedFetch(
    () => doFetch(`${base}dataset-meta.json`, { cache: 'no-cache' }),
    'dataset-meta.json unreachable',
  );
  if (!metaRes.ok) throw new DataLoadError(`dataset-meta.json HTTP ${metaRes.status}`, 'fetch');
  // Through the thunk boundary for the same reason as the fetch above: calling
  // it first and attaching `.catch` afterwards leaves a SYNCHRONOUS throw
  // untyped. `readMetaJson` also decodes without swallowing a BOM, so meta
  // acceptance matches the build's instead of diverging on the pair's other
  // half (review findings).
  // Read and parse are SEPARATE steps with different kinds: a broken stream is
  // a transport failure, not a schema failure, and the UI distinguishes them.
  // Collapsing both under `schema` made a stream reset render as "Data failed
  // validation" (review finding).
  const metaBytes = await typedStep(
    () => readMetaBytes(metaRes),
    'dataset-meta.json body could not be read',
    'fetch',
  );
  const metaJson = await typedStep(
    async () => parseMetaJson(metaBytes),
    'dataset-meta.json is not readable JSON',
    'schema',
  );
  const metaParsed = DatasetMetaSchema.safeParse(metaJson);
  if (!metaParsed.success) throw new DataLoadError('dataset-meta.json failed validation', 'schema');
  const meta = metaParsed.data;

  const starsRes = await typedFetch(
    () => doFetch(`${base}stars.json?sha=${meta.stars_sha256}`),
    'stars.json unreachable',
  );
  if (!starsRes.ok) throw new DataLoadError(`stars.json HTTP ${starsRes.status}`, 'fetch');
  const starsText = await readBytesVerified(starsRes, meta.stars_sha256).catch((error: unknown) => {
    throw new DataLoadError(`stars.json body could not be read: ${describe(error)}`, 'fetch');
  });
  return { meta, starsText };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run a fetch inside the typed-error boundary.
 *
 * The obvious `doFetch(...).catch(...)` form does NOT cover a SYNCHRONOUS
 * throw: the call is evaluated before `.catch` is attached, so the error
 * escapes untyped and the UI falls back to its unknown-error path. Invoking
 * through a thunk puts both the call and its rejection inside the boundary.
 */
async function typedStep<T>(call: () => Promise<T>, label: string, kind: DataLoadKind): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new DataLoadError(`${label}: ${describe(error)}`, kind);
  }
}

async function typedFetch(call: () => Promise<Response>, label: string): Promise<Response> {
  return typedStep(call, label, 'fetch');
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

  if (snapshot.starsText === null) {
    // Re-fetch the whole snapshot once to rule out a deployment switch race.
    snapshot = await fetchSnapshot(base, doFetch);
    if (snapshot.starsText === null) {
      throw new DataLoadError('stars.json integrity check failed (sha mismatch)', 'integrity');
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

  // Structural invariants, from the SAME shared primitive the build uses
  // (owner ruling R6-S1). Byte agreement is not acceptance agreement: a
  // correctly-hashed dataset whose `repo_count` disagrees with the repo list,
  // or that repeats a `node_id`, is refused at build time and must be refused
  // here too — otherwise the canonical browser renders a dataset the build
  // would never have published.
  const problems = checkCanonicalDatasetInvariants(starsParsed.data, snapshot.meta);
  if (problems.length > 0) throw new DataLoadError(`stars.json ${problems[0]}`, 'schema');

  return { stars: starsParsed.data, meta: snapshot.meta };
}
