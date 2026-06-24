import {
  buildClassificationJob,
  buildClassificationManifest,
  DEFAULT_CLASSIFICATION_CONSTRAINTS,
  TAXONOMY_VERSION,
  type Annotation,
  type AnnotationSourceKind,
  type ClassificationInput,
  type ClassificationJob,
  type ClassificationManifest,
  type ClassificationReadmeInput,
} from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import type { AiConfig } from './config';
import { repoMetadataSha256, sourceFingerprint } from './fingerprint';
import { clampMetadataText, preprocessReadme } from './preprocess';
import type { ReadmeRef, ReadmeSource } from './readme-source';
import {
  CLASSIFIER_STATE_SCHEMA_VERSION,
  ClassifierStateSchema,
  indexState,
  type ClassifierRepoState,
  type ClassifierState,
} from './state';

/** The planner reads only the `ai` block of the loaded config. */
export type PlannerConfig = AiConfig['ai'];

export type WorkBucket = 'new' | 'retry' | 'refresh';
export type SkipReason = 'skip-current' | 'skip-retry-pending' | 'skip-terminal';
export type PlanBucket = WorkBucket | SkipReason;

export interface PlanDecision {
  node_id: string;
  bucket: PlanBucket;
  /** True iff the job entered the budget-limited manifest. Always false for skips. */
  selected: boolean;
  fingerprint: string;
  source_kind: AnnotationSourceKind;
}

export interface PlanInput {
  /** Verified canonical repositories (the ONLY source of jobs). */
  repos: readonly CanonicalRepo[];
  /** SHA-256 of the exact stars.json bytes the repos came from. */
  datasetSha256: string;
  /** Current classifier operational state (validated). */
  state: ClassifierState;
  /** Currently published annotations, to detect new vs changed-fingerprint repos. */
  existingAnnotations: readonly Annotation[];
  config: PlannerConfig;
  source: ReadmeSource;
  /** Wall clock used only for retry-backoff comparisons. */
  now: Date;
}

export interface PlanResult {
  manifest: ClassificationManifest;
  nextState: ClassifierState;
  decisions: PlanDecision[];
}

interface PlannedRepository {
  repo: CanonicalRepo;
  repoMetadataSha256: string;
  ref: ReadmeRef | null;
  entry: ClassifierRepoState;
  decision: PlanDecision;
}

function compareNodeId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byNodeId<T extends { node_id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareNodeId(a.node_id, b.node_id));
}

function byPlannedNodeId(items: readonly PlannedRepository[]): PlannedRepository[] {
  return [...items].sort((a, b) => compareNodeId(a.repo.node_id, b.repo.node_id));
}

function takeMetadataText(value: string | null, remaining: number): string | null {
  if (value === null || remaining <= 0) return null;
  return clampMetadataText(value, remaining);
}

function buildInput(
  repo: CanonicalRepo,
  repoMetaSha: string,
  readme: ClassificationReadmeInput | null,
  metadataMaxChars: number,
): ClassificationInput {
  // Bound the complete metadata payload, not only the description. Canonical
  // GitHub strings are normally small, but the planner's hard input budget must
  // hold even for malformed or unexpectedly large upstream values.
  let remaining = metadataMaxChars;
  const nameWithOwner = takeMetadataText(repo.name_with_owner, remaining);
  if (nameWithOwner === null) throw new Error('metadata budget cannot omit name_with_owner');
  remaining -= nameWithOwner.length;

  const description = takeMetadataText(repo.description, remaining);
  remaining -= description?.length ?? 0;
  const primaryLanguage = takeMetadataText(repo.primary_language, remaining);
  remaining -= primaryLanguage?.length ?? 0;

  const topics: string[] = [];
  for (const rawTopic of [...new Set(repo.topics)].sort()) {
    if (topics.length === 100) break;
    const topic = takeMetadataText(rawTopic, remaining);
    if (topic === null || topic.length === 0) break;
    if (topics.includes(topic)) continue;
    topics.push(topic);
    remaining -= topic.length;
  }

  return {
    name_with_owner: nameWithOwner,
    description,
    primary_language: primaryLanguage,
    topics,
    repo_metadata_sha256: repoMetaSha,
    readme,
  };
}

