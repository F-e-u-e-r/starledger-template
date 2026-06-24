import { Octokit } from '@octokit/rest';
import { IncompleteEnumerationError } from './errors';
import { classifyError, RetryCoordinator } from './retry';

/**
 * REST `/user/starred` fallback enumeration.
 *
 * When the GraphQL probe reports `isOverLimit === true`, GraphQL cannot return
 * the complete star list. The complete enumeration comes from REST using:
 *
 *     Accept: application/vnd.github.star+json
 *
 * which preserves the `starred_at` timestamp (a plain Accept header drops it).
 * Pagination follows the `Link: rel="next"` chain — NOT a `rows.length < 100`
 * heuristic. Metadata is then hydrated via GraphQL `nodes(ids:)`.
 */

/** A single `star+json` row. The repo object also carries identity used for degraded records. */
export interface StarRow {
  starred_at: string | null;
  repo: { node_id: string | null; full_name?: string | null; html_url?: string | null };
}

export interface StarredPage {
  rows: StarRow[];
  /** Raw `Link` response header; pagination is decided from this, not row count. */
  linkHeader: string | null;
  /** REST rate-limit budget from response headers (observability). */
  rateRemaining?: number | null;
  rateResetAt?: string | null;
}

export interface StarredRestClient {
  fetchStarredPage(page: number, perPage: number): Promise<StarredPage>;
}

/** Enumeration seed: identity + star timestamp. Identity lets us emit a degraded record if hydration fails. */
export interface Seed {
  node_id: string;
  starred_at: string;
  name_with_owner: string | null;
  url: string | null;
}

export interface RestEnumerationResult {
  seeds: Seed[];
  /** Rows that could not be turned into a seed (missing node_id). */
  droppedUnidentifiable: number;
  /** Same node_id + same starred_at: a benign duplicate, deduped. */
  duplicateCount: number;
  /** Same node_id + DIFFERENT starred_at: a snapshot conflict (caller restarts). */
  duplicateConflictCount: number;
  /** Number of REST pages fetched. */
  pages: number;
  /** REST rate-limit budget from the last page (observability). */
  rateRemaining: number | null;
  rateResetAt: string | null;
}

/** True iff the Link header advertises a `rel="next"` page. */
export function parseNextLink(linkHeader: string | null): boolean {
  if (!linkHeader) return false;
  return /;\s*rel="next"/.test(linkHeader);
}

/**
 * Enumerate the complete star list via REST, following the Link chain to the end.
 * Page fetches go through the shared retry coordinator.
 *
 *  - `starred_at` missing on a row ⇒ IncompleteEnumerationError (fail closed).
 *  - `repo.node_id` missing ⇒ droppedUnidentifiable.
 *  - same node_id, same starred_at ⇒ duplicateCount (deduped).
 *  - same node_id, different starred_at ⇒ duplicateConflictCount (snapshot conflict).
 */
export async function enumerateStarsRest(
  client: StarredRestClient,
  opts: { perPage?: number; coordinator?: RetryCoordinator } = {},
): Promise<RestEnumerationResult> {
  const perPage = opts.perPage ?? 100;
  const coordinator = opts.coordinator ?? new RetryCoordinator();
  const seeds: Seed[] = [];
  const firstSeen = new Map<string, string>(); // node_id -> first starred_at
  let droppedUnidentifiable = 0;
  let duplicateCount = 0;
  let duplicateConflictCount = 0;
  let pages = 0;
  let rateRemaining: number | null = null;
  let rateResetAt: string | null = null;
  let page = 1;

  for (;;) {
    const result = await coordinator.run(() => client.fetchStarredPage(page, perPage), {
      classify: classifyError,
    });
    pages += 1;
    rateRemaining = result.rateRemaining ?? rateRemaining;
    rateResetAt = result.rateResetAt ?? rateResetAt;

    for (const row of result.rows) {
      if (row.starred_at === null || row.starred_at === undefined) {
        throw new IncompleteEnumerationError(
          `starred_at missing for node ${row.repo.node_id ?? '<unknown>'} — star+json not applied?`,
        );
      }
      const id = row.repo.node_id;
      if (!id) {
        droppedUnidentifiable += 1;
        continue;
      }
      const seen = firstSeen.get(id);
      if (seen !== undefined) {
        if (seen === row.starred_at) duplicateCount += 1;
        else duplicateConflictCount += 1;
        continue; // keep the first occurrence; node_id is the PK
      }
      firstSeen.set(id, row.starred_at);
      seeds.push({
        node_id: id,
        starred_at: row.starred_at,
        name_with_owner: row.repo.full_name ?? null,
        url: row.repo.html_url ?? null,
      });
    }

    if (!parseNextLink(result.linkHeader)) break; // stop on the Link chain, not row count
    page += 1;
  }

  return {
    seeds,
    droppedUnidentifiable,
    duplicateCount,
    duplicateConflictCount,
    pages,
    rateRemaining,
    rateResetAt,
  };
}

/** Production REST client backed by Octokit, using the `star+json` media type. */
export class OctokitStarredClient implements StarredRestClient {
  constructor(private readonly octokit: Octokit) {}

  async fetchStarredPage(page: number, perPage: number): Promise<StarredPage> {
    const res = await this.octokit.request('GET /user/starred', {
      per_page: perPage,
      page,
      headers: { accept: 'application/vnd.github.star+json' },
    });
    const data = res.data as unknown as Array<{
      starred_at?: string;
      repo?: { node_id?: string; full_name?: string; html_url?: string };
    }>;
    const rows: StarRow[] = data.map((row) => ({
      starred_at: row.starred_at ?? null,
      repo: {
        node_id: row.repo?.node_id ?? null,
        full_name: row.repo?.full_name ?? null,
        html_url: row.repo?.html_url ?? null,
      },
    }));
    const link = res.headers.link;
    const remainingHeader = res.headers['x-ratelimit-remaining'];
    const resetHeader = res.headers['x-ratelimit-reset'];
    const rateRemaining = remainingHeader !== undefined ? Number(remainingHeader) : null;
    const rateResetAt =
      resetHeader !== undefined ? new Date(Number(resetHeader) * 1000).toISOString() : null;
    return {
      rows,
      linkHeader: typeof link === 'string' ? link : null,
      rateRemaining: Number.isFinite(rateRemaining) ? rateRemaining : null,
      rateResetAt,
    };
  }
}

/** Build a production REST client. `fetch` is injectable for tests. */
export function createOctokitStarredClient(
  opts: { token?: string; fetch?: typeof globalThis.fetch } = {},
): StarredRestClient {
  const octokit = new Octokit({
    auth: opts.token,
    ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}),
  });
  return new OctokitStarredClient(octokit);
}
