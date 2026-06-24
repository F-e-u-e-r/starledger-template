import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeDataset, repo } from './helpers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('classifier CLI enablement', () => {
  it('ENABLE-1: disabled classification writes an empty trusted manifest without GitHub access', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starledger-classifier-cli-'));
    try {
      const { starsText, metaText, datasetSha256 } = makeDataset([repo('one')]);
      const stars = join(dir, 'stars.json');
      const meta = join(dir, 'dataset-meta.json');
      const config = join(dir, 'ai.yaml');
      const out = join(dir, 'manifest.json');
      writeFileSync(stars, starsText, 'utf8');
      writeFileSync(meta, metaText, 'utf8');
      writeFileSync(config, 'ai:\n  enabled: false\n', 'utf8');

      const stdout = execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'packages/classifier/src/cli.ts',
          '--config',
          config,
          'plan',
          '--stars',
          stars,
          '--meta',
          meta,
          '--out',
          out,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, STAR_SYNC_TOKEN: '', GITHUB_TOKEN: '' },
        },
      );

      expect(stdout).toContain('AI classification disabled');
      expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({
        dataset_sha256: datasetSha256,
        jobs: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
