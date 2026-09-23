import { z } from 'zod';
import { SKILLS_SCHEMA_VERSION, SKILLS_TAXONOMY_VERSION } from './constants';
import type { SkillsClassification } from './artifact';
import { Hex64Schema, UtcTimestampSchema } from './scalars';

/**
 * `skills-classification-meta.json` — the M2 generator's OWN provenance/
 * integrity metadata (P7 §4.4). Field names deliberately differ from
 * `ai-annotations-meta.json` (`classification_sha256`, not `annotations_…`;
 * `generated_against_stars_sha256`, not `dataset_sha256`) so the AI loader's
 * hard dataset gate can never be cargo-culted onto this layer: per §2.1 the
 * stars hash here is PROVENANCE ONLY — a soft "older snapshot" note when it
 * differs from the live dataset, never a validity gate.
 */
export const SkillsClassificationMetaSchema = z
  .object({
    schema_version: z.literal(SKILLS_SCHEMA_VERSION),
    taxonomy_version: z.literal(SKILLS_TAXONOMY_VERSION),
    /** sha256 of the exact `skills-classification.json` bytes — the runtime integrity gate. */
    classification_sha256: Hex64Schema,
    /** sha256 of the vendored `skills-classified.md` bytes — provenance only. */
    source_sha256: Hex64Schema,
    /** sha256 of `skills-aliases.json` bytes; null ⟺ the file was absent (empty map). Provenance only. */
    aliases_sha256: Hex64Schema.nullable(),
    /**
     * sha256 of the prior `skills-classification.json` consumed for sticky
     * resolution; null ⟺ NO prior was consumed — first generation, or an
     * explicit regenerate-without-prior run (§4.6). Provenance only.
     */
    prior_classification_sha256: Hex64Schema.nullable(),
    /** The stars snapshot generation ran against — provenance ONLY (§2.1), never a gate. */
    generated_against_stars_sha256: Hex64Schema,
    generated_at: UtcTimestampSchema,
    category_count: z.number().int().nonnegative(),
    source_entry_count: z.number().int().nonnegative(),
    resolved_entry_count: z.number().int().nonnegative(),
    present_repo_count: z.number().int().nonnegative(),
    absent_repo_count: z.number().int().nonnegative(),
    unresolved_entry_count: z.number().int().nonnegative(),
    canonical_repo_count: z.number().int().nonnegative(),
    unclassified_repo_count: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((meta, ctx) => {
    // A-1..A-3 are META-INTERNAL arithmetic (P7 §4.4), so the schema itself
    // enforces them — which makes the parse-first serializer below fail-closed
    // against arithmetically impossible counts. C-1..C-4 need the artifact and
    // stay in checkSkillsMetaConsistency.
    if (meta.source_entry_count !== meta.resolved_entry_count + meta.unresolved_entry_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A-1: source_entry_count must equal resolved + unresolved',
        path: ['source_entry_count'],
      });
    }
    if (meta.resolved_entry_count !== meta.present_repo_count + meta.absent_repo_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A-2: resolved_entry_count must equal present + absent',
        path: ['resolved_entry_count'],
      });
    }
    if (meta.present_repo_count + meta.unclassified_repo_count !== meta.canonical_repo_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A-3: present + unclassified must equal canonical_repo_count',
        path: ['canonical_repo_count'],
      });
    }
  });
export type SkillsClassificationMeta = z.infer<typeof SkillsClassificationMetaSchema>;

/**
 * C-1..C-4 + A-1..A-3 (P7 §4.4): meta ↔ artifact mapping and meta-internal
 * arithmetic. Shared verbatim by the build-time generator (assert: any entry ⇒
 * FAIL) and the runtime loader (verify: any entry ⇒ layer `unavailable`).
 *
 * DELIBERATELY takes no stars input: present/absent/canonical/unclassified are
 * generation-snapshot statistics, and re-checking them against the LIVE
 * dataset is forbidden (§2.1). The generator's against-snapshot assertions
 * (that `present` counts repos that truly existed in ITS stars input) live in
 * the M2.2 generator, which has that snapshot in hand — not here.
 */
export function checkSkillsMetaConsistency(
  meta: SkillsClassificationMeta,
  artifact: SkillsClassification,
): string[] {
  const problems: string[] = [];
  const resolved = artifact.entries.filter((entry) => entry.resolution === 'resolved').length;
  const unresolved = artifact.entries.length - resolved;

  if (meta.category_count !== artifact.categories.length) {
    problems.push(
      `C-1: category_count ${meta.category_count} != categories.length ${artifact.categories.length}`,
    );
  }
  if (meta.source_entry_count !== artifact.entries.length) {
    problems.push(
      `C-2: source_entry_count ${meta.source_entry_count} != entries.length ${artifact.entries.length}`,
    );
  }
  if (meta.resolved_entry_count !== resolved) {
    problems.push(
      `C-3: resolved_entry_count ${meta.resolved_entry_count} != resolved entries ${resolved}`,
    );
  }
  if (meta.unresolved_entry_count !== unresolved) {
    problems.push(
      `C-4: unresolved_entry_count ${meta.unresolved_entry_count} != missing_from_stars entries ${unresolved}`,
    );
  }
  if (meta.source_entry_count !== meta.resolved_entry_count + meta.unresolved_entry_count) {
    problems.push(
      `A-1: source_entry_count ${meta.source_entry_count} != resolved ${meta.resolved_entry_count} + unresolved ${meta.unresolved_entry_count}`,
    );
  }
  if (meta.resolved_entry_count !== meta.present_repo_count + meta.absent_repo_count) {
    problems.push(
      `A-2: resolved_entry_count ${meta.resolved_entry_count} != present ${meta.present_repo_count} + absent ${meta.absent_repo_count}`,
    );
  }
  if (meta.present_repo_count + meta.unclassified_repo_count !== meta.canonical_repo_count) {
    problems.push(
      `A-3: present ${meta.present_repo_count} + unclassified ${meta.unclassified_repo_count} != canonical_repo_count ${meta.canonical_repo_count}`,
    );
  }
  return problems;
}

/**
 * Validate, then emit canonical meta bytes: fixed key order, 2-space indent,
 * single trailing newline. Parsing first keeps this serializer fail-closed —
 * like the artifact serializer, it can never emit bytes the schema rejects
 * (P7 §4.5 build column).
 */
export function serializeSkillsClassificationMeta(meta: SkillsClassificationMeta): string {
  const validated = SkillsClassificationMetaSchema.parse(meta);
  const canonical = {
    schema_version: validated.schema_version,
    taxonomy_version: validated.taxonomy_version,
    classification_sha256: validated.classification_sha256,
    source_sha256: validated.source_sha256,
    aliases_sha256: validated.aliases_sha256,
    prior_classification_sha256: validated.prior_classification_sha256,
    generated_against_stars_sha256: validated.generated_against_stars_sha256,
    generated_at: validated.generated_at,
    category_count: validated.category_count,
    source_entry_count: validated.source_entry_count,
    resolved_entry_count: validated.resolved_entry_count,
    present_repo_count: validated.present_repo_count,
    absent_repo_count: validated.absent_repo_count,
    unresolved_entry_count: validated.unresolved_entry_count,
    canonical_repo_count: validated.canonical_repo_count,
    unclassified_repo_count: validated.unclassified_repo_count,
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}
