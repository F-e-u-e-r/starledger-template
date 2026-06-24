import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
} from '@starred/ai-schema';
import { describe, expect, it } from 'vitest';
import { AI_ANNOTATIONS_FILE, AI_ANNOTATIONS_META_FILE, stageAiArtifacts } from '../src/stage';

function validArtifactPair(): { annotations: string; meta: string } {
  const annotations = serializeAnnotations([]);
  const meta = serializeAiAnnotationsMeta(
    buildAiAnnotationsMeta({
      annotationsBytes: annotations,
      annotationCount: 0,
      datasetSha256: 'd'.repeat(64),
      generatedAt: '2026-06-21T00:00:00Z',
    }),
  );
  return { annotations, meta };
}

function dirs(): { dataDir: string; distDir: string } {
  return {
    dataDir: mkdtempSync(join(tmpdir(), 'ai-stage-data-')),
    distDir: mkdtempSync(join(tmpdir(), 'ai-stage-dist-')),
  };
}

describe('AI artifact staging (fail-soft publication)', () => {
  it('PUB-7: stages a valid AI artifact pair into the dist', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(join(dataDir, AI_ANNOTATIONS_META_FILE), pair.meta);
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(true);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(true);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_META_FILE))).toBe(true);
  });

  it('is fail-soft when AI artifacts are absent (canonical deploy proceeds)', () => {
    const { dataDir, distDir } = dirs();
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
  });

  it('is fail-soft (skips, never throws) on a hash mismatch', () => {
    const { dataDir, distDir } = dirs();
    const pair = validArtifactPair();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), pair.annotations);
    writeFileSync(
      join(dataDir, AI_ANNOTATIONS_META_FILE),
      pair.meta.replace(/[0-9a-f]{64}/, '0'.repeat(64)),
    );
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
  });

  it('is fail-soft when a hash-matching artifact fails the strict AI schemas', () => {
    const { dataDir, distDir } = dirs();
    writeFileSync(join(dataDir, AI_ANNOTATIONS_FILE), '{"schema_version":"1.0"}\n');
    writeFileSync(
      join(dataDir, AI_ANNOTATIONS_META_FILE),
      JSON.stringify({
        annotations_sha256: '4fde2c62eaeb82fe10581324384d0af72f965f0cc1d8375b234453bbd24c1857',
      }),
    );
    const result = stageAiArtifacts({ dataDir, distDir });
    expect(result.staged).toBe(false);
    expect(existsSync(join(distDir, AI_ANNOTATIONS_FILE))).toBe(false);
  });
});
