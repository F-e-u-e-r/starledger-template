import {
  AiAnnotationsMetaSchema,
  AiAnnotationsSchema,
  TAXONOMY_VERSION,
  type Annotation,
  type AnnotationSourceKind,
} from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import { verifyAiArtifacts } from './assemble';
import { loadCanonicalDataset } from './dataset';
import { repoMetadataSha256, sourceFingerprint } from './fingerprint';
import type { PlannerConfig } from './planner';
import type { ReadmeRef, ReadmeSource } from './readme-source';
import { readArtifactAtRef, tryReadArtifactAtRef } from './verify-diff';

export interface ProvenanceViolation {
  /** Empty string for a meta/dataset-level violation. */
  node_id: string;
  reason: string;
}

export interface ProvenanceInput {
  /** Trusted canonical repositories at the protected base branch. */
  repos: readonly CanonicalRepo[];
  /** SHA-256 of the current canonical stars.json bytes (base branch). */
  datasetSha256: string;
  /** Annotations at the protected base (trusted prior state); empty if none. */
  baseAnnotations: readonly Annotation[];
  /** Annotations proposed by the PR head (untrusted candidate). */
  headAnnotations: readonly Annotation[];
  /** `dataset_sha256` recorded in the head ai-annotations-meta.json. */
  headMetaDatasetSha256: string;
  /** Live README discovery — the SAME seam the planner uses (path + OID only). */
  source: ReadmeSource;
  config: PlannerConfig;
  /** Max changed (added+modified) annotations allowed in one PR (per-run budget). */
  maxChangedPerRun: number;
}

export interface ProvenanceResult {
  ok: boolean;
  violations: ProvenanceViolation[];
  /** node_ids added or content-modified in head vs base. */
  changed: string[];
  /** node_ids present in base, absent in head. */
  pruned: string[];
}

interface ExpectedSource {
  sourceKind: AnnotationSourceKind;
  readmePath: string | null;
  readmeOid: string | null;
  repoMetadataSha256: string;
  fingerprint: string;
}

/** Canonical semantic content of an annotation EXCLUDING `generated_at`. */
function annotationContentPayload(annotation: Annotation): Record<string, unknown> {
  return {
    node_id: annotation.node_id,
    category: annotation.category,
    tags: [...annotation.tags],
    summary: annotation.summary,
    source: {
      kind: annotation.source.kind,
      readme_path: annotation.source.readme_path,
      readme_oid: annotation.source.readme_oid,
      repo_metadata_sha256: annotation.source.repo_metadata_sha256,
      fingerprint: annotation.source.fingerprint,
    },
    generation: {
      executor_kind: annotation.generation.executor_kind,
      execution_profile_version: annotation.generation.execution_profile_version,
      model_label: annotation.generation.model_label,
      prompt_version: annotation.generation.prompt_version,
    },
  };
}

/** Semantic identity of an annotation EXCLUDING `generated_at`. */
function annotationContentKey(annotation: Annotation): string {
  return JSON.stringify(annotationContentPayload(annotation));
}

/** Full committed identity, including the record timestamp. */
function annotationRecordKey(annotation: Annotation): string {
  return JSON.stringify({
    ...annotationContentPayload(annotation),
    generation: {
      executor_kind: annotation.generation.executor_kind,
      execution_profile_version: annotation.generation.execution_profile_version,
      model_label: annotation.generation.model_label,
      prompt_version: annotation.generation.prompt_version,
      generated_at: annotation.generation.generated_at,
    },
  });
}

/** Recompute the source a CURRENT trusted job would carry — from trusted canonical
 * metadata plus the live README ref — exactly as the planner does. */
