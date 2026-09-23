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
import { fatal } from './fatal';
import { planClassification } from './planner';
import { runPruneOrphans } from './prune-orphans';
import { verifyAiProvenanceFromGit } from './provenance';
import { OctokitReadmeSource } from './readme-source';
import { runMetaRebaseCommand } from './meta-rebase-cli';
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

export function buildProgram(): Command {
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
            readFileSync(opts.stars),
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
          const source = new OctokitReadmeSource(
            createGithubClient(token, 'starledger-classifier'),
          );
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
          if (result.omittedUnfetchable.length > 0) {
            // An empty/short manifest caused by unfetchable READMEs must be
            // distinguishable from a DRAINED backlog: the runbook tells the
            // operator to disable the routine on persistent empty manifests,
            // which would be the wrong call here.
            process.stdout.write(
              `omitted ${result.omittedUnfetchable.length} probe-ok job(s) whose README bytes ` +
                `were not fetchable this run (will re-plan next run): ` +
                `${result.omittedUnfetchable.join(', ')}\n`,
            );
          }

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
            if (save.pushError) {
              // Already redacted by the store; surface it so a skipped push is diagnosable (B4).
              process.stderr.write(`  ✗ state push failed: ${save.pushError}\n`);
            }
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
    .option('--stars <path>', 'canonical stars.json', 'stars.json')
    .option('--meta <path>', 'dataset-meta.json', 'dataset-meta.json')
    .action(
      (opts: {
        manifest: string;
        candidates: string;
        generatedAt: string;
        outDir: string;
        current?: string;
        stars: string;
        meta: string;
      }) => {
        try {
          const manifest = ClassificationManifestSchema.parse(readJson(opts.manifest));
          const dataset = loadCanonicalDataset(
            readFileSync(opts.stars),
            readFileSync(opts.meta, 'utf8'),
          );
          if (dataset.datasetSha256 !== manifest.dataset_sha256) {
            // Never run a (potentially pruning) apply with a manifest computed
            // against a different canonical snapshot.
            throw new Error(
              `manifest dataset_sha256 (${manifest.dataset_sha256.slice(0, 12)}…) does not ` +
                `match the verified canonical dataset ` +
                `(${dataset.datasetSha256.slice(0, 12)}…) — refusing to apply`,
            );
          }
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
            canonicalNodeIds: new Set(dataset.repos.map((repo) => repo.node_id)),
            datasetSha256: manifest.dataset_sha256,
            generatedAt: opts.generatedAt,
          });
          const pruned =
            result.prunedNodeIds.length > 0
              ? `; pruned ${result.prunedNodeIds.length} orphan(s): ` +
                result.prunedNodeIds.join(', ')
              : '';
          const pending = `${pendingRetry.length} job(s) pending retry`;
          if (!result.changed || result.metaBytes === null) {
            process.stdout.write(`AI artifacts unchanged; no files written. ${pending}.\n`);
          } else {
            writeText(join(opts.outDir, 'ai-annotations.json'), result.annotationsBytes);
            writeText(join(opts.outDir, 'ai-annotations-meta.json'), result.metaBytes);
            process.stdout.write(
              `wrote ${result.annotations.length} annotation(s) to ${opts.outDir}` +
                `${pruned}; ${pending}.\n`,
            );
          }
        } catch (error) {
          fatal(error);
        }
      },
    );

  program
    .command('prune-orphans')
    .description(
      'Deterministically remove annotations whose repository left the canonical dataset ' +
        '(Merge rules: a removed star prunes its annotation). Zero-candidate maintenance ' +
        'path for an extra-only set mismatch; performs no classification.',
    )
    .option('--stars <path>', 'canonical stars.json', 'stars.json')
    .option('--meta <path>', 'dataset-meta.json', 'dataset-meta.json')
    .requiredOption('--current <path>', 'existing ai-annotations.json')
    .requiredOption('--generated-at <iso-date>', 'timestamp for the rebuilt meta')
    .requiredOption('--out-dir <path>', 'directory for ai-annotations artifacts')
    .action(
      (opts: {
        stars: string;
        meta: string;
        current: string;
        generatedAt: string;
        outDir: string;
      }) => {
        try {
          const receipt = runPruneOrphans({
            starsPath: opts.stars,
            datasetMetaPath: opts.meta,
            currentPath: opts.current,
            generatedAt: opts.generatedAt,
            outDir: opts.outDir,
          });
          process.stdout.write(
            `canonical repositories: ${receipt.canonicalCount} ` +
              `(dataset ${receipt.datasetSha256.slice(0, 12)}…)\n` +
              `annotations before: ${receipt.beforeCount}\n` +
              `pruned: ${receipt.prunedNodeIds.length}` +
              (receipt.prunedNodeIds.length > 0 ? ` (${receipt.prunedNodeIds.join(', ')})` : '') +
              `\nannotations after: ${receipt.afterCount}\n`,
          );
          process.stdout.write(
            receipt.changed
              ? `wrote pruned artifact pair to ${opts.outDir}\n`
              : 'no orphan annotations; artifacts unchanged, no files written.\n',
          );
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
        // Annotations as BYTES (the digest is a byte contract); meta as text
        // (its check is canonical-form equality) — see verifyAiArtifacts.
        verifyAiArtifacts(readFileSync(opts.annotations), readFileSync(opts.meta, 'utf8'));
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

  program
    .command('meta-rebase')
    .description(
      'MANUAL, model-free re-stamp of an in-flight AI PR meta onto the current base ' +
        '(ROAD-A). Re-verifies the head against the current base and changes only ' +
        'dataset_sha256. NOT run by any workflow/CI; the live verify-ai-provenance gate ' +
        'stays the authority. See docs/adr/ADR-002-meta-rebase.md.',
    )
    .requiredOption('--stars <path>', 'CURRENT BASE stars.json (post-sync main, NOT the head PR)')
    .requiredOption('--meta <path>', 'CURRENT BASE dataset-meta.json (post-sync main)')
    .requiredOption('--head-annotations <path>', 'in-flight HEAD PR ai-annotations.json')
    .requiredOption('--head-meta <path>', 'in-flight HEAD PR ai-annotations-meta.json')
    .option('--base-annotations <path>', 'CURRENT BASE ai-annotations.json (prior trusted state)')
    .option('--cold-start', 'the current base has no annotations yet (first AI PR)', false)
    .option('--out-dir <path>', 'directory to write the re-stamped pair (omit for report-only)')
    .option('--dry-run', 'verify + report only; write nothing', false)
    .action(
      async (opts: {
        stars: string;
        meta: string;
        headAnnotations: string;
        headMeta: string;
        baseAnnotations?: string;
        coldStart?: boolean;
        outDir?: string;
        dryRun?: boolean;
      }) => {
        try {
          const config = loadAiConfig(program.opts<{ config?: string }>().config);
          assertAiClassificationEnabled(config.ai);
          const token = process.env.STAR_SYNC_TOKEN ?? process.env.GITHUB_TOKEN;
          if (token === undefined || token === '') {
            throw new Error(
              'a GitHub token (STAR_SYNC_TOKEN or GITHUB_TOKEN) is required for README discovery',
            );
          }
          const source = new OctokitReadmeSource(
            createGithubClient(token, 'starledger-classifier'),
          );
          const result = await runMetaRebaseCommand({
            starsPath: opts.stars,
            datasetMetaPath: opts.meta,
            baseAnnotationsPath: opts.baseAnnotations,
            coldStart: opts.coldStart === true,
            headAnnotationsPath: opts.headAnnotations,
            headMetaPath: opts.headMeta,
            outDir: opts.outDir,
            dryRun: opts.dryRun === true,
            source,
            config: config.ai,
            maxChangedPerRun: config.ai.budget.max_total_per_run,
          });
          if (!result.ok) {
            throw new Error(
              'meta-rebase refused (annotations are not valid against the current base):\n' +
                result.violations
                  .map((v) => `  - ${v.node_id || '(meta)'}: ${v.reason}`)
                  .join('\n'),
            );
          }
          process.stdout.write(
            result.wrote
              ? `meta-rebase OK: re-stamped pair written → ${result.annotationsPath}, ${result.metaPath}\n`
              : 'meta-rebase OK (report-only): head is valid against the current base; nothing written.\n',
          );
        } catch (error) {
          fatal(error);
        }
      },
    );

  return program;
}
