import { serializeClassificationManifest, type Annotation } from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { loadCanonicalDataset } from '../src/dataset';
import { planClassification, type PlanResult } from '../src/planner';
import { EMPTY_CLASSIFIER_STATE, type ClassifierState } from '../src/state';
import {
  aiConfig,
  expectedFingerprint,
  FakeReadmeSource,
  makeAnnotationFor,
  makeDataset,
  readmeEntries,
  repo,
  type FakeReadmeEntry,
  type PlannerConfig,
} from './helpers';

const NOW = new Date('2026-06-19T00:00:00Z');

function load(repos: CanonicalRepo[]) {
  const { starsText, metaText } = makeDataset(repos);
  return loadCanonicalDataset(starsText, metaText);
}

async function plan(opts: {
  repos: CanonicalRepo[];
  source: FakeReadmeSource;
  config?: PlannerConfig;
  annotations?: Annotation[];
  state?: ClassifierState;
}): Promise<PlanResult> {
  const dataset = load(opts.repos);
  return planClassification({
    repos: dataset.repos,
    datasetSha256: dataset.datasetSha256,
    state: opts.state ?? EMPTY_CLASSIFIER_STATE,
    existingAnnotations: opts.annotations ?? [],
    config: opts.config ?? aiConfig(),
    source: opts.source,
    now: NOW,
  });
}

describe('planner — README discovery', () => {
  it('README-1: a new repo with a README produces a README-source job', async () => {
    const r = repo('a');
    const source = new FakeReadmeSource(
      readmeEntries({
        'owner-a/repo-a': {
          ref: { path: 'README.md', oid: 'oid-1' },
          content: '# Title\n\nSome bounded factual content.',
        },
      }),
    );
    const { manifest } = await plan({ repos: [r], source });
    expect(manifest.jobs).toHaveLength(1);
    const job = manifest.jobs[0]!;
    expect(job.node_id).toBe('R_a');
    expect(job.input.readme?.path).toBe('README.md');
    expect(job.input.readme?.oid).toBe('oid-1');
    expect(job.input.readme?.content).toContain('Some bounded factual content.');
  });

  it('README-2: an unchanged OID skips reclassification and never downloads content', async () => {
    const r = repo('a');
    const config = aiConfig();
    const ref = { path: 'README.md', oid: 'oid-1' };
    const fingerprint = expectedFingerprint(r, config, ref);
    const source = new FakeReadmeSource(
      readmeEntries({ 'owner-a/repo-a': { ref, content: 'should not be fetched' } }),
    );
    const { manifest, decisions } = await plan({
      repos: [r],
      source,
      config,
      annotations: [makeAnnotationFor(r, fingerprint, ref)],
    });
    expect(manifest.jobs).toHaveLength(0);
    expect(decisions.find((d) => d.node_id === 'R_a')?.bucket).toBe('skip-current');
    expect(source.contentCalls).toHaveLength(0); // content download avoided
    expect(source.refCalls).toContain('owner-a/repo-a'); // cheap probe still ran
  });

  it('README-3: a moved README triggers rediscovery and a refresh job at the new path', async () => {
    const r = repo('a');
    const config = aiConfig();
    const oldRef = { path: 'README.md', oid: 'oid-old' };
    const newRef = { path: 'docs/README.md', oid: 'oid-new' };
    const source = new FakeReadmeSource(
      readmeEntries({ 'owner-a/repo-a': { ref: newRef, content: 'new readme body' } }),
    );
    const { manifest, decisions } = await plan({
      repos: [r],
      source,
      config,
      annotations: [makeAnnotationFor(r, expectedFingerprint(r, config, oldRef), oldRef)],
    });
    expect(decisions.find((d) => d.node_id === 'R_a')?.bucket).toBe('refresh');
    expect(manifest.jobs[0]?.input.readme?.path).toBe('docs/README.md');
    expect(source.contentCalls).toEqual([{ repo: 'owner-a/repo-a', path: 'docs/README.md' }]);
  });

  it('README-4: a repo with no README produces a valid metadata-only job', async () => {
    const r = repo('a');
    const source = new FakeReadmeSource(readmeEntries({ 'owner-a/repo-a': { ref: null } }));
    const { manifest } = await plan({ repos: [r], source });
    expect(manifest.jobs).toHaveLength(1);
    expect(manifest.jobs[0]?.input.readme).toBeNull();
    expect(source.contentCalls).toHaveLength(0); // metadata-only never fetches content
  });

  it('README-5: metadata-only job input respects metadata_max_chars across all fields', async () => {
    const r = repo('a', {
      description: 'description '.repeat(80),
      primary_language: 'TypeScript'.repeat(20),
      topics: ['automation'.repeat(20), 'developer-tools'.repeat(20)],
    });
    const source = new FakeReadmeSource(readmeEntries({ 'owner-a/repo-a': { ref: null } }));
    const { manifest } = await plan({
      repos: [r],
      source,
      config: aiConfig({ metadata_max_chars: 500 }),
    });
    const job = manifest.jobs[0]!;
    const metadataChars =
      job.input.name_with_owner.length +
      (job.input.description?.length ?? 0) +
      (job.input.primary_language?.length ?? 0) +
      job.input.topics.reduce((total, topic) => total + topic.length, 0);
    expect(metadataChars).toBeLessThanOrEqual(500);
  });

  it('README-6: planning consults only the README seam — embedded links are never fetched', async () => {
    const r = repo('a');
    const source = new FakeReadmeSource(
      readmeEntries({
        'owner-a/repo-a': {
          ref: { path: 'README.md', oid: 'oid-1' },
          content: 'See http://evil.test and ![x](http://evil.test/x.png) for more.',
        },
      }),
    );
    const { manifest } = await plan({ repos: [r], source });
    expect(source.refCalls).toEqual(['owner-a/repo-a']);
    expect(source.contentCalls).toEqual([{ repo: 'owner-a/repo-a', path: 'README.md' }]);
    expect(manifest.jobs[0]?.input.readme?.content).not.toContain('![x]');
  });
});

