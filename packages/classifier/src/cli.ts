#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AiAnnotationsSchema,
  buildClassificationManifest,
  ClassificationCandidatesSchema,
  ClassificationManifestSchema,
  serializeClassificationManifest,
} from '@starred/ai-schema';
import { createGithubClient } from '@starred/github-client';
import { Command } from 'commander';
import { verifyAgentPullRequestFromGit } from './agent-gate';
import { assembleAiArtifacts, verifyAiArtifacts } from './assemble';
import { assertAiClassificationEnabled, loadAiConfig } from './config';
import { loadCanonicalDataset } from './dataset';
import { reconcileRun } from './executor';
import { planClassification } from './planner';
import { verifyAiProvenanceFromGit } from './provenance';
import { OctokitReadmeSource } from './readme-source';
import { loadClassifierState, serializeClassifierState } from './state';
import { GitClassifierStateStore } from './state-store';
import {
  changedPathEntriesBetween,
  touchesAiArtifacts,
  verifyAgentDiffEntries,
} from './verify-diff';
import { CLASSIFIER_VERSION } from './index';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function fatal(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fatal (exit 10): ${message}\n`);
  process.exit(10);
}

const program = new Command();
program
  .name('stars-classify')
  .description(
    'Deterministic AI-enrichment contracts. Agents produce untrusted candidates; this CLI validates and assembles artifacts.',
  )
  .version(CLASSIFIER_VERSION)
  .option('-c, --config <path>', 'path to ai.yaml')
  .action((opts: { config?: string }) => {
    try {
      const config = loadAiConfig(opts.config);
      process.stdout.write(
        `classifier config OK — enabled=${config.ai.enabled} ` +
          `prompt=${config.ai.prompt_version} ` +
          `profile=${config.ai.execution_profile.execution_profile_version} ` +
          `budget(total)=${config.ai.budget.max_total_per_run}\n`,
      );
      process.stdout.write(
        'P3.1 plans bounded jobs from the canonical dataset; execution and publication land later.\n',
      );
    } catch (error) {
      fatal(error);
    }
  });

program
  .command('plan')
  .description(
    'Plan a deterministic, budget-limited manifest from the canonical dataset and ' +
      'trusted README discovery. Jobs come ONLY from verified canonical stars.',
  )
  .requiredOption('-o, --out <path>', 'temporary manifest output path')
  .option('--stars <path>', 'canonical stars.json', 'stars.json')
  .option('--meta <path>', 'dataset-meta.json', 'dataset-meta.json')
  .option('--current <path>', 'existing ai-annotations.json (to detect new vs changed)')
  .option(
    '--save-state',
    'persist next operational state to starledger-ai-state (trusted ai-state workflow only)',
    false,
  )
  .action(
    async (opts: {
      out: string;
      stars: string;
      meta: string;
      current?: string;
      saveState?: boolean;
    }) => {
      try {
        const config = loadAiConfig(program.opts<{ config?: string }>().config);
        const dataset = loadCanonicalDataset(
          readFileSync(opts.stars, 'utf8'),
          readFileSync(opts.meta, 'utf8'),
        );
        if (!config.ai.enabled) {
          const manifest = buildClassificationManifest({
            promptVersion: config.ai.prompt_version,
            executionProfileVersion: config.ai.execution_profile.execution_profile_version,
            executorKind: config.ai.executor_kind,
            datasetSha256: dataset.datasetSha256,
            jobs: [],
          });
          writeText(opts.out, serializeClassificationManifest(manifest));
          process.stdout.write(
            `AI classification disabled; wrote an empty manifest without README discovery: ${opts.out}\n`,
          );
          return;
        }
        const existingAnnotations =
          opts.current !== undefined && existsSync(opts.current)
            ? AiAnnotationsSchema.parse(readJson(opts.current)).annotations
            : [];

        const token = process.env.STAR_SYNC_TOKEN ?? process.env.GITHUB_TOKEN;
        if (token === undefined || token === '') {
          throw new Error(
            'a GitHub token (STAR_SYNC_TOKEN or GITHUB_TOKEN) is required for README discovery',
          );
        }
        const source = new OctokitReadmeSource(createGithubClient(token, 'starledger-classifier'));
        const store = new GitClassifierStateStore(process.cwd());
        const state = loadClassifierState(await store.load());

        const result = await planClassification({
          repos: dataset.repos,
          datasetSha256: dataset.datasetSha256,
          state,
          existingAnnotations,
          config: config.ai,
          source,
          now: new Date(),
        });

        writeText(opts.out, serializeClassificationManifest(result.manifest));
        process.stdout.write(
          `wrote manifest with ${result.manifest.jobs.length} job(s) ` +
            `(dataset ${dataset.datasetSha256.slice(0, 12)}…): ${opts.out}\n`,
        );

        if (opts.saveState === true) {
          const save = await store.save(
            serializeClassifierState(result.nextState),
            'chore: update classifier operational state',
          );
          process.stdout.write(
            `classifier state ${
              save.pushed ? 'pushed' : save.changed ? 'committed (push skipped)' : 'unchanged'
            }.\n`,
          );
        }
      } catch (error) {
        fatal(error);
      }
    },
  );

program
  .command('validate-candidates')
  .description('Validate untrusted agent candidates against a deterministic manifest')
  .requiredOption('--manifest <path>', 'classification manifest JSON')
  .requiredOption('--candidates <path>', 'candidate bundle JSON')
  .action((opts: { manifest: string; candidates: string }) => {
    try {
      const manifest = ClassificationManifestSchema.parse(readJson(opts.manifest));
      const candidates = ClassificationCandidatesSchema.parse(readJson(opts.candidates));
      const { applied, pendingRetry, rejected } = reconcileRun(manifest, candidates);
      if (rejected.length > 0) {
        throw new Error(
          `rejected ${rejected.length} candidate(s): ` +
            rejected.map((r) => `${r.node_id} (${r.reason})`).join('; '),
        );
      }
      process.stdout.write(
        `validated ${applied.length} candidate(s); ${pendingRetry.length} job(s) pending retry\n`,
      );
    } catch (error) {
      fatal(error);
    }
  });

program
  .command('apply')
  .description('Merge validated candidates into deterministic public AI artifacts')
  .requiredOption('--manifest <path>', 'classification manifest JSON')
  .requiredOption('--candidates <path>', 'candidate bundle JSON')
  .requiredOption('--generated-at <iso-date>', 'timestamp for changed annotation records')
  .requiredOption('--out-dir <path>', 'directory for ai-annotations artifacts')
  .option('--current <path>', 'existing ai-annotations.json')
  .action(
    (opts: {
      manifest: string;
      candidates: string;
      generatedAt: string;
      outDir: string;
      current?: string;
    }) => {
      try {
        const manifest = ClassificationManifestSchema.parse(readJson(opts.manifest));
        const candidates = ClassificationCandidatesSchema.parse(readJson(opts.candidates));
        const { applied, pendingRetry, rejected } = reconcileRun(manifest, candidates);
        if (rejected.length > 0) {
          // A bad/stale/smuggled candidate must never silently drop out of an apply.
          throw new Error(
            `rejected ${rejected.length} candidate(s) — refusing to apply: ` +
              rejected.map((r) => `${r.node_id} (${r.reason})`).join('; '),
          );
        }
        const currentAnnotations =
          opts.current !== undefined && existsSync(opts.current)
            ? AiAnnotationsSchema.parse(readJson(opts.current)).annotations
            : [];
        const result = assembleAiArtifacts({
          currentAnnotations,
          validatedCandidates: applied,
          datasetSha256: manifest.dataset_sha256,
          generatedAt: opts.generatedAt,
        });
        const pending = `${pendingRetry.length} job(s) pending retry`;
        if (!result.changed || result.metaBytes === null) {
          process.stdout.write(`AI artifacts unchanged; no files written. ${pending}.\n`);
        } else {
          writeText(join(opts.outDir, 'ai-annotations.json'), result.annotationsBytes);
          writeText(join(opts.outDir, 'ai-annotations-meta.json'), result.metaBytes);
          process.stdout.write(
            `wrote ${result.annotations.length} annotation(s) to ${opts.outDir}; ${pending}.\n`,
          );
        }
      } catch (error) {
        fatal(error);
      }
    },
  );

program
  .command('verify-artifacts')
  .description('Validate the public artifact schemas, count, taxonomy, and exact-byte hash')
  .requiredOption('--annotations <path>', 'ai-annotations.json')
  .requiredOption('--meta <path>', 'ai-annotations-meta.json')
  .action((opts: { annotations: string; meta: string }) => {
    try {
      verifyAiArtifacts(readFileSync(opts.annotations, 'utf8'), readFileSync(opts.meta, 'utf8'));
      process.stdout.write('AI artifacts verified.\n');
    } catch (error) {
      fatal(error);
    }
  });

program
  .command('verify-agent-diff')
  .description(
    'Reject an agent branch that changes a path outside the public AI artifact allowlist',
  )
  .option('--base <ref>', 'merge-base reference', 'origin/main')
  .option('--head <ref>', 'head reference', 'HEAD')
  .action((opts: { base: string; head: string }) => {
    try {
      const entries = changedPathEntriesBetween(opts.base, opts.head);
      verifyAgentDiffEntries(entries);
      process.stdout.write(`agent diff verified (${entries.length} allowed change(s)).\n`);
    } catch (error) {
      fatal(error);
    }
  });

program
  .command('verify-agent-pr')
  .description(
    'Path-triggered structural gate: inspect any PR, and whenever an AI artifact ' +
      'changes require an approved same-repository executor branch and a valid artifact pair',
  )
  .requiredOption('--base <ref>', 'trusted base reference (e.g. the PR base SHA)')
  .option('--head <ref>', 'git ref holding the PR head commit, fetched as data', 'HEAD')
  .requiredOption('--head-ref <branch>', 'PR head branch name (executor identity)')
  .requiredOption('--head-repo <owner/name>', 'PR head repository full name')
  .requiredOption('--repo <owner/name>', 'this (base) repository full name')
  .action(
    (opts: { base: string; head: string; headRef: string; headRepo: string; repo: string }) => {
      try {
        const result = verifyAgentPullRequestFromGit({
          baseRef: opts.base,
          headGitRef: opts.head,
          headBranch: opts.headRef,
          headRepo: opts.headRepo,
          repo: opts.repo,
        });
        process.stdout.write(
          result.touched
            ? 'AI artifact gate passed: approved same-repository executor pair verified.\n'
            : 'No AI artifacts changed; structural gate not required.\n',
        );
      } catch (error) {
        fatal(error);
      }
    },
  );

program
  .command('verify-ai-provenance')
  .description(
    'Provenance gate: recompute current jobs/fingerprints from the trusted base ' +
      'dataset and live README discovery, and reject stale or invented annotations',
  )
  .requiredOption('--base <ref>', 'trusted base reference (the PR base SHA)')
  .option('--head <ref>', 'git ref holding the PR head commit, fetched as data', 'HEAD')
  .action(async (opts: { base: string; head: string }) => {
    try {
      // Path-triggered, like the structural gate: a PR that changes no AI artifact
      // is a no-op (recomputing provenance for an absent artifact is meaningless).
      if (!touchesAiArtifacts(changedPathEntriesBetween(opts.base, opts.head))) {
        process.stdout.write('No AI artifacts changed; provenance gate not required.\n');
        return;
      }
      const config = loadAiConfig(program.opts<{ config?: string }>().config).ai;
      assertAiClassificationEnabled(config);
      const token = process.env.STAR_SYNC_TOKEN ?? process.env.GITHUB_TOKEN;
      if (token === undefined || token === '') {
        throw new Error(
          'a GitHub token (STAR_SYNC_TOKEN or GITHUB_TOKEN) is required for README discovery',
        );
      }
      const source = new OctokitReadmeSource(createGithubClient(token, 'starledger-provenance'));
      const result = await verifyAiProvenanceFromGit({
        baseRef: opts.base,
        headGitRef: opts.head,
        source,
        config,
        maxChangedPerRun: config.budget.max_total_per_run,
      });
      if (!result.ok) {
        throw new Error(
          'provenance gate failed:\n' +
            result.violations.map((v) => `  - ${v.node_id || '(meta)'}: ${v.reason}`).join('\n'),
        );
      }
      process.stdout.write(
        `provenance verified: ${result.changed.length} changed, ${result.pruned.length} pruned.\n`,
      );
    } catch (error) {
      fatal(error);
    }
  });

void program.parseAsync(process.argv);
