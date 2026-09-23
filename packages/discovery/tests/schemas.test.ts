import { describe, expect, it } from 'vitest';
import {
  DiscoveryCandidateSchema,
  DiscoveryCandidatesFileSchema,
  DiscoveryCandidatesMetaSchema,
  DiscoverySourceSchema,
} from '../src/schemas';

const validSource = {
  kind: 'manual' as const,
  source_id: 'owner/repo',
  source_url: 'https://github.com/owner/repo',
  observed_at: '2026-01-01T00:00:00.000Z',
};

const validCandidate = {
  node_id: 'R_abc123',
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
  status: 'candidate' as const,
};

describe('DiscoverySourceSchema', () => {
  it('accepts a valid source', () => {
    expect(DiscoverySourceSchema.parse(validSource)).toEqual(validSource);
  });

  it('rejects unknown kind', () => {
    expect(DiscoverySourceSchema.safeParse({ ...validSource, kind: 'unknown' }).success).toBe(
      false,
    );
  });

  it('accepts optional fields absent', () => {
    const minimal = {
      kind: validSource.kind,
      source_id: validSource.source_id,
      observed_at: validSource.observed_at,
    };
    expect(DiscoverySourceSchema.parse(minimal)).toEqual(minimal);
  });

  it('rejects unknown fields', () => {
    expect(DiscoverySourceSchema.safeParse({ ...validSource, extra: true }).success).toBe(false);
  });
});

describe('DiscoveryCandidateSchema', () => {
  it('accepts a valid candidate', () => {
    expect(DiscoveryCandidateSchema.parse(validCandidate)).toEqual(validCandidate);
  });

  it('accepts candidate with decision_reason', () => {
    const promoted = {
      ...validCandidate,
      status: 'promoted' as const,
      decision_reason: 'worth starring',
    };
    expect(DiscoveryCandidateSchema.parse(promoted)).toEqual(promoted);
  });

  it('rejects missing required fields', () => {
    const noId = { ...validCandidate } as Record<string, unknown>;
    delete noId.node_id;
    expect(DiscoveryCandidateSchema.safeParse(noId).success).toBe(false);
  });

  it('rejects empty sources array', () => {
    expect(DiscoveryCandidateSchema.safeParse({ ...validCandidate, sources: [] }).success).toBe(
      false,
    );
  });

  it('rejects unknown status', () => {
    expect(
      DiscoveryCandidateSchema.safeParse({ ...validCandidate, status: 'starred' }).success,
    ).toBe(false);
  });
});

describe('DiscoveryCandidatesFileSchema', () => {
  it('accepts a valid file', () => {
    const file = { schema_version: 1, candidates: [validCandidate] };
    expect(DiscoveryCandidatesFileSchema.parse(file).candidates).toHaveLength(1);
  });

  it('accepts empty candidates', () => {
    const file = { schema_version: 1, candidates: [] };
    expect(DiscoveryCandidatesFileSchema.parse(file).candidates).toHaveLength(0);
  });

  it('rejects wrong schema version', () => {
    expect(
      DiscoveryCandidatesFileSchema.safeParse({ schema_version: 2, candidates: [] }).success,
    ).toBe(false);
  });
});

describe('DiscoveryCandidatesMetaSchema', () => {
  it('accepts a valid meta', () => {
    const meta = {
      schema_version: 1,
      generated_at: '2026-01-15T00:00:00.000Z',
      dataset_sha: 'a'.repeat(64),
      candidate_count: 3,
      source_count: 2,
      generator_version: '0.1.0',
    };
    expect(DiscoveryCandidatesMetaSchema.parse(meta)).toEqual(meta);
  });

  it('rejects invalid sha', () => {
    expect(
      DiscoveryCandidatesMetaSchema.safeParse({
        schema_version: 1,
        generated_at: '2026-01-15T00:00:00.000Z',
        dataset_sha: 'short',
        candidate_count: 0,
        source_count: 0,
        generator_version: '0.1.0',
      }).success,
    ).toBe(false);
  });
});

describe('S1: discovery URLs are pinned to https', () => {
  it('rejects a javascript: html_url (it flows straight into <a href>)', () => {
    expect(
      DiscoveryCandidateSchema.safeParse({ ...validCandidate, html_url: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
  });

  it('rejects a non-https source_url', () => {
    expect(
      DiscoverySourceSchema.safeParse({ ...validSource, source_url: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
  });

  it('still accepts the https URLs', () => {
    expect(DiscoveryCandidateSchema.safeParse(validCandidate).success).toBe(true);
    expect(DiscoverySourceSchema.safeParse(validSource).success).toBe(true);
  });
});
