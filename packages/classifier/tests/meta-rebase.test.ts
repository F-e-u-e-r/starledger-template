import {
  AiAnnotationsMetaSchema,
  AiAnnotationsSchema,
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
} from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { loadCanonicalDataset } from '../src/dataset';
import { rebaseAiAnnotationsMeta } from '../src/meta-rebase';
import { verifyAnnotationProvenance } from '../src/provenance';
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
const HEAD_TS = '2026-07-01T00:00:00Z';
const STALE_SHA = 'e'.repeat(64); // the in-flight head meta's (now stale) dataset_sha256

function load(repos: CanonicalRepo[]) {
  const { starsBytes, metaText } = makeDataset(repos);
  return loadCanonicalDataset(starsBytes, metaText);
}

function sourceFor(repos: CanonicalRepo[], ref = REF): FakeReadmeSource {
  return new FakeReadmeSource(
    readmeEntries(Object.fromEntries(repos.map((r) => [`${r.owner}/${r.name}`, { ref }]))),
  );
}

/** Build a canonical head meta over `annotationsBytes` with a given dataset SHA. */
function buildHeadMeta(
  annotationsBytes: string,
  datasetSha256: string,
  generatedAt = HEAD_TS,
): string {
  const count = AiAnnotationsSchema.parse(JSON.parse(annotationsBytes)).annotations.length;
  return serializeAiAnnotationsMeta(
    buildAiAnnotationsMeta({
      annotationsBytes,
      annotationCount: count,
      datasetSha256,
      generatedAt,
    }),
  );
}

describe('rebaseAiAnnotationsMeta (ROAD-A, model-free)', () => {
  it('re-stamps ONLY dataset_sha256 onto the current base, preserving generated_at', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const headAnnotationsText = serializeAnnotations([ann]);
    const headAnnotationsBytes = Buffer.from(headAnnotationsText, 'utf8');
    const headMetaBytes = buildHeadMeta(headAnnotationsText, STALE_SHA);

    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes,
      headMetaBytes,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });

    expect(result.ok).toBe(true);
    expect(result.annotationsBytes).toBe(headAnnotationsBytes); // BYTES preserved exactly (same reference, never re-serialized)
    const meta = AiAnnotationsMetaSchema.parse(JSON.parse(result.metaBytes!));
    expect(meta.dataset_sha256).toBe(dataset.datasetSha256); // moved to current base
    expect(meta.generated_at).toBe(HEAD_TS); // preserved from head meta (no churn)
    // ONLY dataset_sha256 differs from the original head meta:
    const head = AiAnnotationsMetaSchema.parse(JSON.parse(headMetaBytes));
    expect({ ...meta, dataset_sha256: STALE_SHA }).toEqual(head);
    expect(result.metaBytes).toBe(
      serializeAiAnnotationsMeta({ ...head, dataset_sha256: dataset.datasetSha256 }),
    );
  });

  it('the re-stamped artifacts pass the real provenance gate (PROV-5 satisfied)', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const headAnnotationsBytes = serializeAnnotations([ann]);
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes: Buffer.from(headAnnotationsBytes, 'utf8'),
      headMetaBytes: buildHeadMeta(headAnnotationsBytes, STALE_SHA),
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    const meta = AiAnnotationsMetaSchema.parse(JSON.parse(result.metaBytes!));
    // A gate run against the STALE head meta would fail PROV-5; against the
    // re-stamped meta it passes.
    const gate = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [ann],
      headMetaDatasetSha256: meta.dataset_sha256,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(gate.ok).toBe(true);
  });

  it('refuses to re-stamp when a head annotation has a stale README OID', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const staleRef = { path: 'README.md', oid: 'oid-old' };
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, staleRef), staleRef);
    const headAnnotationsBytes = serializeAnnotations([ann]);
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes: Buffer.from(headAnnotationsBytes, 'utf8'),
      headMetaBytes: buildHeadMeta(headAnnotationsBytes, STALE_SHA),
      source: sourceFor([a], { path: 'README.md', oid: 'oid-new' }),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.metaBytes).toBeUndefined();
    expect(result.violations.some((v) => v.reason.includes('README OID'))).toBe(true);
  });

  it('refuses an invented node not in the canonical dataset', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ghost = makeAnnotationFor(repo('ghost'), 'f'.repeat(64), null);
    const headAnnotationsBytes = serializeAnnotations([ghost]);
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes: Buffer.from(headAnnotationsBytes, 'utf8'),
      headMetaBytes: buildHeadMeta(headAnnotationsBytes, STALE_SHA),
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.metaBytes).toBeUndefined();
  });

  it('rejects a head meta whose annotation_count was tampered (no silent repair)', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const headAnnotationsBytes = serializeAnnotations([ann]);
    const good = AiAnnotationsMetaSchema.parse(
      JSON.parse(buildHeadMeta(headAnnotationsBytes, STALE_SHA)),
    );
    const tampered = serializeAiAnnotationsMeta({ ...good, annotation_count: 99 });
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes: Buffer.from(headAnnotationsBytes, 'utf8'),
      headMetaBytes: tampered,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]!.reason).toMatch(/invalid|count/i);
  });

  it('rejects a non-canonical head meta', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const headAnnotationsBytes = serializeAnnotations([ann]);
    const nonCanonical = JSON.stringify(JSON.parse(buildHeadMeta(headAnnotationsBytes, STALE_SHA)));
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes: Buffer.from(headAnnotationsBytes, 'utf8'),
      headMetaBytes: nonCanonical,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-canonical ai-annotations.json bytes', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const nonCanonical = JSON.stringify(JSON.parse(serializeAnnotations([ann])));
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes: Buffer.from(nonCanonical, 'utf8'),
      headMetaBytes: buildHeadMeta(nonCanonical, STALE_SHA),
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
  });

  it('exceeding the per-run budget is rejected (PROV-8 preserved)', async () => {
    const a = repo('a');
    const b = repo('b');
    const dataset = load([a, b]);
    const annA = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const annB = makeAnnotationFor(b, expectedFingerprint(b, CONFIG, REF), REF);
    const headAnnotationsBytes = serializeAnnotations([annA, annB]);
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotationsBytes: Buffer.from(headAnnotationsBytes, 'utf8'),
      headMetaBytes: buildHeadMeta(headAnnotationsBytes, STALE_SHA),
      source: sourceFor([a, b]),
      config: CONFIG,
      maxChangedPerRun: 1,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a no-op rebase where head annotations equal the base (metadata-only)', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const headAnnotationsBytes = serializeAnnotations([ann]);
    const result = await rebaseAiAnnotationsMeta({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [ann], // base already carries this annotation → head == base
      headAnnotationsBytes: Buffer.from(headAnnotationsBytes, 'utf8'),
      headMetaBytes: buildHeadMeta(headAnnotationsBytes, STALE_SHA),
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes('metadata-only'))).toBe(true);
  });
});
