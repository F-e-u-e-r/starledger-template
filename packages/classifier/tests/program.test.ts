import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildClassificationManifest,
  serializeAnnotations,
  serializeClassificationManifest,
} from '@starred/ai-schema';
import { describe, expect, it, vi } from 'vitest';
import { verifyAiArtifacts } from '../src/assemble';
import { buildProgram } from '../src/program';
import { makeAnnotation } from '../../ai-schema/tests/helpers';
import { makeDataset, repo } from './helpers';

describe('classifier CLI construction (issue #56)', () => {
  it('REG-1: buildProgram() registers every command and parses nothing at import time', () => {
    const program = buildProgram();
    expect(program.name()).toBe('stars-classify');
    expect(program.commands.map((command) => command.name()).sort()).toEqual([
      'apply',
      'meta-rebase',
      'plan',
      'prune-orphans',
      'validate-candidates',
      'verify-agent-diff',
      'verify-agent-pr',
      'verify-ai-provenance',
      'verify-artifacts',
    ]);
  });
});

/** Sentinel thrown by the process.exit spy so fatal() unwinds instead of exiting. */
class ExitSignal extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`exit ${String(code)}`);
  }
}

describe('apply canonical binding (issue #212)', () => {
  it('APPLY-SHA: a manifest from a different canonical snapshot is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'classifier-apply-'));
    const { starsText, metaText } = makeDataset([repo('a')]);
    writeFileSync(join(dir, 'stars.json'), starsText);
    writeFileSync(join(dir, 'dataset-meta.json'), metaText);
    const manifest = buildClassificationManifest({
      promptVersion: 'classify-v1',
      executionProfileVersion: 'agent-v1',
      executorKind: 'claude-routine',
      datasetSha256: 'f'.repeat(64),
      jobs: [],
    });
    writeFileSync(join(dir, 'manifest.json'), serializeClassificationManifest(manifest));
    writeFileSync(
      join(dir, 'candidates.json'),
      `${JSON.stringify({ schema_version: '1.0', candidates: [] })}\n`,
    );
    const stderr: string[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?) => {
      throw new ExitSignal(code);
    });
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      await expect(
        buildProgram().parseAsync([
          'node',
          'stars-classify',
          'apply',
          '--manifest',
          join(dir, 'manifest.json'),
          '--candidates',
          join(dir, 'candidates.json'),
          '--generated-at',
          '2026-07-29T00:00:00Z',
          '--out-dir',
          dir,
          '--stars',
          join(dir, 'stars.json'),
          '--meta',
          join(dir, 'dataset-meta.json'),
        ]),
      ).rejects.toBeInstanceOf(ExitSignal);
      expect(stderr.join('')).toContain('does not match the verified canonical dataset');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

async function runCliCapturingStdout(argv: readonly string[]): Promise<string> {
  const out: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      out.push(String(chunk));
      return true;
    });
  try {
    await buildProgram().parseAsync([...argv]);
  } finally {
    outSpy.mockRestore();
  }
  return out.join('');
}

