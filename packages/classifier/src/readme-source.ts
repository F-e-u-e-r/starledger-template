import { RetryCoordinator, RetryableResponseError, classifyError } from '@starred/github-client';
import type { GithubClient } from '@starred/github-client';

export interface RepoCoordinates {
  owner: string;
  name: string;
}

export interface ReadmeRef {
  /** Repo-relative path of the preferred README (e.g. `README.md`, `docs/README.md`). */
  path: string;
  /** Opaque Git blob OID from GitHub (not a StarLedger SHA-256). */
  oid: string;
}

/**
 * The seam between trusted planning and GitHub, split so the planner avoids the
 * expensive operation:
 *   - `getReadmeRef`: the lightweight identity probe — preferred README path +
 *     blob OID, NO content. A `null` means "no README the pipeline can actually
 *     LOAD" — not merely "GitHub reports no preferred path": a README whose
 *     bytes the endpoint will not return (over 1 MB → `encoding: "none"`) is
 *     reported as null too, so the planner and the provenance gate always reach
 *     the same source kind. When `knownPath` is supplied (the path a prior run
 *     recorded) an implementation MAY resolve the current OID for exactly that
 *     path without downloading any content, falling back to full preferred-README
 *     discovery only when the path no longer exists. `knownPath` is an
 *     optimization hint, never authoritative — the provenance gate omits it so it
 *     always rediscovers the true preferred README;
 *   - `getReadmeContent`: the heavyweight byte fetch, called ONLY when a
 *     (re)classification is actually required.
 *
 * An unchanged README is therefore detected without transferring its payload
 * (README-2). Preprocessing is a separate pure function with no access to this
 * seam, so a link inside a README is never fetched (README-6).
 */
export interface ReadmeSource {
  getReadmeRef(repo: RepoCoordinates, knownPath?: string | null): Promise<ReadmeRef | null>;
  getReadmeContent(repo: RepoCoordinates, path: string): Promise<string | null>;
}

interface GithubReadmeResponse {
  path?: unknown;
  sha?: unknown;
  content?: unknown;
  encoding?: unknown;
}

/** The ONE definition of a README the pipeline can actually load, shared by
 * discovery (`getReadmeRef`) and the byte fetch (`getReadmeContent`) so the two
 * can never disagree about a repo's source kind. An EMPTY base64 content is a
 * usable (empty) README; `encoding: "none"` — GitHub's shape for files over
 * 1 MB, whose bytes the endpoint refuses to return — is not. */
function isLoadableReadme(res: GithubReadmeResponse): boolean {
  return typeof res.content === 'string' && res.encoding === 'base64';
}

interface BlobOidResponse {
  repository: { object: { oid?: unknown } | null } | null;
}

/** Resolve a blob's OID at a path on HEAD WITHOUT transferring its content. */
const BLOB_OID_QUERY = `query BlobOid($owner: String!, $name: String!, $expr: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expr) {
      oid
    }
  }
}`;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: number }).status === 404
  );
}

/**
 * True for the `@octokit/graphql` error raised when a query names a repository
 * that no longer resolves — deleted, renamed away, or turned private since it was
 * starred. GitHub answers with HTTP 200 and a top-level `errors` array (a
 * `GraphqlResponseError`), which is structurally distinct from an HTTP-status
 * `RequestError` (auth / rate limit / 5xx): the latter carries no `errors` array,
 * so it returns false here and is left to propagate. Matching by error `type`
 * (not message text) keeps this stable across GitHub's wording changes.
 */
function isRepositoryNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;
  // Swallow ONLY when EVERY reported error is a NOT_FOUND rooted at the top-level
  // `repository` field. BLOB_OID_QUERY resolves exactly one node (`repository`), so
  // GitHub's real deleted-repo answer is a lone `{ type: NOT_FOUND, path: ['repository'] }`.
  // Requiring every entry to be a repository NOT_FOUND means a MIXED array (a
  // NOT_FOUND alongside a transient or other error) — or a NOT_FOUND on a different
  // field — is left to propagate, never masked as "repo gone". A NOT_FOUND with no
  // path still matches, so the real deleted-repo error can never slip back to a crash.
  return errors.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const { type, path } = entry as { type?: unknown; path?: unknown };
    if (type !== 'NOT_FOUND') return false;
    // path is exactly ['repository'] for the real deleted-repo error. Tolerate an
    // ABSENT path (defensive — never miss the real error), but reject a nested
    // (['repository','object']) or different-field (['viewer'], 'viewer') path so an
    // unrelated NOT_FOUND is never swallowed as "repo gone".
    return (
      path === undefined ||
      path === null ||
      (Array.isArray(path) && path.length === 1 && path[0] === 'repository')
    );
  });
}

/**
 * Production {@link ReadmeSource} over GitHub.
 *
 * For a KNOWN README path, `getReadmeRef` issues a single GraphQL
 * `object(expression: "HEAD:<path>") { oid }` query that returns the current blob
 * OID and NO content — so an unchanged README is detected without ever
 * transferring the payload. Only first discovery (no known path) or a README that
 * has moved/disappeared falls back to the REST preferred-README endpoint (which
 * does return content; it is fetched once, memoized, and reused by
 * `getReadmeContent`). A missing README (404 / null object) is a normal outcome →
 * `null`. Tests inject a fake instead of this.
 */
