import {
  type AiAnnotationsMeta,
  AiAnnotationsMetaSchema,
  type Annotation,
  AiAnnotationsSchema,
  serializeAiAnnotationsMeta,
} from '@starred/ai-schema';
import type { CanonicalRepo } from '@starred/schema';
import { verifyAiArtifacts } from './assemble';
import type { PlannerConfig } from './planner';
import type { ReadmeSource } from './readme-source';
import { type ProvenanceViolation, verifyAnnotationProvenance } from './provenance';

export interface MetaRebaseInput {
  /** Trusted canonical repositories at the CURRENT base branch. */
  repos: readonly CanonicalRepo[];
  /** SHA-256 of the CURRENT canonical stars.json bytes — the base to re-stamp onto. */
  datasetSha256: string;
  /** Annotations at the current base (trusted prior state); empty if none. */
  baseAnnotations: readonly Annotation[];
  /** EXACT ai-annotations.json BYTES proposed by the in-flight head PR — the
   * digest is a byte contract, so the hash is computed over these exact bytes,
   * never a decoding (round 9). */
  headAnnotationsBytes: Uint8Array;
  /** ai-annotations-meta.json TEXT of the in-flight head PR (only
   * `dataset_sha256` will change). Text deliberately: the meta half carries no
   * self-digest — its acceptance check is canonical-form equality. */
  headMetaBytes: string;
  /** Live README discovery — the SAME seam the planner / provenance gate uses. */
  source: ReadmeSource;
  config: PlannerConfig;
  /** Per-run budget: max added+modified annotations allowed in one PR. */
  maxChangedPerRun: number;
}

export interface MetaRebaseResult {
  ok: boolean;
  violations: ProvenanceViolation[];
  /** Present only when ok: the byte-identical ai-annotations.json bytes
   * (a passthrough of the head input — never re-serialized). */
  annotationsBytes?: Uint8Array;
  /** Present only when ok: the re-stamped ai-annotations-meta.json text
   * (freshly canonicalized; the caller writes it verbatim as UTF-8). */
  metaBytes?: string;
}

function reject(reason: string): MetaRebaseResult {
  return { ok: false, violations: [{ node_id: '', reason }] };
}

/**
 * Meta-rebase (ROAD-A), model-free. Re-stamp an in-flight AI PR's
 * `ai-annotations-meta.json.dataset_sha256` onto the CURRENT base so the daily
 * sync tick stops invalidating it, WITHOUT calling a model.
 *
 * It (1) re-validates the head artifact PAIR with the SAME integrity check the
 * assembler and live gate use — schema, canonical serialization of BOTH files,
 * exact annotations hash, count, and taxonomy — so a tampered or non-canonical
 * head meta is rejected rather than silently "repaired"; (2) re-runs the
 * per-annotation provenance checks (README OID/path, canonical metadata, source
 * fingerprint, executor/profile/prompt, per-run budget, prune) against the
 * CURRENT base; and (3) emits a meta identical to the head EXCEPT
 * `dataset_sha256`, which moves to the current base. Every other field
 * (`schema_version`, `annotations_sha256`, `annotation_count`, `taxonomy_version`,
 * `generated_at`) is preserved from the validated head meta — no timestamp churn.
 *
 * On PROV-5: this does NOT re-check PROV-5 — it FORCES `headMetaDatasetSha256 :=
 * datasetSha256`, i.e. it asks "would the head pass every OTHER check if the meta
 * pointed at the current base?" and, if so, makes that true by stamping. The
 * PROV-5 invariant (verified base == pointed-to base) is thereby ESTABLISHED, and
 * the live `verify-ai-provenance` gate re-runs the REAL PROV-5 at merge time as
 * the final authority. See docs/adr/ADR-002-meta-rebase.md.
 *
 * SECURITY: NOT wired into any workflow, required check, ruleset bypass, or
 * auto-merge — a manual/executor helper only. The caller MUST supply the TRUSTED
 * current base (repos, datasetSha256, baseAnnotations, source) loaded from the
 * protected branch, exactly as the provenance gate does.
 */
export async function rebaseAiAnnotationsMeta(input: MetaRebaseInput): Promise<MetaRebaseResult> {
  // 1. Validate the head PAIR (schema, canonical form of both files, exact hash,
  //    count, taxonomy) — the same check the assembler/live gate use. This
  //    rejects any tampered or non-canonical head meta up front, so the re-stamp
  //    below can only ever change `dataset_sha256`, never silently repair a field.
  let annotations: Annotation[];
  let headMeta: AiAnnotationsMeta;
  try {
    verifyAiArtifacts(input.headAnnotationsBytes, input.headMetaBytes);
    annotations = AiAnnotationsSchema.parse(
      JSON.parse(Buffer.from(input.headAnnotationsBytes).toString('utf8')),
    ).annotations;
    headMeta = AiAnnotationsMetaSchema.parse(JSON.parse(input.headMetaBytes));
  } catch (err) {
    return reject(
      `head AI artifact pair is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Re-verify the per-annotation provenance against the CURRENT base, with the
  //    meta pointer forced to current (see the PROV-5 note above).
  const provenance = await verifyAnnotationProvenance({
    repos: input.repos,
    datasetSha256: input.datasetSha256,
    baseAnnotations: input.baseAnnotations,
    headAnnotations: annotations,
    headMetaDatasetSha256: input.datasetSha256,
    source: input.source,
    config: input.config,
    maxChangedPerRun: input.maxChangedPerRun,
  });
  if (!provenance.ok) return { ok: false, violations: provenance.violations };

  // The live Git-backed gate rejects a PR that changes only the meta (base
  // annotations == head annotations). Mirror that here so the helper never
  // approves a no-op the merge gate would reject anyway: a rebase must carry a
  // real annotation add/modify/prune.
  if (provenance.changed.length === 0 && provenance.pruned.length === 0) {
    return reject(
      'no annotation change vs base: a metadata-only re-stamp is rejected by the live gate',
    );
  }

  // 3. Emit the head meta with ONLY `dataset_sha256` moved to the current base.
  const rebased = AiAnnotationsMetaSchema.parse({
    ...headMeta,
    dataset_sha256: input.datasetSha256,
  });
  return {
    ok: true,
    violations: [],
    annotationsBytes: input.headAnnotationsBytes,
    metaBytes: serializeAiAnnotationsMeta(rebased),
  };
}
