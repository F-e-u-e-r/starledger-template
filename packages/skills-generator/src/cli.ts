#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { generateSkillsClassification } from './generate';
import { readOptional } from './read-optional';

/**
 * `stars-skills-classify` — the M2.2 build-time generator CLI (P7 §4/§5/§4.9).
 * Mirrors the `stars-discover` conventions: root-relative defaults, --dry-run,
 * explicit modes. Build-time is FAIL-CLOSED; every issue prints, exit 1.
 *
 * Prior-input semantics (owner gate 4): `--regenerate-without-prior` is an
 * EXPLICIT mode (meta records `prior_classification_sha256: null`). Without
 * it, an absent prior file is a legitimate first generation; a prior that
 * exists but cannot be READ is fatal; a prior that reads but fails the
 * current schema fails inside the generator with the named §4.6 escape.
 * A load failure is never silently swallowed into a no-prior run.
 */

interface CliOptions {
  source: string;
  aliases: string;
  prior: string;
  stars: string;
  outDir: string;
  regenerateWithoutPrior?: boolean;
  dryRun?: boolean;
}

const program = new Command();

program
  .name('stars-skills-classify')
  .description('Generate the skills-classification artifacts from the vendored source (P7 M2.2).')
  .option('--source <path>', 'path to skills-classified.md', 'skills-classified.md')
  .option(
    '--aliases <path>',
    'path to skills-aliases.json (absent = empty map)',
    'skills-aliases.json',
  )
  .option(
    '--prior <path>',
    'path to the prior skills-classification.json',
    'skills-classification.json',
  )
  .option('--stars <path>', 'path to stars.json (the generation snapshot)', 'stars.json')
  .option('--out-dir <path>', 'output directory for artifacts', '.')
  .option(
    '--regenerate-without-prior',
    'EXPLICIT mode: consume no prior artifact (meta records prior_classification_sha256: null) — the §4.6 escape',
  )
  .option('--dry-run', 'parse, resolve, and validate without writing artifacts')
  .action((opts: CliOptions) => {
    let sourceText: string;
    let starsText: string;
    try {
      sourceText = readFileSync(opts.source, 'utf8');
    } catch (error) {
      console.error(`source ${opts.source}: ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }
    try {
      starsText = readFileSync(opts.stars, 'utf8');
    } catch (error) {
      console.error(`stars ${opts.stars}: ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }

    let aliasesText: string | null;
    let priorText: string | null;
    try {
      aliasesText = readOptional(opts.aliases, `aliases ${opts.aliases}`);
      priorText = opts.regenerateWithoutPrior
        ? null
        : readOptional(opts.prior, `prior ${opts.prior}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }

    const result = generateSkillsClassification({
      sourceText,
      aliasesText,
      priorText,
      starsText,
      generatedAt: new Date().toISOString(),
    });

    for (const diagnostic of result.diagnostics) {
      console.error(`diagnostic: ${diagnostic}`);
    }
    if (!result.ok) {
      for (const issue of result.issues) console.error(`error: ${issue}`);
      console.error(`generation FAILED with ${result.issues.length} issue(s) — nothing written`);
      process.exitCode = 1;
      return;
    }

    const artifactPath = resolve(opts.outDir, 'skills-classification.json');
    const metaPath = resolve(opts.outDir, 'skills-classification-meta.json');
    if (opts.dryRun) {
      console.log(`dry-run: would write ${artifactPath} and ${metaPath}`);
    } else {
      writeFileSync(artifactPath, result.artifactBytes);
      writeFileSync(metaPath, result.metaBytes);
      console.log(`wrote ${artifactPath}`);
      console.log(`wrote ${metaPath}`);
    }
    const { matched, unclassified, unresolved } = result.coverage;
    console.log(
      `coverage: ${matched} matched · ${unclassified} unclassified · ${unresolved} unresolved source entries`,
    );
    console.log(
      `prior lineage: ${result.meta.prior_classification_sha256 === null ? 'none consumed (null)' : result.meta.prior_classification_sha256}`,
    );
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