export class OctokitReadmeSource implements ReadmeSource {
  private readonly preferredReadmeCache = new Map<string, GithubReadmeResponse | null>();

  constructor(
    private readonly client: Pick<GithubClient, 'octokit' | 'graphql'>,
    // One coordinator per source instance, reused across the whole per-repo sweep so
    // its GLOBAL secondary-limit cooldown pauses every probe together. The shared
    // wait budget is deliberate: a single transient blip is absorbed by the bounded
    // retries below, but a SUSTAINED outage exhausts the budget and surfaces a
    // DeferredError, which the CLI treats as "defer this run, keep last-known-good,
    // retry next schedule" (exit 20) instead of corrupting state or hammering GitHub.
    private readonly coordinator: RetryCoordinator = new RetryCoordinator(),
  ) {}

  async getReadmeRef(repo: RepoCoordinates, knownPath?: string | null): Promise<ReadmeRef | null> {
    if (knownPath !== undefined && knownPath !== null && knownPath !== '') {
      const oid = await this.blobOid(repo, knownPath);
      if (oid !== null) return { path: knownPath, oid }; // content-free OID probe
      // the known path no longer exists → fall through to authoritative discovery
    }
    const res = await this.requestReadme(repo);
    // A README the pipeline cannot LOAD is reported exactly like a missing one.
    // GitHub answers 200 for a preferred README over 1 MB but omits the bytes
    // (`encoding: "none"`, empty content); treating that as a usable ref made the
    // planner demote to a metadata-kind job while the provenance gate (which
    // probes refs only, never content) still expected readme-kind — a permanent
    // plan/gate split observed live on PRs #91/#92 (2026-07-16/17). Discovery and
    // content fetch share ONE usability predicate so they can never diverge again.
    if (res === null || !isLoadableReadme(res)) return null;
    const path = typeof res.path === 'string' ? res.path : null;
    const oid = typeof res.sha === 'string' ? res.sha : null;
    return path !== null && oid !== null ? { path, oid } : null;
  }

  async getReadmeContent(repo: RepoCoordinates, path: string): Promise<string | null> {
    const res = await this.requestReadme(repo);
    if (res === null || res.path !== path || !isLoadableReadme(res)) {
      return null;
    }
    return Buffer.from(res.content as string, 'base64').toString('utf8');
  }

  /**
   * Current blob OID for a path at HEAD, resolved via GraphQL WITHOUT content.
   *
   * Wrapped in the shared {@link RetryCoordinator} so a transient GitHub fault
   * (secondary rate limit, 5xx, GraphQL exec timeout, or a data-less envelope)
   * retries with bounded backoff — the production `graphql` client, unlike REST,
   * carries no retry/throttle of its own. A repository that no longer resolves
   * (NOT_FOUND) short-circuits to null; auth/invalid errors are terminal and
   * propagate. If the transient never recovers the coordinator raises a DeferredError
   * (exit 20) so the run defers and keeps last-known-good rather than crashing.
   */
  private async blobOid(repo: RepoCoordinates, path: string): Promise<string | null> {
    const data = await this.coordinator.run<BlobOidResponse | null>(
      async () => {
        let res: unknown;
        try {
          res = await this.client.graphql<BlobOidResponse>(BLOB_OID_QUERY, {
            owner: repo.owner,
            name: repo.name,
            expr: `HEAD:${path}`,
          });
        } catch (error) {
          // BLOB_OID_QUERY selects exactly one resolvable node (`repository`); a
          // missing blob path yields `object: null` with NO error, so a NOT_FOUND
          // rooted there means the repository itself is gone. Resolve to null so
          // the coordinator does NOT retry a repo that will never come back.
          if (isRepositoryNotFound(error)) return null;
          throw error; // transient → coordinator retries; terminal → fails loudly
        }
        // A valid response is a record carrying the `repository` field (possibly
        // null). Anything else — a data-less 2xx envelope (raw @octokit/graphql
        // yields `undefined`), `{}`, or an array — is a transient GitHub glitch, NOT
        // "no README"; retry it like github-client's requireResponse rather than
        // silently downgrading to a REST content fetch.
        if (typeof res !== 'object' || res === null || !('repository' in res)) {
          throw new RetryableResponseError(
            'GitHub GraphQL blob-OID probe returned no data envelope',
          );
        }
        return res as BlobOidResponse;
      },
      { classify: classifyError },
    );
    // `null` means the repository is gone (settled). A live repo with no README at
    // this path resolves to `{ repository: { object: null } }` → undefined oid →
    // null ref, so getReadmeRef falls through to REST discovery.
    if (data === null) return null;
    const oid = data.repository?.object?.oid;
    return typeof oid === 'string' ? oid : null;
  }

  private async requestReadme(repo: RepoCoordinates): Promise<GithubReadmeResponse | null> {
    const key = `${repo.owner}/${repo.name}`;
    const cached = this.preferredReadmeCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const res = await this.client.octokit.request('GET /repos/{owner}/{repo}/readme', {
        owner: repo.owner,
        repo: repo.name,
      });
      const result = res.data as unknown as GithubReadmeResponse;
      this.preferredReadmeCache.set(key, result);
      return result;
    } catch (error) {
      if (isNotFound(error)) {
        this.preferredReadmeCache.set(key, null);
        return null;
      }
      throw error;
    }
  }
}
