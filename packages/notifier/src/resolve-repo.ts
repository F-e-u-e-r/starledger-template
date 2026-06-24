import {
  AuthError,
  classifyError,
  createGithubClient,
  DeferredError,
  type ErrorClass,
  type RetryCoordinator,
} from '@starred/github-client';
import { extractGithubCandidates } from './github-url';
import type { DiscoveryItem, RepoRelease, ResolvedRepository } from './models';

/**
 * A narrowly typed GitHub boundary. Production uses the shared Octokit client;
 * tests inject a fake so URL handling and delivery semantics stay offline.
 */
export interface GithubRepositoryClient {
  /**
   * Hydrate an input owner/repo to its current public identity. `null` means
   * inaccessible, deleted, or private and is intentionally not an error.
   */
  getPublicRepository(owner: string, repo: string): Promise<ResolvedRepository | null>;
}

/**
 * P2.2 contract boundary. A resolver must return current GitHub identities and
 * deduplicate by repository node id, so renamed/transferred repositories are
 * delivered under their hydrated current name and URL.
 */
export interface RepositoryResolver {
  resolve(item: DiscoveryItem): Promise<ResolvedRepository[]>;
}

export interface RepositoryResolutionResult {
  /** The valid GitHub references extracted from the source item. */
  candidateCount: number;
  /** Public repositories, deduplicated by stable node id. */
  repositories: ResolvedRepository[];
}

interface RestRepository {
  node_id: string;
  full_name: string;
  owner: { login: string };
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  license: { spdx_id: string | null } | null;
  archived: boolean;
  fork: boolean;
  private: boolean;
}

interface RestRelease {
  tag_name: string;
  published_at: string | null;
  html_url: string;
}

/**
 * Maps the GitHub REST representation to the notifier contract. This is kept
 * pure so the no-private-discovery rule is testable independently of Octokit.
 */
export function toPublicResolvedRepository(
  data: RestRepository,
  latest_release: RepoRelease | null,
): ResolvedRepository | null {
  if (data.private) return null;
  return {
    node_id: data.node_id,
    name_with_owner: data.full_name,
    owner: data.owner.login,
    name: data.name,
    url: data.html_url,
    description: data.description,
    primary_language: data.language,
    topics: [...(data.topics ?? [])].sort((a, b) => a.localeCompare(b)),
    stargazer_count: data.stargazers_count,
    license_spdx: data.license?.spdx_id ?? null,
    is_archived: data.archived,
    is_fork: data.fork,
    latest_release,
  };
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number }).status === 404;
}

function isUnauthorized(err: unknown): boolean {
  return (err as { status?: number }).status === 401;
}

function resolutionError(ownerRepo: string, err: unknown): Error {
  if (err instanceof Error && 'exitCode' in err) return err;
  // A 401 is a bad/expired PAT: it will fail identically for every candidate and
  // every run until the token is fixed, so it is run-level fatal (exit 10), not a
  // per-item deferral. (A 403 — often a rate limit — keeps the deferred path.)
  if (isUnauthorized(err)) {
    return new AuthError(
      `GitHub authentication failed while resolving ${ownerRepo} — check STAR_SYNC_TOKEN`,
    );
  }
  const cls: ErrorClass = classifyError(err);
  const message = err instanceof Error ? err.message : String(err);
  if (cls === 'terminal') {
    // Candidate-level terminal failures (for example an inaccessible repository)
    // must not discard durable work. A later run may use a changed token or see
    // a repository made public, so keep the item pending and surface exit 20.
    return new DeferredError(
      `repository resolution failed for ${ownerRepo}: ${message}`,
      'RESOLUTION_FAILED',
    );
  }
  return new DeferredError(
    `repository resolution deferred for ${ownerRepo}: ${message}`,
    'RESOLUTION_DEFERRED',
  );
}

/**
 * Production REST client. `repos.get` resolves redirects caused by a rename or
 * transfer and returns the repository's current `node_id`, `full_name`, and
 * `html_url`. Private and inaccessible repositories deliberately resolve to
 * null: StarLedger never discovers private repositories.
 */
export function createOctokitRepositoryClient(token: string): GithubRepositoryClient {
  const { octokit } = createGithubClient(token, 'starledger-notifier');

  return {
    async getPublicRepository(owner, repo) {
      let data: RestRepository;
      try {
        const result = await octokit.repos.get({ owner, repo });
        data = result.data as unknown as RestRepository;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw resolutionError(`${owner}/${repo}`, err);
      }

      if (data.private) return null;

      let latest_release: RepoRelease | null = null;
      try {
        const result = await octokit.repos.getLatestRelease({
          owner: data.owner.login,
          repo: data.name,
        });
        const release = result.data as unknown as RestRelease;
        latest_release = {
          tag_name: release.tag_name,
          published_at: release.published_at,
          url: release.html_url,
        };
      } catch (err) {
        if (!isNotFound(err)) throw resolutionError(data.full_name, err);
      }

      return toPublicResolvedRepository(data, latest_release);
    },
  };
}

export class GithubRepositoryResolver implements RepositoryResolver {
  constructor(
    private readonly client: GithubRepositoryClient,
    private readonly coordinator?: RetryCoordinator,
  ) {}

  async resolve(item: DiscoveryItem): Promise<ResolvedRepository[]> {
    const candidates = extractGithubCandidates(item.extraction_text);
    const resolved = new Map<string, ResolvedRepository>();

    for (const candidate of candidates) {
      try {
        const fetch = () => {
          const [owner, repo] = candidate.owner_repo.split('/');
          if (!owner || !repo) {
            throw new DeferredError(
              `invalid normalized candidate ${candidate.owner_repo}`,
              'RESOLUTION_INVALID',
            );
          }
          return this.client.getPublicRepository(owner, repo);
        };
        const repository = this.coordinator ? await this.coordinator.run(fetch) : await fetch();
        if (repository && !resolved.has(repository.node_id)) {
          resolved.set(repository.node_id, repository);
        }
      } catch (err) {
        // Do not return a partial result: a source item is only complete after
        // every candidate was resolved or explicitly rejected. The caller keeps
        // it pending and the next attempt starts from the complete candidate set.
        throw resolutionError(candidate.owner_repo, err);
      }
    }

    return [...resolved.values()].sort((a, b) => a.node_id.localeCompare(b.node_id));
  }
}

export function createOctokitRepositoryResolver(token: string): RepositoryResolver {
  return new GithubRepositoryResolver(createOctokitRepositoryClient(token));
}

/**
 * Exposed for the orchestrator and focused tests. A zero candidate count is
 * terminal `skipped_no_repo`; a nonzero count with zero repositories means all
 * candidates were private, deleted, or inaccessible and is also skipped.
 */
export async function resolveDiscoveryItem(
  item: DiscoveryItem,
  resolver: RepositoryResolver,
): Promise<RepositoryResolutionResult> {
  const candidateCount = extractGithubCandidates(item.extraction_text).length;
  if (candidateCount === 0) return { candidateCount, repositories: [] };
  return { candidateCount, repositories: await resolver.resolve(item) };
}