describe('planner — prioritization, budget, and trust', () => {
  function sourceFor(repos: CanonicalRepo[], withReadme = true): FakeReadmeSource {
    const entries: Record<string, FakeReadmeEntry> = {};
    for (const r of repos) {
      entries[`${r.owner}/${r.name}`] = withReadme
        ? { ref: { path: 'README.md', oid: r.node_id }, content: `body for ${r.node_id}` }
        : { ref: null };
    }
    return new FakeReadmeSource(readmeEntries(entries));
  }

  it('PLAN-1: planning is deterministic and respects bucket priority under a tight budget', async () => {
    const a = repo('a'); // new
    const b = repo('b'); // annotated at a stale fingerprint → refresh
    const config = aiConfig({ budget: { max_total_per_run: 1 } });
    const annotations = [
      makeAnnotationFor(b, 'f'.repeat(64), { path: 'README.md', oid: 'b-stale' }),
    ];
    const first = await plan({ repos: [a, b], source: sourceFor([a, b]), config, annotations });
    const second = await plan({ repos: [a, b], source: sourceFor([a, b]), config, annotations });
    expect(first.manifest.jobs.map((j) => j.node_id)).toEqual(['R_a']); // NEW beats REFRESH
    expect(serializeClassificationManifest(first.manifest)).toBe(
      serializeClassificationManifest(second.manifest),
    );
  });

  it('PLAN-2: a repo whose fingerprint is unchanged is skipped while a new repo is planned', async () => {
    const a = repo('a'); // new
    const b = repo('b'); // current
    const config = aiConfig();
    const bRef = { path: 'README.md', oid: 'R_b' };
    const annotations = [makeAnnotationFor(b, expectedFingerprint(b, config, bRef), bRef)];
    const { manifest, decisions } = await plan({
      repos: [a, b],
      source: sourceFor([a, b]),
      config,
      annotations,
    });
    expect(manifest.jobs.map((j) => j.node_id)).toEqual(['R_a']);
    expect(decisions.find((d) => d.node_id === 'R_b')?.bucket).toBe('skip-current');
  });

  it('PLAN-3: per-bucket and total ceilings are never exceeded', async () => {
    const news = Array.from({ length: 20 }, (_, i) => repo(`n${i}`));
    const refs = Array.from({ length: 10 }, (_, i) => repo(`r${i}`));
    const config = aiConfig({
      budget: {
        max_new_per_run: 20,
        max_refresh_per_run: 5,
        max_retry_per_run: 5,
        max_total_per_run: 22,
      },
    });
    const annotations = refs.map((r) =>
      makeAnnotationFor(r, 'f'.repeat(64), { path: 'README.md', oid: 'stale' }),
    );
    const { manifest, decisions } = await plan({
      repos: [...news, ...refs],
      source: sourceFor([...news, ...refs]),
      config,
      annotations,
    });
    expect(manifest.jobs.length).toBe(22); // global cap binds
    const selected = decisions.filter((d) => d.selected);
    expect(selected.filter((d) => d.bucket === 'new').length).toBe(20); // priority filled first
    expect(selected.filter((d) => d.bucket === 'refresh').length).toBe(2); // remainder under cap
  });

  it('PLAN-3: README content is fetched only for jobs selected within the run budget', async () => {
    const a = repo('a');
    const b = repo('b');
    const c = repo('c');
    const source = sourceFor([a, b, c]);
    const { manifest } = await plan({
      repos: [c, b, a],
      source,
      config: aiConfig({ budget: { max_new_per_run: 1, max_total_per_run: 1 } }),
    });
    expect(manifest.jobs.map((job) => job.node_id)).toEqual(['R_a']);
    expect(source.contentCalls).toEqual([{ repo: 'owner-a/repo-a', path: 'README.md' }]);
  });

  it('PLAN-4: a retry is skipped until its backoff elapses, then planned', async () => {
    const r = repo('a');
    const config = aiConfig();
    const entry = {
      node_id: 'R_a',
      readme_path: 'README.md',
      readme_oid: 'R_a',
      last_fingerprint: null,
      attempts: 1,
      last_error_code: 'rate_limited' as const,
      terminal_unavailable: false,
    };
    const future: ClassifierState = {
      schema_version: '1.0',
      repos: [{ ...entry, next_retry_at: '2026-06-20T00:00:00Z' }],
    };
    const past: ClassifierState = {
      schema_version: '1.0',
      repos: [{ ...entry, next_retry_at: '2026-06-18T00:00:00Z' }],
    };
    const pending = await plan({ repos: [r], source: sourceFor([r]), config, state: future });
    expect(pending.decisions[0]?.bucket).toBe('skip-retry-pending');
    expect(pending.manifest.jobs).toHaveLength(0);
    const due = await plan({ repos: [r], source: sourceFor([r]), config, state: past });
    expect(due.decisions[0]?.bucket).toBe('retry');
    expect(due.manifest.jobs).toHaveLength(1);
  });

  it('PLAN-5: every planned job comes from the canonical dataset — an agent cannot inject one', async () => {
    const a = repo('a');
    const b = repo('b');
    const ghost = makeAnnotationFor(repo('ghost'), 'f'.repeat(64), null);
    const { manifest } = await plan({
      repos: [a, b],
      source: sourceFor([a, b]),
      annotations: [ghost],
    });
    const datasetIds = new Set(['R_a', 'R_b']);
    for (const job of manifest.jobs) expect(datasetIds.has(job.node_id)).toBe(true);
    expect(manifest.jobs.some((j) => j.node_id === 'R_ghost')).toBe(false);
  });

  it('PLAN-6: a star removed from the dataset is neither planned nor retained in state', async () => {
    const a = repo('a');
    const removed = repo('removed');
    const priorState: ClassifierState = {
      schema_version: '1.0',
      repos: [
        {
          node_id: 'R_removed',
          readme_path: 'README.md',
          readme_oid: 'x',
          last_fingerprint: null,
          attempts: 2,
          last_error_code: 'server_error',
          next_retry_at: null,
          terminal_unavailable: false,
        },
      ],
    };
    const annotations = [makeAnnotationFor(removed, 'f'.repeat(64), null)];
    const { manifest, nextState } = await plan({
      repos: [a],
      source: sourceFor([a]),
      state: priorState,
      annotations,
    });
    expect(manifest.jobs.some((j) => j.node_id === 'R_removed')).toBe(false);
    expect(nextState.repos.some((e) => e.node_id === 'R_removed')).toBe(false);
  });

  it('FP-5: the dataset SHA is represented at the manifest level, not in the per-repo fingerprint', async () => {
    const a = repo('a');
    const x = repo('x'); // an unrelated extra star
    const config = aiConfig();
    const small = await plan({ repos: [a], source: sourceFor([a]), config });
    const large = await plan({ repos: [a, x], source: sourceFor([a, x]), config });
    const aSmall = small.manifest.jobs.find((j) => j.node_id === 'R_a')!;
    const aLarge = large.manifest.jobs.find((j) => j.node_id === 'R_a')!;
    // Same repo, different dataset: identical source fingerprint and job id …
    expect(aLarge.source_fingerprint).toBe(aSmall.source_fingerprint);
    expect(aLarge.job_id).toBe(aSmall.job_id);
    // … but the manifest records a different dataset SHA.
    expect(large.manifest.dataset_sha256).not.toBe(small.manifest.dataset_sha256);
  });
});
