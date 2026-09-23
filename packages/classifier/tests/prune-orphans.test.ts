import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeAnnotations } from '@starred/ai-schema';
import { describe, expect, it } from 'vitest';
import { verifyAiArtifacts } from '../src/assemble';
import { runPruneOrphans } from '../src/prune-orphans';
import { makeAnnotation } from '../../ai-schema/tests/helpers';
import { makeDataset, repo } from './helpers';

function writeCanonicalFixtures(dir: string, ids: readonly string[]): string {
  const { starsText, metaText, datasetSha256 } = makeDataset(ids.map((id) => repo(id)));
  writeFileSync(join(dir, 'stars.json'), starsText);
  writeFileSync(join(dir, 'dataset-meta.json'), metaText);
  return datasetSha256;
}

describe('prune-orphans maintenance path (issue #212)', () => {
  it('PRUNE-CLI-1: prunes the orphan, writes the verified pair, and reports a full receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-orphans-'));
    const datasetSha256 = writeCanonicalFixtures(dir, ['a', 'b']);
    const annotations = [
      makeAnnotation({ node_id: 'R_a' }),
      makeAnnotation({ node_id: 'R_zz' }), // orphan: repository left the dataset
    ];
    writeFileSync(join(dir, 'ai-annotations.json'), serializeAnnotations(annotations));
    const out = join(dir, 'out');
    const receipt = runPruneOrphans({
      starsPath: join(dir, 'stars.json'),
      datasetMetaPath: join(dir, 'dataset-meta.json'),
      currentPath: join(dir, 'ai-annotations.json'),
      generatedAt: '2026-07-29T00:00:00Z',
      outDir: out,
    });
    expect(receipt).toMatchObject({
      datasetSha256,
      canonicalCount: 2,
      beforeCount: 2,
      prunedNodeIds: ['R_zz'],
      afterCount: 1,
      changed: true,
    });
    const annotationsBytes = readFileSync(receipt.annotationsPath ?? '', 'utf8');
    const metaBytes = readFileSync(receipt.metaPath ?? '', 'utf8');
    // Verify over the file's RAW bytes (the digest is a byte contract).
    verifyAiArtifacts(readFileSync(receipt.annotationsPath ?? ''), metaBytes);
    expect(annotationsBytes).not.toContain('R_zz');
    expect(JSON.parse(metaBytes).dataset_sha256).toBe(datasetSha256);
    expect(JSON.parse(metaBytes).annotation_count).toBe(1);
    // the surviving record keeps its original timestamp (no churn)
    const survivors = JSON.parse(annotationsBytes).annotations as Array<{
      generation: { generated_at: string };
    }>;
    expect(survivors[0]?.generation.generated_at).toBe('2026-06-20T00:00:00Z');
  });

  it('PRUNE-CLI-2: with no orphans it is a no-op and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-orphans-'));
    writeCanonicalFixtures(dir, ['a']);
    writeFileSync(
      join(dir, 'ai-annotations.json'),
      serializeAnnotations([makeAnnotation({ node_id: 'R_a' })]),
    );
    const out = join(dir, 'out');
    const receipt = runPruneOrphans({
      starsPath: join(dir, 'stars.json'),
      datasetMetaPath: join(dir, 'dataset-meta.json'),
      currentPath: join(dir, 'ai-annotations.json'),
      generatedAt: '2026-07-29T00:00:00Z',
      outDir: out,
    });
    expect(receipt).toMatchObject({
      canonicalCount: 1,
      beforeCount: 1,
      prunedNodeIds: [],
      afterCount: 1,
      changed: false,
      annotationsPath: null,
      metaPath: null,
    });
    expect(existsSync(join(out, 'ai-annotations.json'))).toBe(false);
    expect(existsSync(join(out, 'ai-annotations-meta.json'))).toBe(false);
  });
});
