import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AiAnnotationsMetaSchema,
  buildAiAnnotationsMeta,
  serializeAiAnnotationsMeta,
  serializeAnnotations,
} from '@starred/ai-schema';
import type { Annotation } from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { runMetaRebaseCommand } from '../src/meta-rebase-cli';
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
const STALE_SHA = 'e'.repeat(64);

function sourceFor(repos: CanonicalRepo[], ref = REF): FakeReadmeSource {
  return new FakeReadmeSource(
    readmeEntries(Object.fromEntries(repos.map((r) => [`${r.owner}/${r.name}`, { ref }]))),
  );
}

function headMetaBytes(annotationsBytes: string, datasetSha256: string): string {
  return serializeAiAnnotationsMeta(
    buildAiAnnotationsMeta({
      annotationsBytes,
      annotationCount: JSON.parse(annotationsBytes).annotations.length,
      datasetSha256,
      generatedAt: HEAD_TS,
    }),
  );
}

/** Write current base + head fixtures to a temp dir; return the paths. */
function fixture(
  repos: CanonicalRepo[],
  headAnnotations: Annotation[],
  baseAnnotations?: Annotation[],
) {
  const dir = mkdtempSync(join(tmpdir(), 'meta-rebase-cli-'));
  const { starsText, metaText } = makeDataset(repos);
  const starsPath = join(dir, 'stars.json');
  const metaPath = join(dir, 'dataset-meta.json');
  const headAnnotationsPath = join(dir, 'head-ai-annotations.json');
  const headMetaPath = join(dir, 'head-ai-annotations-meta.json');
  const outDir = join(dir, 'out');
  writeFileSync(starsPath, starsText);
  writeFileSync(metaPath, metaText);
  const headBytes = serializeAnnotations(headAnnotations);
  writeFileSync(headAnnotationsPath, headBytes);
  writeFileSync(headMetaPath, headMetaBytes(headBytes, STALE_SHA));
  let baseAnnotationsPath: string | undefined;
  if (baseAnnotations) {
    baseAnnotationsPath = join(dir, 'base-ai-annotations.json');
    writeFileSync(baseAnnotationsPath, serializeAnnotations(baseAnnotations));
  }
  return {
    dir,
    starsPath,
    metaPath,
    headAnnotationsPath,
    headMetaPath,
    baseAnnotationsPath,
    outDir,
    headBytes,
  };
}