/** Carry a repo's prior tracking forward, refreshing only the observed README cache. */
function nextEntry(
  prior: ClassifierRepoState | undefined,
  nodeId: string,
  readmePath: string | null,
  readmeOid: string | null,
): ClassifierRepoState {
  return {
    node_id: nodeId,
    readme_path: readmePath,
    readme_oid: readmeOid,
    last_fingerprint: prior?.last_fingerprint ?? null,
    attempts: prior?.attempts ?? 0,
    last_error_code: prior?.last_error_code ?? null,
    next_retry_at: prior?.next_retry_at ?? null,
    terminal_unavailable: prior?.terminal_unavailable ?? false,
  };
}

/** Drop all-default entries so the cache only stores repos that carry information. */
function isMeaningful(entry: ClassifierRepoState): boolean {
  return (
    entry.terminal_unavailable ||
    entry.attempts > 0 ||
    entry.readme_path !== null ||
    entry.last_fingerprint !== null ||
    entry.last_error_code !== null ||
    entry.next_retry_at !== null
  );
}

/**
 * Deterministic, bounded planner. It iterates ONLY the verified canonical
 * repositories — an agent has no channel to add, remove, or alter a job
 * (PLAN-5) — computes each repo's source fingerprint, and assigns a bucket by a
 * fixed precedence:
 *
 *   terminal-unavailable      -> skip
 *   retry not yet due         -> skip (backoff, PLAN-4)
 *   previously-failed & due   -> RETRY
 *   no annotation             -> NEW
 *   annotation fingerprint ≠  -> REFRESH (changed source, incl. metadata→README)
 *   annotation fingerprint =  -> skip (PLAN-2)
 *
 * Each bucket is sorted by node_id and truncated to its ceiling, then the
 * concatenation (priority order new > retry > refresh) is truncated to
 * `max_total_per_run` (PLAN-3). README content is fetched ONLY for repos that
 * will produce a job, so an unchanged OID never downloads content (README-2).
 * Repositories absent from the dataset are never planned and are pruned from the
 * next state (PLAN-6).
 */
