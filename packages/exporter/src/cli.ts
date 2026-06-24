#!/usr/bin/env node
import { ExporterError, redactSecrets } from '@starred/github-client';
import { Command } from 'commander';
import { EXPORTER_VERSION, run } from './index';

const program = new Command();

program
  .name('stars-export')
  .description('Export GitHub stars to a deterministic canonical dataset (P0).')
  .version(EXPORTER_VERSION)
  .option('-c, --config <path>', 'path to config.yaml')
  .option('-o, --out-dir <path>', 'output directory', process.cwd())
  .action(async (opts: { config?: string; outDir: string }) => {
    try {
      const outcome = await run({ configPath: opts.config, outDir: opts.outDir });
      const change = outcome.changed ? 'updated' : 'unchanged';
      const pub = outcome.published ? 'published' : 'not published';
      process.stdout.write(`✓ exported ${outcome.repoCount} repos (${change}, ${pub})\n`);
      process.exit(0);
    } catch (err) {
      // Redact any secret-like values before they reach stderr/logs.
      const message = redactSecrets(err instanceof Error ? err.message : String(err), [
        process.env.STAR_SYNC_TOKEN,
      ]);
      // Each ExporterError carries its exit code: 10 = fatal (auth/schema/config),
      // 20 = deferred (do not publish; remote last-known-good preserved).
      if (err instanceof ExporterError) {
        process.stderr.write(`${err.code} (exit ${err.exitCode}): ${message}\n`);
        process.exit(err.exitCode);
      }
      process.stderr.write(`fatal (exit 10): ${message}\n`);
      process.exit(10);
    }
  });

void program.parseAsync(process.argv);
