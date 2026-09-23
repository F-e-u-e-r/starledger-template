import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatasetMetaSchema } from '@starred/schema';
import { verifyDatasetIntegrity } from './dataset';
import { DATASET_META_FILE, STARS_FILE } from './stage';

/**
 * Deploy-freshness guard (OPS-A). The daily sync commits fresh data to main and
 * relies on a workflow-triggering push token to fire pages.yml. If that
 * invariant ever breaks (e.g. someone swaps the App token for GITHUB_TOKEN), the
 * commit still lands but NO deploy runs — the live site silently freezes on
 * stale data with no failed run to notice. This guard makes that failure
 * OBSERVABLE by comparing the live site's published fingerprint against main
 * HEAD. It is strictly read-only: no writes, no secret, only the public artifact.
 */

export interface FreshnessResult {
  status: 'fresh' | 'drift';
  /** stars_sha256 the live site is currently serving. */
  liveSha: string;
  /** stars_sha256 committed at main HEAD — what the site SHOULD be serving. */
  expectedSha: string;
}

/**
 * Parse a fetched dataset-meta.json body and return its stars_sha256, validated
 * against the canonical schema. Throws (fail-closed) on malformed JSON or a body
 * that does not satisfy the committed contract: a monitor that cannot read the
 * live fingerprint must alarm, never silently conclude "fresh".
 */
export function parseLiveStarsSha(liveMetaText: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(liveMetaText);
  } catch {
    throw new Error('live dataset-meta.json is not valid JSON');
  }
  const parsed = DatasetMetaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('live dataset-meta.json failed dataset-meta schema validation');
  }
  return parsed.data.stars_sha256;
}

/** Pure comparison of the live fingerprint against the expected (main HEAD) one. */
export function compareFreshness(liveSha: string, expectedSha: string): FreshnessResult {
  return { status: liveSha === expectedSha ? 'fresh' : 'drift', liveSha, expectedSha };
}

export interface CheckFreshnessOptions {
  /** Absolute URL of the live dataset-meta.json, e.g. https://<owner>.github.io/<repo>/dataset-meta.json. */
  url: string;
  /** The stars_sha256 committed at main HEAD — what the live site should be serving. */
  expectedSha: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the live dataset-meta.json and compare its fingerprint to main HEAD. A
 * network failure or non-200 THROWS — the monitor cannot conclude "fresh" from
 * an unreachable site, and a false "fresh" would defeat the guard's whole point.
 */
export async function checkFreshness(opts: CheckFreshnessOptions): Promise<FreshnessResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url);
  } catch (err) {
    throw new Error(
      `could not reach the live site (${opts.url}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!res.ok) {
    throw new Error(`live dataset-meta.json → HTTP ${res.status} (${opts.url})`);
  }
  // RAW BYTES, decoded the way the BUILD decodes (Node utf8 — BOM PRESERVED).
  // `Response.text()` strips a leading BOM, so this monitor once reported a
  // live meta `fresh` that the runtime's BOM-preserving decoder rejects with
  // the base dashboard failing closed — a false-green monitor, the exact
  // reading OPS-A forbids (round-9 finding, reproduced). All ends now agree a
  // BOM is invalid: the build refuses to stage it, the runtime fails closed,
  // and this guard alarms ("not valid JSON") instead of concluding fresh.
  const liveSha = parseLiveStarsSha(Buffer.from(await res.arrayBuffer()).toString('utf8'));
  return compareFreshness(liveSha, opts.expectedSha);
}

/**
 * Public URL of the live dataset-meta.json for a project Pages site, or undefined
 * when the slug is missing/malformed. Pages subdomains are the owner login
 * lowercased; the repo path keeps its case. Pure so it is unit-testable without
 * the environment.
 */
export function deriveLiveMetaUrl(repoSlug: string | undefined): string | undefined {
  if (!repoSlug || !repoSlug.includes('/')) return undefined;
  const [owner, name] = repoSlug.split('/');
  if (!owner || !name) return undefined;
  return `https://${owner.toLowerCase()}.github.io/${name}/${DATASET_META_FILE}`;
}

export interface EvaluateFreshnessOptions {
  /** Directory holding main HEAD's stars.json + dataset-meta.json. */
  dataDir: string;
  /** Live URL override; when absent it is derived from repoSlug. */
  url?: string;
  /** Repo slug ("owner/repo") for URL derivation when url is absent. */
  repoSlug?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface FreshnessOutcome extends FreshnessResult {
  /** The live URL that was actually checked. */
  url: string;
}

/**
 * The full freshness evaluation used by the CLI/workflow. It derives main HEAD's
 * VERIFIED fingerprint by re-hashing stars.json and confirming dataset-meta
 * agrees (verifyDatasetIntegrity) — so a stale or corrupt committed meta cannot
 * "self-certify" the site as fresh against itself — then resolves the live URL,
 * fetches, and compares. Every failure mode (missing data, an inconsistent local
 * dataset, an underivable URL, an unreachable/malformed live artifact) THROWS,
 * fail-closed: the monitor never reports "fresh" from a state it could not verify.
 */
export async function evaluateDeployFreshness(
  opts: EvaluateFreshnessOptions,
): Promise<FreshnessOutcome> {
  const starsPath = join(opts.dataDir, STARS_FILE);
  const metaPath = join(opts.dataDir, DATASET_META_FILE);
  if (!existsSync(starsPath) || !existsSync(metaPath)) {
    throw new Error(
      `canonical dataset (stars.json + dataset-meta.json) not found in ${opts.dataDir}`,
    );
  }
  const expectedSha = verifyDatasetIntegrity(
    readFileSync(starsPath),
    readFileSync(metaPath, 'utf8'),
  ).sha256;
  const url = opts.url ?? deriveLiveMetaUrl(opts.repoSlug);
  if (!url) {
    throw new Error('could not derive the live URL; pass --url <https://…/dataset-meta.json>');
  }
  const result = await checkFreshness({ url, expectedSha, fetchImpl: opts.fetchImpl });
  return { ...result, url };
}
