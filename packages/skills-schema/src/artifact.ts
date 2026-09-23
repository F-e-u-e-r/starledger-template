import { z } from 'zod';
import {
  CATEGORY_KINDS,
  DEFINITION_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  RESOLUTIONS,
  SCOPE_DESCRIPTION_MAX_LENGTH,
  SECONDARY_CATEGORY_MAX,
  SKILLS_SCHEMA_VERSION,
  SKILLS_TAXONOMY_VERSION,
  SUMMARY_MAX_LENGTH,
  TARGET_PACKS,
} from './constants';
import { NameWithOwnerSchema, NodeIdSchema, SlugSchema, plainTextSchema } from './scalars';

/**
 * `skills-classification.json` — the generated classification artifact
 * (P7 §4.2). Optional enrichment joined to Starred repos by `node_id`; NEVER
 * canonical repository truth. Entries never carry stars/url/language/
 * description — `.strict()` makes carrying them a schema violation, and the
 * live fields come exclusively from the runtime `node_id` join (§5).
 *
 * The artifact holds NO timestamp anywhere: wall-clock is quarantined in the
 * meta's `generated_at`, so identical inputs serialize byte-identically
 * (P7 §4.3, mirroring the stars dataset's determinism invariant).
 */

export const ScopeSchema = z
  .object({
    id: SlugSchema,
    label: plainTextSchema(1, LABEL_MAX_LENGTH),
    description: plainTextSchema(1, SCOPE_DESCRIPTION_MAX_LENGTH),
  })
  .strict();
export type SkillsScope = z.infer<typeof ScopeSchema>;

export const SkillsCategorySchema = z
  .object({
    id: SlugSchema,
    label: plainTextSchema(1, LABEL_MAX_LENGTH),
    kind: z.enum(CATEGORY_KINDS),
    definition: plainTextSchema(1, DEFINITION_MAX_LENGTH),
    order: z.number().int().nonnegative(),
    target_pack: z.enum(TARGET_PACKS).nullable(),
  })
  .strict();
export type SkillsCategory = z.infer<typeof SkillsCategorySchema>;

/**
 * One classified source entry. I-3 binds record identity to join identity:
 * `resolution` and `node_id` nullability must agree in both directions, so an
 * unresolved entry keeps its record identity (`source_name_with_owner`) while
 * having no join identity (P7 §4.1).
 */
export const SkillsEntrySchema = z
  .object({
    source_name_with_owner: NameWithOwnerSchema,
    node_id: NodeIdSchema.nullable(),
    resolution: z.enum(RESOLUTIONS),
    primary_category_id: SlugSchema,
    secondary_category_ids: z.array(SlugSchema).max(SECONDARY_CATEGORY_MAX),
    summary: plainTextSchema(1, SUMMARY_MAX_LENGTH),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.resolution === 'resolved' && entry.node_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resolution "resolved" requires a non-null node_id (I-3)',
        path: ['node_id'],
      });
    }
    if (entry.resolution === 'missing_from_stars' && entry.node_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resolution "missing_from_stars" requires node_id null (I-3)',
        path: ['node_id'],
      });
    }
    for (const secondary of entry.secondary_category_ids) {
      if (secondary === entry.primary_category_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'secondary category must differ from the primary (I-4)',
          path: ['secondary_category_ids'],
        });
      }
    }
    const sortedUnique = [...new Set(entry.secondary_category_ids)].sort();
    if (
      sortedUnique.length !== entry.secondary_category_ids.length ||
      sortedUnique.some((id, index) => id !== entry.secondary_category_ids[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'secondary_category_ids must be sorted and unique (I-4)',
        path: ['secondary_category_ids'],
      });
    }
  });
export type SkillsEntry = z.infer<typeof SkillsEntrySchema>;

/**
 * True CODEPOINT order. JavaScript `<` on strings compares UTF-16 code units,
 * which mis-orders supplementary-plane characters against U+E000..U+FFFF
 * (surrogates sort low) — so `<` would violate I-6's "codepoint ascending" for
 * valid non-ASCII names. Iterate by codepoint instead; no locale collation.
 */
export function compareCodepoints(a: string, b: string): number {
  const aIter = a[Symbol.iterator]();
  const bIter = b[Symbol.iterator]();
  for (;;) {
    const aStep = aIter.next();
    const bStep = bIter.next();
    if (aStep.done && bStep.done) return 0;
    if (aStep.done) return -1;
    if (bStep.done) return 1;
    const aCode = aStep.value.codePointAt(0) ?? 0;
    const bCode = bStep.value.codePointAt(0) ?? 0;
    if (aCode !== bCode) return aCode < bCode ? -1 : 1;
  }
}

/** I-6 comparator: record-identity total order (I-1 guarantees no ties). */
function compareEntryIdentity(a: string, b: string): number {
  return compareCodepoints(a.toLowerCase(), b.toLowerCase());
}