describe('prune-orphans CLI receipt (issue #213 round 1)', () => {
  it('PRUNE-STDOUT-1: the orphan run prints the load-bearing "pruned: N" line and writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-stdout-'));
    const { starsText, metaText } = makeDataset([repo('a'), repo('b')]);
    writeFileSync(join(dir, 'stars.json'), starsText);
    writeFileSync(join(dir, 'dataset-meta.json'), metaText);
    writeFileSync(
      join(dir, 'ai-annotations.json'),
      serializeAnnotations([
        makeAnnotation({ node_id: 'R_a' }),
        makeAnnotation({ node_id: 'R_zz' }),
      ]),
    );
    const out = join(dir, 'out');
    const stdout = await runCliCapturingStdout([
      'node',
      'stars-classify',
      'prune-orphans',
      '--stars',
      join(dir, 'stars.json'),
      '--meta',
      join(dir, 'dataset-meta.json'),
      '--current',
      join(dir, 'ai-annotations.json'),
      '--generated-at',
      '2026-07-29T00:00:00Z',
      '--out-dir',
      out,
    ]);
    // step 3e parses this exact receipt shape — it is an interface, not cosmetics
    expect(stdout).toMatch(/^pruned: 1 \(R_zz\)$/m);
    expect(stdout).toContain('wrote pruned artifact pair');
    expect(readFileSync(join(out, 'ai-annotations.json'), 'utf8')).not.toContain('R_zz');
  });

  it('PRUNE-STDOUT-2: the no-op run prints "pruned: 0" and reports nothing written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-stdout-'));
    const { starsText, metaText } = makeDataset([repo('a')]);
    writeFileSync(join(dir, 'stars.json'), starsText);
    writeFileSync(join(dir, 'dataset-meta.json'), metaText);
    writeFileSync(
      join(dir, 'ai-annotations.json'),
      serializeAnnotations([makeAnnotation({ node_id: 'R_a' })]),
    );
    const stdout = await runCliCapturingStdout([
      'node',
      'stars-classify',
      'prune-orphans',
      '--stars',
      join(dir, 'stars.json'),
      '--meta',
      join(dir, 'dataset-meta.json'),
      '--current',
      join(dir, 'ai-annotations.json'),
      '--generated-at',
      '2026-07-29T00:00:00Z',
      '--out-dir',
      join(dir, 'out'),
    ]);
    expect(stdout).toMatch(/^pruned: 0$/m);
    expect(stdout).toContain('no orphan annotations');
  });
});

describe('apply prune wiring (issue #213 round 1)', () => {
  it('APPLY-PRUNE: a matching-SHA apply with zero candidates prunes the orphan and writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apply-prune-'));
    const { starsText, metaText, datasetSha256 } = makeDataset([repo('a')]);
    writeFileSync(join(dir, 'stars.json'), starsText);
    writeFileSync(join(dir, 'dataset-meta.json'), metaText);
    writeFileSync(
      join(dir, 'ai-annotations.json'),
      serializeAnnotations([
        makeAnnotation({ node_id: 'R_a' }),
        makeAnnotation({ node_id: 'R_zz' }),
      ]),
    );
    const manifest = buildClassificationManifest({
      promptVersion: 'classify-v1',
      executionProfileVersion: 'agent-v1',
      executorKind: 'claude-routine',
      datasetSha256,
      jobs: [],
    });
    writeFileSync(join(dir, 'manifest.json'), serializeClassificationManifest(manifest));
    writeFileSync(
      join(dir, 'candidates.json'),
      `${JSON.stringify({ schema_version: '1.0', candidates: [] })}\n`,
    );
    const out = join(dir, 'out');
    const stdout = await runCliCapturingStdout([
      'node',
      'stars-classify',
      'apply',
      '--manifest',
      join(dir, 'manifest.json'),
      '--candidates',
      join(dir, 'candidates.json'),
      '--generated-at',
      '2026-07-29T00:00:00Z',
      '--out-dir',
      out,
      '--current',
      join(dir, 'ai-annotations.json'),
      '--stars',
      join(dir, 'stars.json'),
      '--meta',
      join(dir, 'dataset-meta.json'),
    ]);
    expect(stdout).toContain('pruned 1 orphan(s): R_zz');
    const annotationsBytes = readFileSync(join(out, 'ai-annotations.json'), 'utf8');
    const metaBytes = readFileSync(join(out, 'ai-annotations-meta.json'), 'utf8');
    // Verify over the file's RAW bytes (the digest is a byte contract).
    verifyAiArtifacts(readFileSync(join(out, 'ai-annotations.json')), metaBytes);
    expect(annotationsBytes).not.toContain('R_zz');
    expect(JSON.parse(metaBytes).dataset_sha256).toBe(datasetSha256);
  });
});
