import type {
  SkillsCategory,
  SkillsClassification,
  SkillsEntry,
  SkillsScope,
} from '../src/artifact';
import type { SkillsClassificationMeta } from '../src/meta';

/**
 * Canonical-form builders. Defaults satisfy EVERY §4 invariant (I-1..I-6,
 * C-1..4, A-1..3), so each test mutates exactly the axis it probes.
 */

export function makeScope(overrides: Partial<SkillsScope> = {}): SkillsScope {
  return {
    id: 'coding-agent-skills-ecosystem',
    label: 'Coding-agent skills ecosystem',
    description: 'A curated subset; absence is not a classification.',
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<SkillsCategory> = {}): SkillsCategory {
  return {
    id: 'verification-qa',
    label: 'Verification & QA',
    kind: 'domain',
    definition: 'Skills and harnesses that verify agent output.',
    order: 0,
    target_pack: 'opus-pack',
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<SkillsEntry> = {}): SkillsEntry {
  return {
    source_name_with_owner: 'obra/superpowers',
    node_id: 'R_kgDOalpha01',
    resolution: 'resolved',
    primary_category_id: 'verification-qa',
    secondary_category_ids: [],
    summary: 'Curated one-liner for the entry.',
    ...overrides,
  };
}

/**
 * Two categories (order 0/1) + two entries already in I-6 order, referencing
 * existing categories only.
 */
export function makeArtifact(overrides: Partial<SkillsClassification> = {}): SkillsClassification {
  return {
    schema_version: '1.0',
    taxonomy_version: 'skills-1',
    scope: makeScope(),
    categories: [
      makeCategory(),
      makeCategory({
        id: 'roadmap-planning',
        label: 'Roadmap & planning',
        order: 1,
        target_pack: null,
      }),
    ],
    entries: [
      makeEntry({
        source_name_with_owner: 'acme/tooling',
        node_id: 'R_kgDOacme0001',
        primary_category_id: 'roadmap-planning',
        secondary_category_ids: ['verification-qa'],
      }),
      makeEntry(),
    ],
    ...overrides,
  };
}

/** Consistent with `makeArtifact()` defaults: 2 categories, 2 entries, both resolved+present. */
export function makeMeta(
  overrides: Partial<SkillsClassificationMeta> = {},
): SkillsClassificationMeta {
  return {
    schema_version: '1.0',
    taxonomy_version: 'skills-1',
    classification_sha256: 'a'.repeat(64),
    source_sha256: 'b'.repeat(64),
    aliases_sha256: null,
    prior_classification_sha256: null,
    generated_against_stars_sha256: 'c'.repeat(64),
    generated_at: '2026-08-13T00:00:00Z',
    category_count: 2,
    source_entry_count: 2,
    resolved_entry_count: 2,
    present_repo_count: 2,
    absent_repo_count: 0,
    unresolved_entry_count: 0,
    canonical_repo_count: 700,
    unclassified_repo_count: 698,
    ...overrides,
  };
}
