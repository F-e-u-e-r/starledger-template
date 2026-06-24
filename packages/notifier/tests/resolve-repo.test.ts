import { AuthError } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import {
  GithubRepositoryResolver,
  resolveDiscoveryItem,
  toPublicResolvedRepository,
  type GithubRepositoryClient,
} from '../src/resolve-repo';
import { makeDiscoveryItem, makeResolvedRepository } from './helpers';

class FakeGithubRepositoryClient implements GithubRepositoryClient {
  readonly calls: string[] = [];

  constructor(
    private readonly replies: Record<string, ReturnType<typeof makeResolvedRepository> | null>,
    private readonly failing: ReadonlySet<string> = new Set(),
  ) {}

  async getPublicRepository(owner: string, repo: string) {
    const key = `${owner}/${repo}`;
    this.calls.push(key);
    if (this.failing.has(key)) throw new Error(`transient GitHub failure for ${key}`);
    return this.replies[key] ?? null;
  }
}

describe('GithubRepositoryResolver', () => {
  it('rejects an explicitly private REST repository before it can be delivered', () => {
    const privateRepository = {
      node_id: 'R_private',
      full_name: 'private-org/secret',
      owner: { login: 'private-org' },
      name: 'secret',
      html_url: 'https://github.com/private-org/secret',
      description: null,
      language: null,
      topics: [],
      stargazers_count: 0,
      license: null,
      archived: false,
      fork: false,
      private: true,
    };

    expect(toPublicResolvedRepository(privateRepository, null)).toBeNull();
  });

  it('normalizes candidates and deduplicates resolved repositories by node id', async () => {
    const client = new FakeGithubRepositoryClient({
      'old-org/widget': makeResolvedRepository({
        node_id: 'R_same',
        name_with_owner: 'new-org/widget',
        owner: 'new-org',
        name: 'widget',
        url: 'https://github.com/new-org/widget',
      }),
      'new-org/widget': makeResolvedRepository({
        node_id: 'R_same',
        name_with_owner: 'new-org/widget',
        owner: 'new-org',
        name: 'widget',
        url: 'https://github.com/new-org/widget',
      }),
    });
    const resolver = new GithubRepositoryResolver(client);

    const repositories = await resolver.resolve(
      makeDiscoveryItem({
        extraction_text:
          'https://github.com/old-org/widget/tree/main and git@github.com:new-org/widget.git',
      }),
    );

    expect(client.calls).toEqual(['old-org/widget', 'new-org/widget']);
    expect(repositories).toEqual([
      expect.objectContaining({
        node_id: 'R_same',
        name_with_owner: 'new-org/widget',
        url: 'https://github.com/new-org/widget',
      }),
    ]);
  });

  it('rejects private or inaccessible repositories without failing the item', async () => {
    const resolver = new GithubRepositoryResolver(
      new FakeGithubRepositoryClient({ 'private-org/secret': null }),
    );

    const result = await resolveDiscoveryItem(
      makeDiscoveryItem({ extraction_text: 'https://github.com/private-org/secret' }),
      resolver,
    );

    expect(result.candidateCount).toBe(1);
    expect(result.repositories).toEqual([]);
  });

  it('returns zero candidates without calling GitHub for non-repository source text', async () => {
    const client = new FakeGithubRepositoryClient({});
    const result = await resolveDiscoveryItem(
      makeDiscoveryItem({ extraction_text: 'See https://github.com/topics/typescript' }),
      new GithubRepositoryResolver(client),
    );

    expect(result).toEqual({ candidateCount: 0, repositories: [] });
    expect(client.calls).toEqual([]);
  });

  it('fails the complete item on a partial GitHub error so it stays pending', async () => {
    const client = new FakeGithubRepositoryClient(
      { 'acme/first': makeResolvedRepository({ node_id: 'R_first' }) },
      new Set(['acme/second']),
    );
    const resolver = new GithubRepositoryResolver(client);

    await expect(
      resolver.resolve(
        makeDiscoveryItem({
          extraction_text: 'https://github.com/acme/first https://github.com/acme/second',
        }),
      ),
    ).rejects.toThrow('acme/second');
  });

  it('escalates a GitHub 401 to a fatal AuthError (a bad PAT is run-level, not per-item)', async () => {
    const unauthorized: GithubRepositoryClient = {
      async getPublicRepository() {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      },
    };
    const resolver = new GithubRepositoryResolver(unauthorized);

    await expect(
      resolver.resolve(makeDiscoveryItem({ extraction_text: 'https://github.com/acme/widget' })),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
