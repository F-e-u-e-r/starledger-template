import { describe, expect, it } from 'vitest';
import { normalizeEdge } from '../src/normalize';
import { makeRawEdge } from './helpers';

describe('normalizeEdge', () => {
  it('dedupes and sorts topics', () => {
    const repo = normalizeEdge(
      makeRawEdge('2026-01-01T00:00:00Z', {
        repositoryTopics: {
          nodes: [
            { topic: { name: 'rust' } },
            { topic: { name: 'cli' } },
            { topic: { name: 'rust' } },
          ],
        },
      }),
    );
    expect(repo.topics).toEqual(['cli', 'rust']);
  });

  it('maps empty homepageUrl to null', () => {
    const repo = normalizeEdge(makeRawEdge('2026-01-01T00:00:00Z', { homepageUrl: '   ' }));
    expect(repo.homepage_url).toBeNull();
  });

  it('maps null primaryLanguage and licenseInfo to null', () => {
    const repo = normalizeEdge(
      makeRawEdge('2026-01-01T00:00:00Z', { primaryLanguage: null, licenseInfo: null }),
    );
    expect(repo.primary_language).toBeNull();
    expect(repo.license_spdx).toBeNull();
  });

  it('produces a fully-hydrated record in the GraphQL path', () => {
    const repo = normalizeEdge(makeRawEdge('2026-01-01T00:00:00Z'));
    expect(repo.hydration_status).toBe('ok');
    expect(repo.unavailable_fields).toEqual([]);
    expect(repo.starred_at).toBe('2026-01-01T00:00:00Z');
  });
});