describe('runMetaRebaseCommand (ROAD-A manual CLI orchestration)', () => {
  it('writes the re-stamped pair: annotations byte-identical, only dataset_sha256 changed', async () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const fx = fixture([a], [ann]);
    const expectedSha = (JSON.parse(readFileSync(fx.metaPath, 'utf8')) as { stars_sha256: string })
      .stars_sha256;

    const res = await runMetaRebaseCommand({
      starsPath: fx.starsPath,
      datasetMetaPath: fx.metaPath,
      headAnnotationsPath: fx.headAnnotationsPath,
      headMetaPath: fx.headMetaPath,
      outDir: fx.outDir,
      dryRun: false,
      coldStart: true,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });

    expect(res.ok).toBe(true);
    expect(res.wrote).toBe(true);
    expect(readFileSync(res.annotationsPath!, 'utf8')).toBe(fx.headBytes); // byte-identical
    const meta = AiAnnotationsMetaSchema.parse(JSON.parse(readFileSync(res.metaPath!, 'utf8')));
    expect(meta.dataset_sha256).toBe(expectedSha); // re-stamped onto current base
    expect(meta.dataset_sha256).not.toBe(STALE_SHA);
    expect(meta.generated_at).toBe(HEAD_TS); // preserved
  });

  it('--dry-run verifies but writes nothing', async () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const fx = fixture([a], [ann]);
    const res = await runMetaRebaseCommand({
      starsPath: fx.starsPath,
      datasetMetaPath: fx.metaPath,
      headAnnotationsPath: fx.headAnnotationsPath,
      headMetaPath: fx.headMetaPath,
      outDir: fx.outDir,
      dryRun: true,
      coldStart: true,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(res.ok).toBe(true);
    expect(res.wrote).toBe(false);
    expect(existsSync(fx.outDir)).toBe(false);
  });

  it('omitting --out-dir is report-only (no write)', async () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const fx = fixture([a], [ann]);
    const res = await runMetaRebaseCommand({
      starsPath: fx.starsPath,
      datasetMetaPath: fx.metaPath,
      headAnnotationsPath: fx.headAnnotationsPath,
      headMetaPath: fx.headMetaPath,
      dryRun: false,
      coldStart: true,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(res.ok).toBe(true);
    expect(res.wrote).toBe(false);
  });

  it('refuses (no write) when a head annotation has a stale README OID', async () => {
    const a = repo('a');
    const staleRef = { path: 'README.md', oid: 'oid-old' };
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, staleRef), staleRef);
    const fx = fixture([a], [ann]);
    const res = await runMetaRebaseCommand({
      starsPath: fx.starsPath,
      datasetMetaPath: fx.metaPath,
      headAnnotationsPath: fx.headAnnotationsPath,
      headMetaPath: fx.headMetaPath,
      outDir: fx.outDir,
      dryRun: false,
      coldStart: true,
      source: sourceFor([a], { path: 'README.md', oid: 'oid-new' }),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(res.ok).toBe(false);
    expect(res.wrote).toBe(false);
    expect(existsSync(fx.outDir)).toBe(false);
    expect(res.violations.some((v) => v.reason.includes('README OID'))).toBe(true);
  });

  it('refuses when the delta exceeds the per-run budget (PROV-8)', async () => {
    const a = repo('a');
    const b = repo('b');
    const annA = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const annB = makeAnnotationFor(b, expectedFingerprint(b, CONFIG, REF), REF);
    const fx = fixture([a, b], [annA, annB]);
    const res = await runMetaRebaseCommand({
      starsPath: fx.starsPath,
      datasetMetaPath: fx.metaPath,
      headAnnotationsPath: fx.headAnnotationsPath,
      headMetaPath: fx.headMetaPath,
      outDir: fx.outDir,
      dryRun: false,
      coldStart: true,
      source: sourceFor([a, b]),
      config: CONFIG,
      maxChangedPerRun: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.wrote).toBe(false);
  });

  it('refuses a metadata-only re-stamp (head annotations equal the base)', async () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const fx = fixture([a], [ann], [ann]); // base already has ann → head == base
    const res = await runMetaRebaseCommand({
      starsPath: fx.starsPath,
      datasetMetaPath: fx.metaPath,
      baseAnnotationsPath: fx.baseAnnotationsPath,
      headAnnotationsPath: fx.headAnnotationsPath,
      headMetaPath: fx.headMetaPath,
      outDir: fx.outDir,
      dryRun: false,
      coldStart: true,
      source: sourceFor([a]),
      config: CONFIG,
      maxChangedPerRun: 25,
    });
    expect(res.ok).toBe(false);
    expect(res.wrote).toBe(false);
    expect(res.violations.some((v) => v.reason.includes('metadata-only'))).toBe(true);
  });

  it('fails closed when a SUPPLIED base-annotations path does not exist (typo)', async () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const fx = fixture([a], [ann]);
    await expect(
      runMetaRebaseCommand({
        starsPath: fx.starsPath,
        datasetMetaPath: fx.metaPath,
        baseAnnotationsPath: join(fx.dir, 'does-not-exist.json'),
        headAnnotationsPath: fx.headAnnotationsPath,
        headMetaPath: fx.headMetaPath,
        outDir: fx.outDir,
        dryRun: false,
        coldStart: true,
        source: sourceFor([a]),
        config: CONFIG,
        maxChangedPerRun: 25,
      }),
    ).rejects.toThrow(/base annotations file not found/);
  });

  it('a write-phase failure preserves the pre-existing pair intact (atomic temp+rename)', async () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const fx = fixture([a], [ann]);
    mkdirSync(fx.outDir, { recursive: true });
    // A pre-existing pair the operator must not lose (as under `--out-dir .`).
    writeFileSync(join(fx.outDir, 'ai-annotations.json'), 'OLD-ANN');
    writeFileSync(join(fx.outDir, 'ai-annotations-meta.json'), 'OLD-META');
    // Sabotage the temp write so nothing is renamed into place.
    mkdirSync(join(fx.outDir, 'ai-annotations.json.rebase-tmp'), { recursive: true });
    await expect(
      runMetaRebaseCommand({
        starsPath: fx.starsPath,
        datasetMetaPath: fx.metaPath,
        headAnnotationsPath: fx.headAnnotationsPath,
        headMetaPath: fx.headMetaPath,
        outDir: fx.outDir,
        dryRun: false,
        coldStart: true,
        source: sourceFor([a]),
        config: CONFIG,
        maxChangedPerRun: 25,
      }),
    ).rejects.toThrow();
    // BOTH pre-existing files are untouched — never overwritten or deleted.
    expect(readFileSync(join(fx.outDir, 'ai-annotations.json'), 'utf8')).toBe('OLD-ANN');
    expect(readFileSync(join(fx.outDir, 'ai-annotations-meta.json'), 'utf8')).toBe('OLD-META');
  });

  it('requires an explicit --base-annotations or --cold-start (no silent empty base)', async () => {
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const fx = fixture([a], [ann]);
    await expect(
      runMetaRebaseCommand({
        starsPath: fx.starsPath,
        datasetMetaPath: fx.metaPath,
        headAnnotationsPath: fx.headAnnotationsPath,
        headMetaPath: fx.headMetaPath,
        outDir: fx.outDir,
        dryRun: false,
        // no baseAnnotationsPath and no coldStart
        source: sourceFor([a]),
        config: CONFIG,
        maxChangedPerRun: 25,
      }),
    ).rejects.toThrow(/--cold-start/);
  });
});

