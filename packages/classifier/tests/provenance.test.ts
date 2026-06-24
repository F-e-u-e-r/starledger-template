import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
} from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { assembleAiArtifacts } from '../src/assemble';
import { loadCanonicalDataset } from '../src/dataset';
import { verifyAiProvenanceFromGit, verifyAnnotationProvenance } from '../src/provenance';
import {
  aiConfig,
  expectedFingerprint,
  FakeReadmeSource,
  makeAnnotationFor,
  makeDataset,
  readmeEntries,
  repo,
} from './helpers';

const CONFIG = aiConfig();
const REF = { path: 'README.md', oid: 'oid-1' };

function load(repos: CanonicalRepo[]) {
  const { starsText, metaText } = makeDataset(repos);
  return loadCanonicalDataset(starsText, metaText);
}

function sourceFor(repos: CanonicalRepo[], ref = REF): FakeReadmeSource {
  return new FakeReadmeSource(
    readmeEntries(Object.fromEntries(repos.map((r) => [`${r.owner}/${r.name}`, { ref }]))),
  );
}

describe('annotation provenance gate', () => {
  it('PROV-1: an annotation matching the current trusted job passes', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [ann],
      headMetaDatasetSha256: dataset.datasetSha256,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toEqual(['R_a']);
  });

  it('PROV-2: an annotation for a repo absent from canonical stars is rejected', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ghost = makeAnnotationFor(repo('ghost'), 'f'.repeat(64), null);
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [ghost],
      headMetaDatasetSha256: dataset.datasetSha256,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.node_id === 'R_ghost')).toBe(true);
  });

  it('PROV-3: a stale README OID is rejected', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const staleRef = { path: 'README.md', oid: 'oid-old' };
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, staleRef), staleRef);
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [ann],
      headMetaDatasetSha256: dataset.datasetSha256,
      source: sourceFor([a], { path: 'README.md', oid: 'oid-new' }),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes('README OID'))).toBe(true);
  });

  it('PROV-4: a stale canonical metadata fingerprint is rejected', async () => {
    const current = repo('a', { description: 'new description' });
    const stale = repo('a', { description: 'old description' });
    const dataset = load([current]);
    const ann = makeAnnotationFor(stale, expectedFingerprint(stale, CONFIG, REF), REF);
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [ann],
      headMetaDatasetSha256: dataset.datasetSha256,
      source: sourceFor([current]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes('metadata'))).toBe(true);
  });

  it('PROV-5: a wrong dataset SHA in head meta is rejected', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [ann],
      headMetaDatasetSha256: 'f'.repeat(64),
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes('dataset_sha256'))).toBe(true);
  });

  it('PROV-6: pruning a removed repo is allowed; pruning a present repo is rejected', async () => {
    const a = repo('a');
    const b = repo('b');
    const annA = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const annB = makeAnnotationFor(b, expectedFingerprint(b, CONFIG, REF), REF);

    const onlyA = load([a]); // b removed from the dataset
    const ok = await verifyAnnotationProvenance({
      repos: onlyA.repos,
      datasetSha256: onlyA.datasetSha256,
      baseAnnotations: [annA, annB],
      headAnnotations: [annA],
      headMetaDatasetSha256: onlyA.datasetSha256,
      source: sourceFor([a, b]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(ok.ok).toBe(true);
    expect(ok.pruned).toEqual(['R_b']);

    const both = load([a, b]); // b still present — pruning it is illegitimate
    const bad = await verifyAnnotationProvenance({
      repos: both.repos,
      datasetSha256: both.datasetSha256,
      baseAnnotations: [annA, annB],
      headAnnotations: [annA],
      headMetaDatasetSha256: both.datasetSha256,
      source: sourceFor([a, b]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.node_id === 'R_b')).toBe(true);
  });

  it('PROV-7: an executor/profile mismatch is rejected', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const tampered = {
      ...ann,
      generation: { ...ann.generation, executor_kind: 'codex-automation' as const },
    };
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [tampered],
      headMetaDatasetSha256: dataset.datasetSha256,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes('executor'))).toBe(true);
  });

  it('PROV-8: a changed-annotation delta over the per-run budget is rejected', async () => {
    const repos = Array.from({ length: 5 }, (_, i) => repo(`n${i}`));
    const dataset = load(repos);
    const anns = repos.map((r) => makeAnnotationFor(r, expectedFingerprint(r, CONFIG, REF), REF));
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: anns,
      headMetaDatasetSha256: dataset.datasetSha256,
      source: sourceFor(repos),
      config: CONFIG,
      maxChangedPerRun: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes('budget'))).toBe(true);
  });

  it('PUB-3: an unchanged artifact set has no changes to verify and triggers no discovery', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const source = sourceFor([a]);
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [ann],
      headAnnotations: [ann],
      headMetaDatasetSha256: dataset.datasetSha256,
      source,
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toEqual([]);
    expect(source.refCalls).toEqual([]);
  });

  it('PROV-9: a timestamp-only annotation update is rejected', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const original = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const timestampOnly = {
      ...original,
      generation: { ...original.generation, generated_at: '2026-06-21T00:00:00Z' },
    };
    const result = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [original],
      headAnnotations: [timestampOnly],
      headMetaDatasetSha256: dataset.datasetSha256,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes('generated_at'))).toBe(true);
  });

  it('PUB-4: a refresh with no candidate retains the previous valid annotation', () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const result = assembleAiArtifacts({
      currentAnnotations: [ann],
      validatedCandidates: [],
      datasetSha256: 'd'.repeat(64),
      generatedAt: '2026-06-21T00:00:00Z',
    });
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.node_id).toBe('R_a');
    expect(result.changed).toBe(false); // unchanged bytes → no churn
  });
});

