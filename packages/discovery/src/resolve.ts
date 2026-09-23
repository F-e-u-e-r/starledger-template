import { createGithubClient } from '@starred/github-client';

export interface ResolvedCandidate {
  node_id: string;
  owner: string;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage_url: string | null;
  primary_language: string | null;
  stargazer_count: number;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  pushed_at: string | null;
}

interface RestRepository {
  node_id: string;
  full_name: string;
  owner: { login: string };
  name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  private: boolean;
  pushed_at: string | null;
}

export interface CandidateResolver {
  resolve(owner: string, repo: string): Promise<ResolvedCandidate | null>;
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number }).status === 404;
}

export function createOctokitCandidateResolver(token: string): CandidateResolver {
  const { octokit } = createGithubClient(token, 'starledger-discovery');

  return {
    async resolve(owner, repo) {
      let data: RestRepository;
      try {
        const result = await octokit.repos.get({ owner, repo });
        data = result.data as unknown as RestRepository;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }

      if (data.private) return null;

      return {
        node_id: data.node_id,
        owner: data.owner.login,
        name: data.name,
        full_name: data.full_name,
        html_url: data.html_url,
        description: data.description,
        homepage_url: data.homepage || null,
        primary_language: data.language,
        stargazer_count: data.stargazers_count,
        archived: data.archived,
        disabled: data.disabled,
        fork: data.fork,
        pushed_at: data.pushed_at,
      };
    },
  };
}
