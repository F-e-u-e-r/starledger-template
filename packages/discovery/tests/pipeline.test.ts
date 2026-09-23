import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DecisionMap, ManualEntry } from '../src/config';
import { runPipeline, serializeCandidates, serializeMeta } from '../src/pipeline';
import type { CandidateResolver, ResolvedCandidate } from '../src/resolve';
import { DiscoveryCandidatesFileSchema, DiscoveryCandidatesMetaSchema } from '../src/schemas';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(process.env.RUNNER_TEMP ?? '/tmp', `discovery-pipeline-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeResolver(repos: Map<string, ResolvedCandidate | null>): CandidateResolver {
  return {
    async resolve(owner, repo) {
      const key = `${owner}/${repo}`.toLowerCase();
      const result = repos.get(key);
      return result === undefined ? null : result;
    },
  };
}

function fakeResolved(
  overrides: Partial<ResolvedCandidate> & { node_id: string; full_name: string },
): ResolvedCandidate {
  const [owner, name] = overrides.full_name.split('/');
  return {
    owner: owner!,
    name: name!,
    html_url: `https://github.com/${overrides.full_name}`,
    description: null,
    homepage_url: null,
    primary_language: null,
    stargazer_count: 0,
    archived: false,
    disabled: false,
    fork: false,
    pushed_at: null,
    ...overrides,
  };
}

const emptyDecisions: DecisionMap = { dismissed: new Map(), promoted: new Map() };
const fixedNow = new Date('2026-01-15T12:00:00.000Z');

function writeStars(path: string, nodeIds: string[]) {
  const stars = {
    schema_version: '1.0',
    repos: nodeIds.map((id, i) => ({
      node_id: id,
      name_with_owner: `owner/repo-${i}`,
      owner: 'owner',
      name: `repo-${i}`,
      url: `https://github.com/owner/repo-${i}`,
      description: null,
      homepage_url: null,
      primary_language: null,
      topics: [],
      license_spdx: null,
      stargazer_count: null,
      fork_count: null,
      open_issues_count: null,
      is_archived: null,
      is_disabled: null,
      is_fork: null,
      created_at: null,
      pushed_at: null,
      updated_at: null,
      latest_stable_release: null,
      latest_any_release: null,
      starred_at: '2026-01-01T00:00:00.000Z',
      hydration_status: 'failed',
      unavailable_fields: [
        'description',
        'homepage_url',
        'primary_language',
        'topics',
        'license_spdx',
        'stargazer_count',
        'fork_count',
        'open_issues_count',
        'is_archived',
        'is_disabled',
        'is_fork',
        'created_at',
        'pushed_at',
        'updated_at',
        'latest_stable_release',
        'latest_any_release',
      ],
    })),
  };
  writeFileSync(path, JSON.stringify(stars));
}

