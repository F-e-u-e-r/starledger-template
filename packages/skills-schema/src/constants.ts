/**
 * Version literals and bounds for the M2 skills-classification contract
 * (P7 §4). DELIBERATELY separate from `@starred/ai-schema`'s versions and from
 * `@starred/schema`'s dataset version: the skills contract evolves
 * independently, and this package imports NOTHING from either (§4.0 ownership
 * boundary — the AI loader's gate semantics must never be cargo-culted here).
 */

/** Governs SHAPE of `skills-classification.json` + `-meta.json` (P7 §4.6). */
export const SKILLS_SCHEMA_VERSION = '1.0';

/**
 * Governs MEANING (the category vocabulary cut). Bumped only when old and new
 * category ids stop being comparable (P7 §4.6).
 */
export const SKILLS_TAXONOMY_VERSION = 'skills-1';

/**
 * The hand-maintained alias map's own shape version — independent of the
 * artifact's `SKILLS_SCHEMA_VERSION` so an artifact MINOR bump does not
 * invalidate an untouched, human-reviewed aliases file (P7 §4.7).
 */
export const SKILLS_ALIASES_SCHEMA_VERSION = '1.0';

// --- bounds (P7 §4.2 field rules) ---
export const SLUG_MAX_LENGTH = 64;
export const LABEL_MAX_LENGTH = 120;
export const DEFINITION_MAX_LENGTH = 600;
export const SCOPE_DESCRIPTION_MAX_LENGTH = 400;
export const SUMMARY_MAX_LENGTH = 400;
export const ALIAS_REASON_MAX_LENGTH = 400;
export const NODE_ID_MAX_LENGTH = 256;
export const NAME_WITH_OWNER_MIN_LENGTH = 3;
export const NAME_WITH_OWNER_MAX_LENGTH = 140;

/** v1 allows at most one secondary category per entry (P7 §4.2 I-4). */
export const SECONDARY_CATEGORY_MAX = 1;

export const CATEGORY_KINDS = ['domain', 'infrastructure'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/**
 * Closed enum in v1; adding a pack is a schema MINOR bump (P7 §4.2, owner
 * decision D2).
 */
export const TARGET_PACKS = ['opus-pack', 'design-pack'] as const;
export type TargetPack = (typeof TARGET_PACKS)[number];

export const RESOLUTIONS = ['resolved', 'missing_from_stars'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