describe('meta-rebase stays manual (not wired into CI)', () => {
  const root = resolve(import.meta.dirname, '../../..');

  it('no workflow, script, or package.json script invokes the meta-rebase command', () => {
    const offenders: string[] = [];
    // Workflow + script files: any mention at all.
    for (const rel of ['.github/workflows', 'scripts']) {
      const dir = join(root, rel);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (readFileSync(join(dir, f), 'utf8').includes('meta-rebase'))
          offenders.push(`${rel}/${f}`);
      }
    }
    // package.json scripts (root + every workspace package/app) — CI runs `pnpm` scripts.
    const pkgDirs = [root];
    for (const group of ['packages', 'apps']) {
      const dir = join(root, group);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) pkgDirs.push(join(dir, f));
    }
    for (const d of pkgDirs) {
      const pj = join(d, 'package.json');
      if (!existsSync(pj)) continue;
      const scripts = ((
        JSON.parse(readFileSync(pj, 'utf8')) as { scripts?: Record<string, string> }
      ).scripts ?? {}) as Record<string, string>;
      for (const [name, cmd] of Object.entries(scripts)) {
        if (cmd.includes('meta-rebase')) offenders.push(`${pj} script "${name}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('meta-rebase CLI action gates', () => {
  const root = resolve(import.meta.dirname, '../../..');

  it('exits 10 with a token error when no GitHub token is set (enabled config)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meta-rebase-cli-gate-'));
    const a = repo('a');
    const ann = makeAnnotationFor(a, expectedFingerprint(a, CONFIG, REF), REF);
    const { starsText, metaText } = makeDataset([a]);
    const stars = join(dir, 'stars.json');
    const meta = join(dir, 'dataset-meta.json');
    const ha = join(dir, 'ai-annotations.json');
    const hm = join(dir, 'ai-annotations-meta.json');
    const config = join(dir, 'ai.yaml');
    writeFileSync(stars, starsText);
    writeFileSync(meta, metaText);
    const headBytes = serializeAnnotations([ann]);
    writeFileSync(ha, headBytes);
    writeFileSync(hm, headMetaBytes(headBytes, STALE_SHA));
    writeFileSync(config, 'ai:\n  enabled: true\n');

    let status: number | null = null;
    let stderr = '';
    try {
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'packages/classifier/src/cli.ts',
          '--config',
          config,
          'meta-rebase',
          '--stars',
          stars,
          '--meta',
          meta,
          '--head-annotations',
          ha,
          '--head-meta',
          hm,
          '--dry-run',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, STAR_SYNC_TOKEN: '', GITHUB_TOKEN: '' },
        },
      );
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      status = e.status ?? null;
      stderr = e.stderr ?? '';
    }
    expect(status).toBe(10);
    expect(stderr).toMatch(/token/i);
  });
});