function expectedSourceFor(
  repo: CanonicalRepo,
  ref: ReadmeRef | null,
  config: PlannerConfig,
): ExpectedSource {
  const sourceKind: AnnotationSourceKind = ref ? 'readme' : 'metadata';
  const repoMetaSha = repoMetadataSha256(repo);
  return {
    sourceKind,
    readmePath: ref?.path ?? null,
    readmeOid: ref?.oid ?? null,
    repoMetadataSha256: repoMetaSha,
    fingerprint: sourceFingerprint({
      nodeId: repo.node_id,
      sourceKind,
      readmePath: ref?.path ?? null,
      readmeOid: ref?.oid ?? null,
      repoMetadataSha256: repoMetaSha,
      taxonomyVersion: TAXONOMY_VERSION,
      promptVersion: config.prompt_version,
      executionProfileVersion: config.execution_profile.execution_profile_version,
      executorKind: config.executor_kind,
    }),
  };
}

/**
 * The PROVENANCE gate: verify that every annotation an AI-artifact PR changes
 * corresponds to a CURRENT trusted job, recomputed from the protected base
 * dataset and live README discovery — never from the agent's own manifest. A
 * stale fingerprint/OID/metadata, an invented node, a wrong dataset SHA, a wrong
 * executor/profile, an out-of-budget delta, or a prune of a still-present repo is
 * REJECTED even though the artifact schema is valid. The README discovery target
 * (owner/name) always comes from the trusted dataset, never from the untrusted
 * annotation, so a hostile PR cannot direct the gate to fetch arbitrary repos.
 */