export async function planClassification(input: PlanInput): Promise<PlanResult> {
  const { repos, datasetSha256, state, existingAnnotations, config, source, now } = input;
  const priorByNode = indexState(state);
  const annByNode = new Map(
    existingAnnotations.map((annotation) => [annotation.node_id, annotation]),
  );
  const nowMs = now.getTime();

  const promptVersion = config.prompt_version;
  const profileVersion = config.execution_profile.execution_profile_version;
  const executorKind = config.executor_kind;

  const newPlans: PlannedRepository[] = [];
  const retryPlans: PlannedRepository[] = [];
  const refreshPlans: PlannedRepository[] = [];
  const decisions: PlanDecision[] = [];
  const nextEntries: ClassifierRepoState[] = [];

  for (const repo of byNodeId(repos)) {
    const coords = { owner: repo.owner, name: repo.name };
    const repoMetaSha = repoMetadataSha256(repo);
    const prior = priorByNode.get(repo.node_id);
    const annotation = annByNode.get(repo.node_id);
    // Reuse the README path a prior run recorded so the production source can
    // resolve the current OID WITHOUT downloading content. The annotation is the
    // strongest hint; the operational-state cache is the fallback.
    const knownPath = annotation?.source.readme_path ?? prior?.readme_path ?? null;
    const ref = await source.getReadmeRef(coords, knownPath);

    const fingerprintFor = (
      kind: AnnotationSourceKind,
      readmePath: string | null,
      readmeOid: string | null,
    ): string =>
      sourceFingerprint({
        nodeId: repo.node_id,
        sourceKind: kind,
        readmePath,
        readmeOid,
        repoMetadataSha256: repoMetaSha,
        taxonomyVersion: TAXONOMY_VERSION,
        promptVersion,
        executionProfileVersion: profileVersion,
        executorKind,
      });

    const probedKind: AnnotationSourceKind = ref ? 'readme' : 'metadata';
    const probedFingerprint = fingerprintFor(probedKind, ref?.path ?? null, ref?.oid ?? null);
    const entry = nextEntry(prior, repo.node_id, ref?.path ?? null, ref?.oid ?? null);

    const record = (
      bucket: PlanBucket,
      fingerprint: string,
      kind: AnnotationSourceKind,
    ): PlanDecision => {
      const decision: PlanDecision = {
        node_id: repo.node_id,
        bucket,
        selected: false,
        fingerprint,
        source_kind: kind,
      };
      decisions.push(decision);
      nextEntries.push(entry);
      return decision;
    };

    // --- deterministic bucket precedence ---
    if (prior?.terminal_unavailable === true) {
      record('skip-terminal', probedFingerprint, probedKind);
      continue;
    }
    const hasRetry = prior !== undefined && prior.attempts > 0;
    const retryDue =
      hasRetry && (prior.next_retry_at === null || Date.parse(prior.next_retry_at) <= nowMs);
    if (hasRetry && !retryDue) {
      record('skip-retry-pending', probedFingerprint, probedKind);
      continue;
    }

    let bucket: WorkBucket;
    if (retryDue) bucket = 'retry';
    else if (annotation === undefined) bucket = 'new';
    else if (annotation.source.fingerprint !== probedFingerprint) bucket = 'refresh';
    else {
      record('skip-current', probedFingerprint, probedKind);
      continue;
    }

    const plan: PlannedRepository = {
      repo,
      repoMetadataSha256: repoMetaSha,
      ref,
      entry,
      decision: record(bucket, probedFingerprint, probedKind),
    };
    (bucket === 'new' ? newPlans : bucket === 'retry' ? retryPlans : refreshPlans).push(plan);
  }

  // Per-bucket ceilings, then a global ceiling in priority order (new > retry > refresh).
  // README content is fetched only AFTER this selection, so input/network work is
  // bounded by the same hard run budget as classification calls.
  const selectedNew = byPlannedNodeId(newPlans).slice(0, config.budget.max_new_per_run);
  const selectedRetry = byPlannedNodeId(retryPlans).slice(0, config.budget.max_retry_per_run);
  const selectedRefresh = byPlannedNodeId(refreshPlans).slice(0, config.budget.max_refresh_per_run);
  const selected = [...selectedNew, ...selectedRetry, ...selectedRefresh].slice(
    0,
    config.budget.max_total_per_run,
  );

  const jobs: ClassificationJob[] = [];
  for (const plan of selected) {
    plan.decision.selected = true;
    const coords = { owner: plan.repo.owner, name: plan.repo.name };
    const fingerprintFor = (
      kind: AnnotationSourceKind,
      readmePath: string | null,
      readmeOid: string | null,
    ): string =>
      sourceFingerprint({
        nodeId: plan.repo.node_id,
        sourceKind: kind,
        readmePath,
        readmeOid,
        repoMetadataSha256: plan.repoMetadataSha256,
        taxonomyVersion: TAXONOMY_VERSION,
        promptVersion,
        executionProfileVersion: profileVersion,
        executorKind,
      });

    let readmeInput: ClassificationReadmeInput | null = null;
    if (plan.ref !== null) {
      const raw = await source.getReadmeContent(coords, plan.ref.path);
      if (raw === null) {
        // README disappeared between probe and fetch → classify from metadata.
        plan.entry.readme_path = null;
        plan.entry.readme_oid = null;
        plan.decision.source_kind = 'metadata';
        plan.decision.fingerprint = fingerprintFor('metadata', null, null);
      } else {
        readmeInput = {
          path: plan.ref.path,
          oid: plan.ref.oid,
          content: preprocessReadme(raw, { maxChars: config.readme_max_chars }),
        };
      }
    }

    jobs.push(
      buildClassificationJob({
        node_id: plan.repo.node_id,
        source_fingerprint: plan.decision.fingerprint,
        prompt_version: promptVersion,
        execution_profile_version: profileVersion,
        executor_kind: executorKind,
        input: buildInput(
          plan.repo,
          plan.repoMetadataSha256,
          readmeInput,
          config.metadata_max_chars,
        ),
        constraints: DEFAULT_CLASSIFICATION_CONSTRAINTS,
      }),
    );
  }

  const manifest = buildClassificationManifest({
    promptVersion,
    executionProfileVersion: profileVersion,
    executorKind,
    datasetSha256,
    jobs,
  });

  const nextState = ClassifierStateSchema.parse({
    schema_version: CLASSIFIER_STATE_SCHEMA_VERSION,
    repos: byNodeId(nextEntries.filter(isMeaningful)),
  });

  return { manifest, nextState, decisions };
}
