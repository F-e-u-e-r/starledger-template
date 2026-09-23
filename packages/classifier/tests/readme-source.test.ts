import { RetryBudgetExhaustedError, RetryCoordinator } from '@starred/github-client';
import { describe, expect, it, vi } from 'vitest';
import { OctokitReadmeSource } from '../src/readme-source';

const REPO = { owner: 'owner', name: 'repo' };

describe('OctokitReadmeSource', () => {
  it('reuses one preferred-README response for the identity probe and selected content', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        path: 'README.md',
        sha: 'oid-1',
        content: Buffer.from('trusted README bytes', 'utf8').toString('base64'),
        encoding: 'base64',
      },
    });
    const source = new OctokitReadmeSource({ octokit: { request } } as never);

    await expect(source.getReadmeRef(REPO)).resolves.toEqual({ path: 'README.md', oid: 'oid-1' });
    await expect(source.getReadmeContent(REPO, 'README.md')).resolves.toBe('trusted README bytes');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports a README whose bytes GitHub withholds (>1 MB → encoding "none") as absent', async () => {
    // The measured response shape behind PRs #91/#92: HTTP 200 with path+sha
    // populated but no loadable bytes. Discovery must report null — the same
    // answer the provenance gate will compute — instead of a usable-looking ref.
    const request = vi.fn().mockResolvedValue({
      data: { path: 'README.md', sha: 'oid-huge', content: '', encoding: 'none', size: 1_153_334 },
    });
    const source = new OctokitReadmeSource({ octokit: { request } } as never);

    await expect(source.getReadmeRef(REPO)).resolves.toBeNull();
    await expect(source.getReadmeContent(REPO, 'README.md')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(1); // one memoized response answers both
  });

  it('treats an EMPTY base64 README as usable (an empty file is not a missing one)', async () => {
    const request = vi.fn().mockResolvedValue({
      data: { path: 'README.md', sha: 'oid-empty', content: '', encoding: 'base64' },
    });
    const source = new OctokitReadmeSource({ octokit: { request } } as never);

    await expect(source.getReadmeRef(REPO)).resolves.toEqual({
      path: 'README.md',
      oid: 'oid-empty',
    });
    await expect(source.getReadmeContent(REPO, 'README.md')).resolves.toBe('');
  });

  it('does not return cached preferred content for a path that changed after the probe', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        path: 'README.md',
        sha: 'oid-1',
        content: Buffer.from('body', 'utf8').toString('base64'),
        encoding: 'base64',
      },
    });
    const source = new OctokitReadmeSource({ octokit: { request } } as never);

    await source.getReadmeRef(REPO);
    await expect(source.getReadmeContent(REPO, 'docs/README.md')).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('OctokitReadmeSource — content-free OID probe', () => {
  function notFound(): Error {
    return Object.assign(new Error('not found'), { status: 404 });
  }
  function source(opts: {
    graphqlOid?: string | null;
    readme?: { path: string; sha: string; content: string };
    onReadme?: () => void;
  }): OctokitReadmeSource {
    const graphql = vi.fn(() =>
      Promise.resolve({
        repository: {
          object:
            opts.graphqlOid !== undefined && opts.graphqlOid !== null
              ? { oid: opts.graphqlOid }
              : null,
        },
      }),
    );
    const request = vi.fn(() => {
      opts.onReadme?.();
      if (opts.readme === undefined) return Promise.reject(notFound());
      return Promise.resolve({
        data: {
          path: opts.readme.path,
          sha: opts.readme.sha,
          content: Buffer.from(opts.readme.content, 'utf8').toString('base64'),
          encoding: 'base64',
        },
      });
    });
    return new OctokitReadmeSource({ graphql, octokit: { request } } as never);
  }

  it('resolves a known path OID via GraphQL WITHOUT calling the README REST endpoint', async () => {
    let readmeCalls = 0;
    const src = source({ graphqlOid: 'oid-abc', onReadme: () => (readmeCalls += 1) });
    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toEqual({
      path: 'README.md',
      oid: 'oid-abc',
    });
    expect(readmeCalls).toBe(0); // no content payload transferred
  });

  it('falls back to preferred-README discovery when the known path no longer exists', async () => {
    const src = source({
      graphqlOid: null,
      readme: { path: 'docs/README.md', sha: 'oid-new', content: '# moved' },
    });
    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toEqual({
      path: 'docs/README.md',
      oid: 'oid-new',
    });
  });

  it('discovers the preferred README when no known path is supplied', async () => {
    const src = source({ readme: { path: 'README.md', sha: 'oid-1', content: '# hi' } });
    await expect(src.getReadmeRef(REPO)).resolves.toEqual({ path: 'README.md', oid: 'oid-1' });
  });
});