export async function verifyAnnotationProvenance(
  input: ProvenanceInput,
): Promise<ProvenanceResult> {
  const violations: ProvenanceViolation[] = [];
  const reposByNode = new Map(input.repos.map((repo) => [repo.node_id, repo]));
  const baseByNode = new Map(input.baseAnnotations.map((a) => [a.node_id, a]));
  const headByNode = new Set(input.headAnnotations.map((a) => a.node_id));

  // PROV-5: the dataset snapshot the artifacts were computed against must be current.
  if (input.headMetaDatasetSha256 !== input.datasetSha256) {
    violations.push({
      node_id: '',
      reason:
        'ai-annotations-meta.json dataset_sha256 does not match the current canonical dataset',
    });
  }

  const changed = input.headAnnotations.filter((a) => {
    const previous = baseByNode.get(a.node_id);
    return previous === undefined || annotationRecordKey(previous) !== annotationRecordKey(a);
  });
  const pruned = input.baseAnnotations
    .map((a) => a.node_id)
    .filter((nodeId) => !headByNode.has(nodeId));

  // PROV-8: a single PR is one executor run and cannot exceed a run's budget.
  if (changed.length > input.maxChangedPerRun) {
    violations.push({
      node_id: '',
      reason: `changed annotation count ${changed.length} exceeds the per-run budget ${input.maxChangedPerRun}`,
    });
  }

  for (const annotation of changed) {
    const previous = baseByNode.get(annotation.node_id);
    if (
      previous !== undefined &&
      annotationContentKey(previous) === annotationContentKey(annotation)
    ) {
      violations.push({
        node_id: annotation.node_id,
        reason: 'generated_at may not change without a corresponding annotation content change',
      });
      continue;
    }
    const repo = reposByNode.get(annotation.node_id);
    if (repo === undefined) {
      // PROV-2 / PROV-6: a node not in canonical stars is invented (or removed).
      violations.push({
        node_id: annotation.node_id,
        reason: 'annotation for a repository not in the canonical dataset (invented or removed)',
      });
      continue;
    }
    const ref = await input.source.getReadmeRef({ owner: repo.owner, name: repo.name });
    const expected = expectedSourceFor(repo, ref, input.config);
    const add = (reason: string): void => {
      violations.push({ node_id: annotation.node_id, reason });
    };

    if (annotation.source.repo_metadata_sha256 !== expected.repoMetadataSha256)
      add('stale canonical metadata fingerprint'); // PROV-4
    if (annotation.source.readme_oid !== expected.readmeOid) add('stale README OID'); // PROV-3
    if (annotation.source.readme_path !== expected.readmePath) add('stale README path');
    if (annotation.source.kind !== expected.sourceKind)
      add('source kind does not match current discovery');
    if (annotation.source.fingerprint !== expected.fingerprint)
      add('source fingerprint does not match the current job (stale or invented)'); // PROV-1/2
    if (annotation.generation.executor_kind !== input.config.executor_kind)
      add('executor_kind does not match the configured executor'); // PROV-7
    if (
      annotation.generation.execution_profile_version !==
      input.config.execution_profile.execution_profile_version
    )
      add('execution_profile_version does not match configuration'); // PROV-7
    if (annotation.generation.prompt_version !== input.config.prompt_version)
      add('prompt_version does not match configuration');
  }

  // PROV-6: a prune is legitimate ONLY when the repository left the dataset.
  for (const nodeId of pruned) {
    if (reposByNode.has(nodeId)) {
      violations.push({
        node_id: nodeId,
        reason: 'annotation removed for a repository still in the canonical dataset',
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    changed: changed.map((a) => a.node_id),
    pruned,
  };
}

export interface ProvenanceGitContext {
  /** Trusted base reference (the PR base SHA) — canonical dataset + prior annotations. */
  baseRef: string;
  /** Git ref holding the PR head commit, fetched as data (never checked out). */
  headGitRef: string;
  source: ReadmeSource;
  config: PlannerConfig;
  maxChangedPerRun: number;
  cwd?: string;
}

function readAnnotationsAtRef(ref: string, cwd: string): Annotation[] {
  const text = tryReadArtifactAtRef(ref, 'ai-annotations.json', cwd);
  if (text === null) return []; // no AI artifacts at this ref yet (first AI PR)
  return AiAnnotationsSchema.parse(JSON.parse(text)).annotations;
}

/**
 * Git-backed wrapper: read the trusted canonical dataset + prior annotations at
 * the base, and the candidate artifacts at the head ref (as data), then run the
 * provenance gate. It also re-checks artifact integrity (schema + exact meta
 * hash), so it stands alone as a required check.
 */
export async function verifyAiProvenanceFromGit(
  ctx: ProvenanceGitContext,
): Promise<ProvenanceResult> {
  const cwd = ctx.cwd ?? process.cwd();
  const dataset = loadCanonicalDataset(
    readArtifactAtRef(ctx.baseRef, 'stars.json', cwd),
    readArtifactAtRef(ctx.baseRef, 'dataset-meta.json', cwd),
  );
  const headAnnotationsText = readArtifactAtRef(ctx.headGitRef, 'ai-annotations.json', cwd);
  const headMetaText = readArtifactAtRef(ctx.headGitRef, 'ai-annotations-meta.json', cwd);
  verifyAiArtifacts(headAnnotationsText, headMetaText); // PUB-2/PUB-5: schema + exact hash
  const baseAnnotationsText = tryReadArtifactAtRef(ctx.baseRef, 'ai-annotations.json', cwd);
  if (baseAnnotationsText !== null && baseAnnotationsText === headAnnotationsText) {
    return {
      ok: false,
      violations: [
        {
          node_id: '',
          reason: 'AI artifact PR may not update metadata without changing ai-annotations.json',
        },
      ],
      changed: [],
      pruned: [],
    };
  }
  const headAnnotations = AiAnnotationsSchema.parse(JSON.parse(headAnnotationsText)).annotations;
  const headMeta = AiAnnotationsMetaSchema.parse(JSON.parse(headMetaText));

  return verifyAnnotationProvenance({
    repos: dataset.repos,
    datasetSha256: dataset.datasetSha256,
    baseAnnotations: readAnnotationsAtRef(ctx.baseRef, cwd),
    headAnnotations,
    headMetaDatasetSha256: headMeta.dataset_sha256,
    source: ctx.source,
    config: ctx.config,
    maxChangedPerRun: ctx.maxChangedPerRun,
  });
}
