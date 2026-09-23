import type { CanonicalRepo } from '@starred/schema';
import { describe, expect, it, vi } from 'vitest';
import { loadCanonicalDataset } from '../src/dataset';
import { planClassification } from '../src/planner';
import { verifyAnnotationProvenance } from '../src/provenance';
import { OctokitReadmeSource } from '../src/readme-source';
import { EMPTY_CLASSIFIER_STATE } from '../src/state';
import { aiConfig, makeAnnotationFor, makeDataset, repo } from './helpers';

function load(repos: CanonicalRepo[]) {
  const { starsBytes, metaText } = makeDataset(repos);
  return loadCanonicalDataset(starsBytes, metaText);
}

/** A REAL OctokitReadmeSource over the MEASURED REST response for a preferred
 * README larger than 1 MB (the PRs #91/#92 incident shape): HTTP 200, path and
 * sha populated, bytes withheld (`encoding: "none"`). A generic fake returning
 * `ref: null` would make this test tautological — the point is that the
 * production seam itself maps this response to "no usable README" for BOTH the
 * planner and the provenance gate. */
function oversizedReadmeSource(): OctokitReadmeSource {
  const request = vi.fn().mockResolvedValue({
    data: {
      path: 'README.md',
      sha: 'a1980e06d716b906abbbe12451b55d49e0995921',
      content: '',
      encoding: 'none',
      size: 1_153_334,
    },
  });
  return new OctokitReadmeSource({ octokit: { request } } as never);
}

describe('planner ↔ provenance gate README-usability consistency (PRs #91/#92)', () => {
  it('USE-1: a >1 MB README plans as a metadata-kind job that then PASSES the gate', async () => {
    const a = repo('a');
    const dataset = load([a]);
    const config = aiConfig();

    const planned = await planClassification({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      state: EMPTY_CLASSIFIER_STATE,
      existingAnnotations: [],
      config,
      source: oversizedReadmeSource(),
      now: new Date('2026-07-17T00:00:00Z'),
    });
    expect(planned.manifest.jobs).toHaveLength(1);
    const job = planned.manifest.jobs[0]!;
    expect(job.input.readme).toBeNull(); // planned from metadata, not demoted mid-run

    // The artifact an executor would commit for that job…
    const annotation = makeAnnotationFor(a, job.source_fingerprint, null);

    // …must pass the gate, whose OWN discovery over the same measured response
    // now reaches the same "no usable README" answer (fresh source instance —
    // the gate never shares the planner's cache).
    const gate = await verifyAnnotationProvenance({
      repos: dataset.repos,
      datasetSha256: dataset.datasetSha256,
      baseAnnotations: [],
      headAnnotations: [annotation],
      headMetaDatasetSha256: dataset.datasetSha256,
      source: oversizedReadmeSource(),
      config,
      maxChangedPerRun: 25,
    });
    expect(gate.violations).toEqual([]);
    expect(gate.ok).toBe(true);
  });
});
