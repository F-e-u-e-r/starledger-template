import { sha256, type AnnotationSourceKind } from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';

/**
 * The canonical fields that actually drive classification, and therefore the
 * fingerprint. Popularity/recency fields (stargazer_count, fork_count, dates)
 * are intentionally excluded so a star or push delta never forces a needless
 * reclassification — only a change to what the agent actually reads matters.
 */
export interface ClassificationMetadata {
  name_with_owner: string;
  description: string | null;
  primary_language: string | null;
  topics: string[];
}

export function classificationMetadata(repo: CanonicalRepo): ClassificationMetadata {
  return {
    name_with_owner: repo.name_with_owner,
    description: repo.description,
    primary_language: repo.primary_language,
    topics: [...repo.topics].sort(),
  };
}

/**
 * SHA-256 over ONLY the classification-relevant canonical metadata, in a fixed
 * key and list order. Stable across runs; changes iff a field the agent sees
 * changes (FP-3). This is the `repo_metadata_sha256` recorded on the annotation.
 */
export function repoMetadataSha256(repo: CanonicalRepo): string {
  const meta = classificationMetadata(repo);
  return sha256(
    JSON.stringify({
      name_with_owner: meta.name_with_owner,
      description: meta.description,
      primary_language: meta.primary_language,
      topics: meta.topics,
    }),
  );
}

export interface SourceFingerprintInput {
  nodeId: string;
  sourceKind: AnnotationSourceKind;
  readmePath: string | null;
  readmeOid: string | null;
  repoMetadataSha256: string;
  taxonomyVersion: string;
  promptVersion: string;
  executionProfileVersion: string;
  executorKind: string;
}

/**
 * The composite per-repository source fingerprint that gates reclassification.
 * It folds in everything a classification legitimately depends on — the source
 * identity (README path+OID, or `metadata` when there is none), the
 * classification-relevant canonical metadata, and the versioned methodology
 * (taxonomy / prompt / execution profile / executor) — and DELIBERATELY excludes
 * the whole-dataset SHA.
 *
 * Excluding the dataset SHA is load-bearing: an unchanged README OID must let the
 * planner skip a repository (PLAN-2), and an unrelated star delta must not churn
 * this repository's published annotation (no-churn / PUB-3). The dataset SHA is
 * "represented" at the manifest/meta level instead (FP-5). The committed
 * `AnnotationSource` has no field for it, by design.
 */
export function sourceFingerprint(input: SourceFingerprintInput): string {
  return sha256(
    JSON.stringify({
      node_id: input.nodeId,
      source_kind: input.sourceKind,
      readme_path: input.readmePath,
      readme_oid: input.readmeOid,
      repo_metadata_sha256: input.repoMetadataSha256,
      taxonomy_version: input.taxonomyVersion,
      prompt_version: input.promptVersion,
      execution_profile_version: input.executionProfileVersion,
      executor_kind: input.executorKind,
    }),
  );
}
