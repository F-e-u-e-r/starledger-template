import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import { verifyDatasetIntegrity } from './dataset';
import { writeFixtureDataset } from './fixture';
import { DATASET_META_FILE, STARS_FILE, stageAiArtifacts, stageDashboardData } from './stage';
import { staticSmoke, verifyBuiltArtifact } from './verify';

const repoRoot = resolve(import.meta.dirname, '../../..');
const DEFAULT_DIST = resolve(repoRoot, 'apps/dashboard/dist');

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Mirror the dashboard's vite.config base-path derivation. */
function derivedBase(): string {
  const repo = env.GITHUB_REPOSITORY?.split('/')[1];
  return env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/';
}

async function main(): Promise<void> {
  const cmd = argv[2];
  const dist = flag('dist') ?? DEFAULT_DIST;
  const data = flag('data') ?? repoRoot;
  const base = flag('base') ?? derivedBase();

  switch (cmd) {
    case 'stage': {
      const r = stageDashboardData({ dataDir: data, distDir: dist });
      console.log(`[deploy] staged ${r.repoCount} repos (sha ${r.sha256.slice(0, 12)}…) → ${dist}`);
      const ai = stageAiArtifacts({ dataDir: data, distDir: dist });
      console.log(`[deploy] AI artifacts: ${ai.staged ? 'staged' : `skipped (${ai.reason})`}`);
      break;
    }
    case 'verify': {
      const r = verifyBuiltArtifact({ distDir: dist, base });
      console.log(`[deploy] dist verified: ${r.repoCount} repos, base ${r.base}`);
      break;
    }
    case 'smoke': {
      const r = await staticSmoke({ distDir: dist, base });
      console.log(`[deploy] static smoke OK: ${r.repoCount} repos, base ${r.base}`);
      break;
    }
    case 'check-data': {
      const starsPath = resolve(data, STARS_FILE);
      const metaPath = resolve(data, DATASET_META_FILE);
      if (!existsSync(starsPath) || !existsSync(metaPath)) {
        throw new Error(`canonical data not found in ${data}`);
      }
      const r = verifyDatasetIntegrity(
        readFileSync(starsPath, 'utf8'),
        readFileSync(metaPath, 'utf8'),
      );
      console.log(`[deploy] data OK: ${r.meta.repo_count} repos (sha ${r.sha256.slice(0, 12)}…)`);
      break;
    }
    case 'fixture': {
      const out = flag('out') ?? data;
      const r = writeFixtureDataset(out);
      console.log(`[deploy] wrote fixture dataset (${r.repoCount} repos) → ${out}`);
      break;
    }
    default:
      console.error(
        'usage: deploy <stage|verify|smoke|fixture> [--data dir] [--dist dir] [--base /x/] [--out dir]',
      );
      exit(2);
  }
}

main().catch((err: unknown) => {
  console.error(`[deploy] ${err instanceof Error ? err.message : String(err)}`);
  exit(1);
});