describe('OctokitReadmeSource — vanished repo & transient graphql faults', () => {
  // @octokit/graphql answers an unresolvable repository with HTTP 200 + a
  // top-level `errors` array (a GraphqlResponseError), NOT an HTTP-status error.
  function graphqlRepoNotFound(): Error {
    return Object.assign(new Error('Request failed due to following response errors:'), {
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['repository'],
          message: "Could not resolve to a Repository with the name 'owner/repo'.",
        },
      ],
    });
  }
  const httpStatus = (status: number, message: string): Error =>
    Object.assign(new Error(message), { status });
  // A no-sleep coordinator so retry paths stay instant + deterministic.
  const instantCoordinator = (): RetryCoordinator =>
    new RetryCoordinator({ sleep: async () => {}, now: () => 0, random: () => 0 });

  it('treats a repository that no longer resolves as an absent README, without retrying', async () => {
    const graphql = vi.fn(() => Promise.reject(graphqlRepoNotFound()));
    const request = vi.fn(() => Promise.reject(httpStatus(404, 'Not Found'))); // deleted repo → REST 404s too
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toBeNull();
    expect(graphql).toHaveBeenCalledTimes(1); // NOT_FOUND is settled → must NOT retry
    expect(request).toHaveBeenCalledTimes(1); // fell through to REST discovery, which also 404s
  });

  it('retries a transient graphql fault with bounded backoff, then succeeds', async () => {
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(httpStatus(502, 'Bad Gateway'))
      .mockResolvedValueOnce({ repository: { object: { oid: 'oid-after-retry' } } });
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toEqual({
      path: 'README.md',
      oid: 'oid-after-retry',
    });
    expect(graphql).toHaveBeenCalledTimes(2); // one transient failure, then a retry that succeeds
    expect(request).not.toHaveBeenCalled(); // fast path resolved; no README payload transferred
  });

  it('retries an HTTP 500 (server hiccup is transient, not terminal), then succeeds', async () => {
    // Guards classifyError treating 500 as retryable alongside 502/503/504 — a
    // malformed request is 400/422, so a 500 here is a server fault worth retrying.
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(httpStatus(500, 'Internal Server Error'))
      .mockResolvedValueOnce({ repository: { object: { oid: 'oid-500' } } });
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toEqual({
      path: 'README.md',
      oid: 'oid-500',
    });
    expect(graphql).toHaveBeenCalledTimes(2); // 500 retried, not thrown as terminal
  });

  it('propagates a terminal graphql error (auth) instead of masking it as a missing README', async () => {
    const graphql = vi.fn(() => Promise.reject(httpStatus(401, 'Bad credentials')));
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled(); // a real fault must fail loudly, never fall through to null
  });

  it('retries an empty 2xx envelope (undefined) instead of downgrading to REST', async () => {
    // Raw @octokit/graphql yields `undefined` for a data-less 2xx body — a transient
    // glitch, not "no README". Per github-client's requireResponse contract the probe
    // retries the OID query rather than silently falling through to a REST content fetch.
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ repository: { object: { oid: 'oid-recovered' } } });
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toEqual({
      path: 'README.md',
      oid: 'oid-recovered',
    });
    expect(graphql).toHaveBeenCalledTimes(2); // retried the envelope, did NOT fall through
    expect(request).not.toHaveBeenCalled();
  });

  it('retries a malformed envelope ({} with no repository field), then succeeds', async () => {
    // `{}` / `[]` are records/objects but lack the `repository` field — malformed,
    // not "no README". They must retry, not fall straight through to REST.
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ repository: { object: { oid: 'oid-recovered' } } });
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toEqual({
      path: 'README.md',
      oid: 'oid-recovered',
    });
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });

  it('retries a GraphQL execution timeout (HTTP 200 errors, no status), then succeeds', async () => {
    // The one transient class with NO `.status`: classifyError matches it only by the
    // message @octokit/graphql embeds. Locks that dependency against a silent regress.
    const execTimeout = Object.assign(
      new Error(
        'Request failed due to following response errors:\n - Something went wrong while executing your query.',
      ),
      {
        errors: [{ message: 'Something went wrong while executing your query. Please try again.' }],
      },
    );
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(execTimeout)
      .mockResolvedValueOnce({ repository: { object: { oid: 'oid-recovered' } } });
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toEqual({
      path: 'README.md',
      oid: 'oid-recovered',
    });
    expect(graphql).toHaveBeenCalledTimes(2);
  });

  it('propagates a DeferredError when the GraphQL probe exhausts its retry budget', async () => {
    // A persistent transient fault (5xx / exec-timeout / empty envelope) that never
    // recovers surfaces RetryBudgetExhaustedError — a DeferredError the CLI turns into
    // exit 20 (defer the run, keep last-known-good). It is NOT degraded to metadata nor
    // silently downgraded to a REST content fetch; REST is never even attempted.
    const graphql = vi.fn(() => Promise.reject(httpStatus(503, 'Service Unavailable')));
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).rejects.toBeInstanceOf(
      RetryBudgetExhaustedError,
    );
    expect(graphql).toHaveBeenCalledTimes(4); // DEFAULT_RETRY.maxAttempts
    expect(request).not.toHaveBeenCalled();
  });

  it('does NOT swallow a NOT_FOUND on a field other than `repository`', async () => {
    // Future-proofing: were the query to gain a second resolvable node, a NOT_FOUND
    // there must not be misread as "repository gone" and silently absorbed.
    const otherNotFound = Object.assign(new Error('Request failed'), {
      errors: [{ type: 'NOT_FOUND', path: ['viewer'], message: 'nope' }],
    });
    const graphql = vi.fn(() => Promise.reject(otherNotFound));
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('does NOT swallow a NOT_FOUND on a nested repository path', async () => {
    // Only path exactly ['repository'] means the repo is gone. A deeper path such as
    // ['repository','object'] must propagate, not be absorbed as "repo gone".
    const nested = Object.assign(new Error('Request failed'), {
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'object'], message: 'nope' }],
    });
    const graphql = vi.fn(() => Promise.reject(nested));
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('does NOT swallow a mixed error array (NOT_FOUND alongside another error)', async () => {
    // .every() guard: a repository NOT_FOUND reported together with any OTHER error
    // must not be absorbed as "repo gone" — it propagates so the real fault surfaces.
    const mixed = Object.assign(new Error('Request failed'), {
      errors: [
        { type: 'NOT_FOUND', path: ['repository'], message: 'gone' },
        { type: 'SERVICE_UNAVAILABLE', message: 'blip' },
      ],
    });
    const graphql = vi.fn(() => Promise.reject(mixed));
    const request = vi.fn();
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('still treats a NOT_FOUND with no path as the repository being gone', async () => {
    // Defensive branch: GitHub always sends path ['repository'], but a path-less
    // NOT_FOUND must never slip back into a crash — it is still the deleted repo.
    const pathless = Object.assign(new Error('Request failed'), {
      errors: [{ type: 'NOT_FOUND', message: 'gone' }],
    });
    const graphql = vi.fn(() => Promise.reject(pathless));
    const request = vi.fn(() => Promise.reject(httpStatus(404, 'Not Found')));
    const src = new OctokitReadmeSource(
      { graphql, octokit: { request } } as never,
      instantCoordinator(),
    );

    await expect(src.getReadmeRef(REPO, 'README.md')).resolves.toBeNull();
    expect(graphql).toHaveBeenCalledTimes(1); // settled → no retry
  });
});