describe('runPipeline', () => {
  it('resolves manual entries and produces valid artifacts', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      [
        'owner/repo',
        fakeResolved({ node_id: 'R_1', full_name: 'owner/repo', description: 'A test' }),
      ],
    ]);

    const entries: ManualEntry[] = [{ url: 'https://github.com/owner/repo', note: 'test' }];

    const result = await runPipeline({
      manualEntries: entries,
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    expect(result.candidates.candidates).toHaveLength(1);
    expect(result.candidates.candidates[0]!.node_id).toBe('R_1');
    expect(result.candidates.candidates[0]!.status).toBe('candidate');
    expect(result.candidates.candidates[0]!.first_seen_source.kind).toBe('manual');
    expect(result.meta.candidate_count).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(DiscoveryCandidatesFileSchema.safeParse(result.candidates).success).toBe(true);
    expect(DiscoveryCandidatesMetaSchema.safeParse(result.meta).success).toBe(true);
  });

  it('excludes already-starred repos by node_id', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, ['R_1']);

    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);

    const result = await runPipeline({
      manualEntries: [{ url: 'https://github.com/owner/repo' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    expect(result.candidates.candidates).toHaveLength(0);
  });

  it('B2: cold start (stars.json absent) dedupes against nothing rather than failing', async () => {
    const starsPath = join(tmpDir, 'does-not-exist.json');
    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);
    const result = await runPipeline({
      manualEntries: [{ url: 'https://github.com/owner/repo' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });
    expect(result.candidates.candidates).toHaveLength(1);
  });

  it('B2: fails closed when stars.json is present but not valid JSON', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeFileSync(starsPath, '{ this is not json');
    await expect(
      runPipeline({
        manualEntries: [{ url: 'https://github.com/owner/repo' }],
        starsPath,
        decisions: emptyDecisions,
        resolver: makeResolver(new Map()),
        now: fixedNow,
      }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('B2: fails closed when stars.json is present but fails schema validation', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeFileSync(starsPath, JSON.stringify({ schema_version: '1.0', repos: 'nope' }));
    await expect(
      runPipeline({
        manualEntries: [{ url: 'https://github.com/owner/repo' }],
        starsPath,
        decisions: emptyDecisions,
        resolver: makeResolver(new Map()),
        now: fixedNow,
      }),
    ).rejects.toThrow(/schema validation/);
  });

  it('deduplicates by node_id when multiple URLs resolve to same repo', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
      ['owner/repo-old', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);

    const result = await runPipeline({
      manualEntries: [
        { url: 'https://github.com/owner/repo' },
        { url: 'https://github.com/owner/repo-old' },
      ],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    expect(result.candidates.candidates).toHaveLength(1);
    expect(result.candidates.candidates[0]!.sources).toHaveLength(2);
  });

  it('applies decision overrides', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/dismissed', fakeResolved({ node_id: 'R_d', full_name: 'owner/dismissed' })],
      ['owner/promoted', fakeResolved({ node_id: 'R_p', full_name: 'owner/promoted' })],
    ]);

    const decisions: DecisionMap = {
      dismissed: new Map([['owner/dismissed', 'not useful']]),
      promoted: new Map([['owner/promoted', 'great tool']]),
    };

    const result = await runPipeline({
      manualEntries: [
        { url: 'https://github.com/owner/dismissed' },
        { url: 'https://github.com/owner/promoted' },
      ],
      starsPath,
      decisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    const dismissed = result.candidates.candidates.find((c) => c.node_id === 'R_d');
    const promoted = result.candidates.candidates.find((c) => c.node_id === 'R_p');
    expect(dismissed!.status).toBe('dismissed');
    expect(dismissed!.decision_reason).toBe('not useful');
    expect(promoted!.status).toBe('promoted');
    expect(promoted!.decision_reason).toBe('great tool');
  });

  it('reports errors for invalid URLs', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const result = await runPipeline({
      manualEntries: [{ url: 'not-a-github-url' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(new Map()),
      now: fixedNow,
    });

    expect(result.candidates.candidates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.url).toBe('not-a-github-url');
  });

  it('skips private/inaccessible repos (resolver returns null)', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map<string, ResolvedCandidate | null>([['owner/private-repo', null]]);

    const result = await runPipeline({
      manualEntries: [{ url: 'https://github.com/owner/private-repo' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    expect(result.candidates.candidates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('sorts candidates by node_id for deterministic output', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/zebra', fakeResolved({ node_id: 'R_z', full_name: 'owner/zebra' })],
      ['owner/alpha', fakeResolved({ node_id: 'R_a', full_name: 'owner/alpha' })],
      ['owner/middle', fakeResolved({ node_id: 'R_m', full_name: 'owner/middle' })],
    ]);

    const result = await runPipeline({
      manualEntries: [
        { url: 'https://github.com/owner/zebra' },
        { url: 'https://github.com/owner/alpha' },
        { url: 'https://github.com/owner/middle' },
      ],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    expect(result.candidates.candidates.map((c) => c.node_id)).toEqual(['R_a', 'R_m', 'R_z']);
  });

  it('meta dataset_sha matches serialized candidates', async () => {
    const { createHash } = await import('node:crypto');
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);

    const result = await runPipeline({
      manualEntries: [{ url: 'https://github.com/owner/repo' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    const serialized = serializeCandidates(result.candidates);
    const sha = createHash('sha256').update(serialized, 'utf8').digest('hex');
    expect(result.meta.dataset_sha).toBe(sha);
  });

  it('handles missing stars.json gracefully', async () => {
    const starsPath = join(tmpDir, 'nonexistent-stars.json');
    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);

    const result = await runPipeline({
      manualEntries: [{ url: 'https://github.com/owner/repo' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    expect(result.candidates.candidates).toHaveLength(1);
  });

  it('reuses timestamps from previous artifact for existing candidates', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);
    const entries: ManualEntry[] = [{ url: 'https://github.com/owner/repo', note: 'test' }];

    const firstRun = await runPipeline({
      manualEntries: entries,
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: new Date('2026-01-10T00:00:00.000Z'),
    });

    const candidatesPath = join(tmpDir, 'discovery-candidates.json');
    const metaPath = join(tmpDir, 'discovery-candidates-meta.json');
    writeFileSync(candidatesPath, serializeCandidates(firstRun.candidates));
    writeFileSync(metaPath, serializeMeta(firstRun.meta));

    const secondRun = await runPipeline({
      manualEntries: entries,
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: new Date('2026-01-20T00:00:00.000Z'),
      previousCandidatesPath: candidatesPath,
    });

    expect(secondRun.candidates.candidates[0]!.discovered_at).toBe('2026-01-10T00:00:00.000Z');
    expect(secondRun.candidates.candidates[0]!.sources[0]!.observed_at).toBe(
      '2026-01-10T00:00:00.000Z',
    );
  });

  it('returns changed=false when candidate set is identical', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);
    const entries: ManualEntry[] = [{ url: 'https://github.com/owner/repo' }];

    const firstRun = await runPipeline({
      manualEntries: entries,
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    const candidatesPath = join(tmpDir, 'discovery-candidates.json');
    const metaPath = join(tmpDir, 'discovery-candidates-meta.json');
    writeFileSync(candidatesPath, serializeCandidates(firstRun.candidates));
    writeFileSync(metaPath, serializeMeta(firstRun.meta));

    const secondRun = await runPipeline({
      manualEntries: entries,
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: new Date('2026-02-01T00:00:00.000Z'),
      previousCandidatesPath: candidatesPath,
    });

    expect(secondRun.changed).toBe(false);
  });

  it('returns changed=true when a new candidate is added', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);

    const firstRun = await runPipeline({
      manualEntries: [{ url: 'https://github.com/owner/repo' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    const candidatesPath = join(tmpDir, 'discovery-candidates.json');
    const metaPath = join(tmpDir, 'discovery-candidates-meta.json');
    writeFileSync(candidatesPath, serializeCandidates(firstRun.candidates));
    writeFileSync(metaPath, serializeMeta(firstRun.meta));

    repos.set('owner/new-repo', fakeResolved({ node_id: 'R_2', full_name: 'owner/new-repo' }));

    const secondRun = await runPipeline({
      manualEntries: [
        { url: 'https://github.com/owner/repo' },
        { url: 'https://github.com/owner/new-repo' },
      ],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: new Date('2026-02-01T00:00:00.000Z'),
      previousCandidatesPath: candidatesPath,
    });

    expect(secondRun.changed).toBe(true);
    expect(secondRun.candidates.candidates).toHaveLength(2);
  });

  it('returns changed=true when no previous artifact exists', async () => {
    const starsPath = join(tmpDir, 'stars.json');
    writeStars(starsPath, []);

    const repos = new Map([
      ['owner/repo', fakeResolved({ node_id: 'R_1', full_name: 'owner/repo' })],
    ]);

    const result = await runPipeline({
      manualEntries: [{ url: 'https://github.com/owner/repo' }],
      starsPath,
      decisions: emptyDecisions,
      resolver: makeResolver(repos),
      now: fixedNow,
    });

    expect(result.changed).toBe(true);
  });
});