export const SkillsClassificationSchema = z
  .object({
    schema_version: z.literal(SKILLS_SCHEMA_VERSION),
    taxonomy_version: z.literal(SKILLS_TAXONOMY_VERSION),
    scope: ScopeSchema,
    categories: z.array(SkillsCategorySchema),
    entries: z.array(SkillsEntrySchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    // I-5: unique category ids; sorted by `order`, which is exactly 0..n-1.
    const categoryIds = new Set(file.categories.map((category) => category.id));
    if (categoryIds.size !== file.categories.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'category ids must be unique (I-5)',
        path: ['categories'],
      });
    }
    if (file.categories.some((category, index) => category.order !== index)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'categories must be sorted by order, with order exactly 0..n-1 — no gaps or duplicates (I-5)',
        path: ['categories'],
      });
    }

    // I-1: record identity unique, case-insensitively.
    const loweredNames = file.entries.map((entry) => entry.source_name_with_owner.toLowerCase());
    if (new Set(loweredNames).size !== loweredNames.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source_name_with_owner must be unique case-insensitively (I-1)',
        path: ['entries'],
      });
    }

    // I-2: join identity unique among the entries that have one.
    const nodeIds = file.entries
      .map((entry) => entry.node_id)
      .filter((nodeId): nodeId is string => nodeId !== null);
    if (new Set(nodeIds).size !== nodeIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'non-null node_id must be unique (I-2)',
        path: ['entries'],
      });
    }

    // I-4 (referential half): every referenced category exists.
    for (const [index, entry] of file.entries.entries()) {
      if (!categoryIds.has(entry.primary_category_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `primary_category_id "${entry.primary_category_id}" references no category (I-4)`,
          path: ['entries', index, 'primary_category_id'],
        });
      }
      for (const secondary of entry.secondary_category_ids) {
        if (!categoryIds.has(secondary)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `secondary category "${secondary}" references no category (I-4)`,
            path: ['entries', index, 'secondary_category_ids'],
          });
        }
      }
    }

    // I-6: entries sorted by lowercased record identity, codepoint order.
    const sortedNames = [...loweredNames].sort(compareCodepoints);
    if (loweredNames.some((name, index) => name !== sortedNames[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'entries must be sorted by source_name_with_owner.toLowerCase(), codepoint ascending (I-6)',
        path: ['entries'],
      });
    }
  });
export type SkillsClassification = z.infer<typeof SkillsClassificationSchema>;

/** Total, deterministic I-5 ordering, independent of input order. */
export function sortCategories(categories: readonly SkillsCategory[]): SkillsCategory[] {
  return [...categories].sort((a, b) => a.order - b.order);
}

/** Total, deterministic I-6 ordering, independent of input order. */
export function sortEntries(entries: readonly SkillsEntry[]): SkillsEntry[] {
  return [...entries].sort((a, b) =>
    compareEntryIdentity(a.source_name_with_owner, b.source_name_with_owner),
  );
}

export interface SkillsClassificationInput {
  scope: SkillsScope;
  categories: readonly SkillsCategory[];
  entries: readonly SkillsEntry[];
}

/** Assemble the canonical in-memory form: version literals injected, I-5/I-6 order applied. */
export function buildSkillsClassification(input: SkillsClassificationInput): SkillsClassification {
  return {
    schema_version: SKILLS_SCHEMA_VERSION,
    taxonomy_version: SKILLS_TAXONOMY_VERSION,
    scope: input.scope,
    categories: sortCategories(input.categories),
    entries: sortEntries(input.entries),
  };
}

// Explicit key order — never rely on object-construction order surviving refactors.
function canonicalizeCategory(category: SkillsCategory): Record<string, unknown> {
  return {
    id: category.id,
    label: category.label,
    kind: category.kind,
    definition: category.definition,
    order: category.order,
    target_pack: category.target_pack,
  };
}

function canonicalizeEntry(entry: SkillsEntry): Record<string, unknown> {
  return {
    source_name_with_owner: entry.source_name_with_owner,
    node_id: entry.node_id,
    resolution: entry.resolution,
    primary_category_id: entry.primary_category_id,
    secondary_category_ids: [...entry.secondary_category_ids],
    summary: entry.summary,
  };
}

/**
 * Validate (including every structural invariant) then emit canonical bytes:
 * fixed key order, I-5/I-6 ordering, 2-space indent, single trailing newline
 * (P7 §4.3). An unchanged classification serializes byte-identically, so the
 * future publish step is genuinely commit-on-change.
 */
export function serializeSkillsClassification(input: SkillsClassificationInput): string {
  const validated = SkillsClassificationSchema.parse(buildSkillsClassification(input));
  const canonical = {
    schema_version: validated.schema_version,
    taxonomy_version: validated.taxonomy_version,
    scope: {
      id: validated.scope.id,
      label: validated.scope.label,
      description: validated.scope.description,
    },
    categories: validated.categories.map(canonicalizeCategory),
    entries: validated.entries.map(canonicalizeEntry),
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}