function git(repoDir: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
}

function metaBytesFor(annotationsBytes: string, datasetSha256: string): string {
  return serializeAiAnnotationsMeta(
    buildAiAnnotationsMeta({
      annotationsBytes,
      annotationCount: 1,
      datasetSha256,
      generatedAt: '2026-06-20T00:00:00Z',
    }),
  );
}

function initRepo(dataset: { starsText: string; metaText: string }): {
  repoDir: string;
  base: string;
} {
  const repoDir = mkdtempSync(join(tmpdir(), 'starledger-provenance-'));
  git(repoDir, ['init']);
  git(repoDir, ['config', 'user.name', 'StarLedger Test']);
  git(repoDir, ['config', 'user.email', 'starledger-test@example.com']);
  writeFileSync(join(repoDir, 'stars.json'), dataset.starsText);
  writeFileSync(join(repoDir, 'dataset-meta.json'), dataset.metaText);
  git(repoDir, ['add', 'stars.json', 'dataset-meta.json']);
  git(repoDir, ['commit', '-m', 'base']);
  return { repoDir, base: git(repoDir, ['rev-parse', 'HEAD']) };
}

function commitHead(
  repoDir: string,
  base: string,
  annotationsBytes: string,
  metaBytes: string,
): string {
  git(repoDir, ['checkout', '-q', '-b', 'pr-head', base]);
  writeFileSync(join(repoDir, 'ai-annotations.json'), annotationsBytes);
  writeFileSync(join(repoDir, 'ai-annotations-meta.json'), metaBytes);
  git(repoDir, ['add', 'ai-annotations.json', 'ai-annotations-meta.json']);
  git(repoDir, ['commit', '-m', 'head']);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

describe('provenance gate over real Git', () => {
  it('GIT-1: a current-candidate provenance PR passes end-to-end', async () => {
    const a = repo('a');
    const dataset = makeDataset([a]);
    const annotationsBytes = serializeAnnotations([
      makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF),
    ]);
    const { repoDir, base } = initRepo(dataset);
    const head = commitHead(
      repoDir,
      base,
      annotationsBytes,
      metaBytesFor(annotationsBytes, dataset.datasetSha256),
    );
    const result = await verifyAiProvenanceFromGit({
      baseRef: base,
      headGitRef: head,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
      cwd: repoDir,
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toEqual(['R_a']);
  });

  it('GIT-2: a stale-candidate provenance PR is rejected', async () => {
    const a = repo('a');
    const dataset = makeDataset([a]);
    const staleRef = { path: 'README.md', oid: 'oid-old' };
    const annotationsBytes = serializeAnnotations([
      makeAnnotationFor(a, expectedFingerprint(a, CONFIG, staleRef), staleRef),
    ]);
    const { repoDir, base } = initRepo(dataset);
    const head = commitHead(
      repoDir,
      base,
      annotationsBytes,
      metaBytesFor(annotationsBytes, dataset.datasetSha256),
    );
    const result = await verifyAiProvenanceFromGit({
      baseRef: base,
      headGitRef: head,
      source: sourceFor([a], { path: 'README.md', oid: 'oid-current' }),
      config: CONFIG,
      maxChangedPerRun: 25,
      cwd: repoDir,
    });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) => v.reason.includes('README OID') || v.reason.includes('fingerprint'),
      ),
    ).toBe(true);
  });

  it('GIT-3: a metadata-only artifact update is rejected', async () => {
    const a = repo('a');
    const dataset = makeDataset([a]);
    const annotationsBytes = serializeAnnotations([
      makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF),
    ]);
    const { repoDir, base } = initRepo(dataset);
    const baseMeta = metaBytesFor(annotationsBytes, dataset.datasetSha256);
    writeFileSync(join(repoDir, 'ai-annotations.json'), annotationsBytes);
    writeFileSync(join(repoDir, 'ai-annotations-meta.json'), baseMeta);
    git(repoDir, ['add', 'ai-annotations.json', 'ai-annotations-meta.json']);
    git(repoDir, ['commit', '-m', 'base artifacts']);
    const artifactBase = git(repoDir, ['rev-parse', 'HEAD']);
    const changedMeta = metaBytesFor(annotationsBytes, dataset.datasetSha256).replace(
      '2026-06-20T00:00:00Z',
      '2026-06-21T00:00:00Z',
    );
    const head = commitHead(repoDir, artifactBase, annotationsBytes, changedMeta);
    const result = await verifyAiProvenanceFromGit({
      baseRef: artifactBase,
      headGitRef: head,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
      cwd: repoDir,
    });
    expect(base).not.toBe(artifactBase);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.reason).toContain('metadata without changing');
  });
});
