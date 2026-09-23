import { z } from 'zod';
import { ALIAS_REASON_MAX_LENGTH, SKILLS_ALIASES_SCHEMA_VERSION } from './constants';
import { NameWithOwnerSchema, NodeIdSchema, plainTextSchema } from './scalars';

/**
 * `skills-aliases.json` — the human-reviewed durable alias map backing the §5
 * resolution step (2): `old_owner/old_repo → node_id`, added ONLY after manual
 * confirmation. The generator READS this file; only a human writes it. File
 * absent ⇒ empty map, not an error (P7 §4.7).
 *
 * No ordering invariant: the file is hand-maintained, and uniqueness (not
 * order) is what correctness needs. Its shape version is independent of the
 * artifact's so an artifact MINOR bump never invalidates an untouched map.
 */
export const SkillsAliasSchema = z
  .object({
    /** The name exactly as written in the curated `.md`. */
    source_name_with_owner: NameWithOwnerSchema,
    /** The manually confirmed live repository id. */
    node_id: NodeIdSchema,
    /** Why this alias exists (rename, transfer, …) — required, human-written. */
    reason: plainTextSchema(1, ALIAS_REASON_MAX_LENGTH),
  })
  .strict();
export type SkillsAlias = z.infer<typeof SkillsAliasSchema>;

export const SkillsAliasesSchema = z
  .object({
    schema_version: z.literal(SKILLS_ALIASES_SCHEMA_VERSION),
    aliases: z.array(SkillsAliasSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    const loweredNames = file.aliases.map((alias) => alias.source_name_with_owner.toLowerCase());
    if (new Set(loweredNames).size !== loweredNames.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'alias source_name_with_owner must be unique case-insensitively',
        path: ['aliases'],
      });
    }
    const nodeIds = file.aliases.map((alias) => alias.node_id);
    if (new Set(nodeIds).size !== nodeIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'alias node_id must be unique',
        path: ['aliases'],
      });
    }
  });
export type SkillsAliases = z.infer<typeof SkillsAliasesSchema>;
