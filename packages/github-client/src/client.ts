import { graphql as octokitGraphql } from '@octokit/graphql';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import type { GraphqlClient } from './graphql';
import { OctokitStarredClient, type StarredRestClient } from './rest';

const ResilientOctokit = Octokit.plugin(retry, throttling);

export interface GithubClient {
  graphql: GraphqlClient;
  // Typed as the base Octokit so the plugged-constructor type (which references
  // pnpm-internal paths) never needs to be named in an exported declaration.
  octokit: Octokit;
  rest: StarredRestClient;
}

/**
 * Builds the production GitHub client (REST + GraphQL) with retry and
 * throttling. Tests do not use this — they inject a fake GraphqlClient.
 */
export function createGithubClient(token: string, userAgent = 'starledger-exporter'): GithubClient {
  const octokit = new ResilientOctokit({
    auth: token,
    userAgent,
    throttle: {
      onRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 2,
      onSecondaryRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 1,
    },
  });

  const graphql = octokitGraphql.defaults({
    headers: { authorization: `token ${token}`, 'user-agent': userAgent },
  }) as unknown as GraphqlClient;

  return { graphql, octokit, rest: new OctokitStarredClient(octokit) };
}
