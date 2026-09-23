#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { loadDiscoveryDecisions, loadDiscoveryInboxConfig } from './config';
import { runPipeline, serializeCandidates, serializeMeta } from './pipeline';
import { createOctokitCandidateResolver } from './resolve';
import {
  DISCOVERY_VERSION,
  DiscoveryCandidatesFileSchema,
  DiscoveryCandidatesMetaSchema,
} from './schemas';

const program = new Command();

program
  .name('stars-discover')
  .description('Generate discovery candidate artifacts from manual sources (P5).')
  .version(DISCOVERY_VERSION)
  .option('--inbox <path>', 'path to discovery-inbox.yaml', 'config/discovery-inbox.yaml')
  .option(
    '--decisions <path>',
    'path to discovery-decisions.yaml',
    'config/discovery-decisions.yaml',
  )
  .option('--stars <path>', 'path to stars.json', 'stars.json')
  .option('--out-dir <path>', 'output directory for artifacts', '.')
  .option('--dry-run', 'parse and validate without resolving via API')
  .action(
    async (opts: {
      inbox: string;
      decisions: string;
      stars: string;
      outDir: string;
      dryRun?: boolean;
    }) => {
      const inboxConfig = loadDiscoveryInboxConfig(opts.inbox);

      if (inboxConfig.manual.length === 0) {
        process.stdout.write('No manual candidates configured. Nothing to do.\n');
        process.exit(0);
      }

      const token = process.env.STAR_SYNC_TOKEN?.trim();
      if (!token && !opts.dryRun) {
        process.stderr.write('STAR_SYNC_TOKEN is not set. Use --dry-run for offline validation.\n');
        process.exit(10);
      }

      const decisions = loadDiscoveryDecisions(opts.decisions);

      process.stdout.write(`Discovery inbox: ${inboxConfig.manual.length} manual entries\n`);

      if (opts.dryRun) {
        process.stdout.write('Dry run: skipping GitHub API resolution.\n');
        for (const entry of inboxConfig.manual) {
          process.stdout.write(`  ${entry.url}\n`);
        }
        process.exit(0);
      }

      const candidatesPath = resolve(opts.outDir, 'discovery-candidates.json');
      const metaPath = resolve(opts.outDir, 'discovery-candidates-meta.json');

      const resolver = createOctokitCandidateResolver(token!);
      const result = await runPipeline({
        manualEntries: inboxConfig.manual,
        starsPath: opts.stars,
        decisions,
        resolver,
        previousCandidatesPath: candidatesPath,
      });

      for (const error of result.errors) {
        process.stderr.write(`  ! ${error.url}: ${error.message}\n`);
      }

      if (!result.changed) {
        process.stdout.write(
          `✓ ${result.meta.candidate_count} candidates unchanged. Nothing to write.\n`,
        );
        return;
      }

      writeFileSync(candidatesPath, serializeCandidates(result.candidates));
      writeFileSync(metaPath, serializeMeta(result.meta));

      process.stdout.write(
        `✓ ${result.meta.candidate_count} candidates, ${result.meta.source_count} sources → ${candidatesPath}\n`,
      );
      if (result.errors.length > 0) {
        process.stdout.write(`  ${result.errors.length} error(s) during resolution\n`);
      }
    },
  );

program
  .command('verify')
  .description('Validate existing discovery artifacts against their schemas.')
  .option('--dir <path>', 'directory containing artifacts', '.')
  .action((opts: { dir: string }) => {
    const candidatesPath = resolve(opts.dir, 'discovery-candidates.json');
    const metaPath = resolve(opts.dir, 'discovery-candidates-meta.json');

    // Candidates as BYTES: `dataset_sha` is a byte digest, and the deploy
    // stager + runtime loader verify the exact bytes. Hashing decoded text
    // here made two byte-different files that decode alike hash alike, so
    // `verify` could call "Valid" an artifact the deploy then refuses
    // (round-9 closure of the decoded-text digest class).
    let candidatesBytes: Buffer;
    let metaText: string;
    try {
      candidatesBytes = readFileSync(candidatesPath);
      metaText = readFileSync(metaPath, 'utf8');
    } catch (err) {
      process.stderr.write(`Cannot read artifacts: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }

    const metaParsed = DiscoveryCandidatesMetaSchema.safeParse(JSON.parse(metaText));
    if (!metaParsed.success) {
      process.stderr.write(`Meta schema validation failed:\n${metaParsed.error.message}\n`);
      process.exit(1);
    }

    const candidatesParsed = DiscoveryCandidatesFileSchema.safeParse(
      JSON.parse(candidatesBytes.toString('utf8')),
    );
    if (!candidatesParsed.success) {
      process.stderr.write(
        `Candidates schema validation failed:\n${candidatesParsed.error.message}\n`,
      );
      process.exit(1);
    }

    const sha = createHash('sha256').update(candidatesBytes).digest('hex');
    if (sha !== metaParsed.data.dataset_sha) {
      process.stderr.write(
        `Integrity check failed: expected ${metaParsed.data.dataset_sha}, got ${sha}\n`,
      );
      process.exit(1);
    }

    if (candidatesParsed.data.candidates.length !== metaParsed.data.candidate_count) {
      process.stderr.write(
        `Count mismatch: meta says ${metaParsed.data.candidate_count}, file has ${candidatesParsed.data.candidates.length}\n`,
      );
      process.exit(1);
    }

    process.stdout.write(
      `✓ Valid: ${metaParsed.data.candidate_count} candidates, sha ${sha.slice(0, 12)}…\n`,
    );
  });

program.parse();
