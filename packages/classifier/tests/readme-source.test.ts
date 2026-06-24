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
