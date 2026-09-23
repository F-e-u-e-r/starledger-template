import { describe, expect, it } from 'vitest';
import { loadDiscovery } from './load-discovery';

const validSource = {
  kind: 'manual',
  source_id: 'owner/repo',
  source_url: 'https://github.com/owner/repo',
  observed_at: '2026-01-01T00:00:00.000Z',
};

const validCandidate = {
  node_id: 'R_1',
  owner: 'owner',
  name: 'repo',
  full_name: 'owner/repo',
  html_url: 'https://github.com/owner/repo',
  description: 'A test repo',
  homepage_url: null,
  primary_language: 'TypeScript',
  stargazer_count: 100,
  archived: false,
  disabled: false,
  fork: false,
  pushed_at: '2026-01-01T00:00:00.000Z',
  discovered_at: '2026-01-15T00:00:00.000Z',
  first_seen_source: validSource,
  sources: [validSource],
  status: 'candidate',
};

const validFile = { schema_version: 1, candidates: [validCandidate] };

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function createFetch(
  metaOverride?: Record<string, unknown> | null,
  candidatesOverride?: unknown,
): typeof fetch {
  return async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('discovery-candidates-meta.json')) {
      if (metaOverride === null) {
        return new Response('', { status: 404 }) as Response;
      }
      const candidatesText = JSON.stringify(candidatesOverride ?? validFile, null, 2) + '\n';
      const sha = await sha256Hex(candidatesText);
      const meta = {
        schema_version: 1,
        generated_at: '2026-01-15T00:00:00.000Z',
        dataset_sha: sha,
        candidate_count: 1,
        source_count: 1,
        generator_version: '0.1.0',
        ...metaOverride,
      };
      return new Response(JSON.stringify(meta), { status: 200 }) as Response;
    }
    if (url.includes('discovery-candidates.json')) {
      const text = JSON.stringify(candidatesOverride ?? validFile, null, 2) + '\n';
      return new Response(text, { status: 200 }) as Response;
    }
    return new Response('', { status: 404 }) as Response;
  };
}

describe('loadDiscovery', () => {
  it('returns null when meta is missing', async () => {
    const result = await loadDiscovery({ fetchImpl: createFetch(null) });
    expect(result).toBeNull();
  });

  it('loads valid discovery artifacts', async () => {
    const result = await loadDiscovery({ fetchImpl: createFetch() });
    expect(result).not.toBeNull();
    expect(result!.candidates).toHaveLength(1);
    expect(result!.candidateCount).toBe(1);
  });

  it('returns null on schema mismatch', async () => {
    const result = await loadDiscovery({
      fetchImpl: createFetch({ schema_version: 99 }),
    });
    expect(result).toBeNull();
  });

  it('returns null on count mismatch', async () => {
    const result = await loadDiscovery({
      fetchImpl: createFetch({ candidate_count: 5 }),
    });
    expect(result).toBeNull();
  });

  it('verifies integrity by default', async () => {
    const result = await loadDiscovery({
      fetchImpl: createFetch({ dataset_sha: 'a'.repeat(64) }),
    });
    expect(result).toBeNull();
  });
});
