import { createGithubClient, TerminalError } from '@starred/github-client';
import { extractGithubCandidates } from '../github-url';
import type { DiscoveryItem } from '../models';
import type { AwesomeStarsState } from '../state';

/**
 * awesome-stars source: detect repositories newly added to a curated list by
 * comparing commit SHAs, then diffing the *set* of repository URLs between the
 * old and new file content — a repository set diff, NOT a markdown line diff.
 * The URL set is never persisted; only the commit cursor is.
 */

export interface CommitRef {
  sha: string;
  committedAt: string | null;
}

/** Injectable GitHub content access (production uses Octokit; tests inject a fake). */
export interface AwesomeStarsClient {
  /** Latest commit touching `path` on `ref`, or null if there is none. */
  getLatestCommit(ref: string, path: string): Promise<CommitRef | null>;
  /** UTF-8 file text at `ref`, or null if the file does not exist there. */
  getFileContent(ref: string, path: string): Promise<string | null>;
}

export interface AwesomeStarsPollResult {
  items: DiscoveryItem[];
  nextState: AwesomeStarsState;
}

/** Newest commit across the watched paths; ties broken by sha for determinism. */
function newestCommit(commits: readonly (CommitRef | null)[]): CommitRef | null {
  let best: CommitRef | null = null;
  for (const c of commits) {
    if (!c) continue;
    if (!best) {
      best = c;
      continue;
    }
    const ct = c.committedAt ? Date.parse(c.committedAt) : 0;
    const bt = best.committedAt ? Date.parse(best.committedAt) : 0;
    if (ct > bt || (ct === bt && c.sha > best.sha)) best = c;
  }
  return best;
}

/**
 * Poll the awesome-stars source. Cold start (or a re-baseline) records the
 * cursor and emits nothing. An unchanged head is a no-op. On a changed head, the
 * repository URL set is diffed between the old and new content of each watched
 * path, and a DiscoveryItem is emitted for every repository in (new − old).
 */
export async function pollAwesomeStars(
  state: AwesomeStarsState,
  client: AwesomeStarsClient,
  now: Date,
): Promise<AwesomeStarsPollResult> {
  const commits = await Promise.all(state.paths.map((p) => client.getLatestCommit(state.ref, p)));
  const head = newestCommit(commits);
  if (!head) return { items: [], nextState: state };

  if (!state.initialized || state.last_commit_sha === null) {
    return { items: [], nextState: { ...state, initialized: true, last_commit_sha: head.sha } };
  }

  if (head.sha === state.last_commit_sha) return { items: [], nextState: state };

  const oldSet = new Set<string>();
  const newCandidates = new Map<string, { owner_repo: string; url: string }>();
  for (const path of state.paths) {
    const [oldContent, newContent] = await Promise.all([
      client.getFileContent(state.last_commit_sha, path),
      client.getFileContent(head.sha, path),
    ]);
    if (oldContent) {
      for (const c of extractGithubCandidates(oldContent)) oldSet.add(c.owner_repo);
    }
    if (newContent) {
      for (const c of extractGithubCandidates(newContent)) {
        if (!newCandidates.has(c.owner_repo)) newCandidates.set(c.owner_repo, c);
      }
    }
  }

  const nowIso = now.toISOString();
  const items: DiscoveryItem[] = [];
  for (const [owner_repo, c] of newCandidates) {
    if (oldSet.has(owner_repo)) continue;
    items.push({
      source: 'awesome_stars',
      source_item_id: owner_repo,
      title: owner_repo,
      url: c.url,
      description: null,
      published_at: head.committedAt,
      extraction_text: c.url,
      discovered_at: nowIso,
    });
  }

  return { items, nextState: { ...state, last_commit_sha: head.sha } };
}

function splitRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new TerminalError(
      `awesome_stars.repository must be "owner/repo", got "${repository}"`,
      'CONFIG_INVALID',
    );
  }
  return { owner, repo };
}

/** Production client backed by the shared GitHub (Octokit) client. */
export function createOctokitAwesomeStarsClient(
  repository: string,
  token: string,
): AwesomeStarsClient {
  const { octokit } = createGithubClient(token, 'starledger-notifier');
  const { owner, repo } = splitRepository(repository);
  return {
    async getLatestCommit(ref, path) {
      const res = await octokit.repos.listCommits({ owner, repo, sha: ref, path, per_page: 1 });
      const c = res.data[0];
      if (!c) return null;
      return { sha: c.sha, committedAt: c.commit.committer?.date ?? c.commit.author?.date ?? null };
    },
    async getFileContent(ref, path) {
      try {
        const res = await octokit.repos.getContent({ owner, repo, path, ref });
        const data = res.data;
        if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
          return null;
        }
        return Buffer.from(data.content, 'base64').toString('utf8');
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
  };
}
