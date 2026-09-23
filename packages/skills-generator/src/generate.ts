import { StarsFileSchema } from '@starred/schema';
import {
  SkillsAliasesSchema,
  SkillsClassificationMetaSchema,
  SkillsClassificationSchema,
  checkSkillsMetaConsistency,
  serializeSkillsClassification,
  serializeSkillsClassificationMeta,
  type SkillsClassificationMeta,
  type SkillsScope,
} from '@starred/skills-schema';
import { sha256 } from './hash';
import { parseSkillsClassifiedSource } from './parse-source';
import { resolveEntries } from './resolve';

/**
 * The M2.2 generator core — a PURE FUNCTION over its inputs (§4.3):
 * `(source bytes, aliases bytes | null, prior bytes | null, stars bytes,
 * generatedAt) → (artifact bytes, meta bytes)`. `generatedAt` is injected by
 * the caller so the data artifact is exact-byte deterministic and meta's only
 * non-deterministic field is the injected clock (owner gate 5).
 *
 * Build-time is FAIL-CLOSED (§4.5): a defective source, a present-but-invalid
 * aliases/prior/stars input, a resolution conflict, or any invariant breach
 * refuses to emit — with every issue named.
 */

/** §4.9: the artifact scope is a generator constant; the source has no scope block. */
export const SKILLS_SCOPE: SkillsScope = {
  id: 'coding-agent-skills-ecosystem',
  label: 'Coding-agent skills ecosystem',
  description: 'A curated subset; absence is not a classification.',
};

export interface GenerateInputs {
  /** Exact `skills-classified.md` text. */
  sourceText: string;
  /** Exact `skills-aliases.json` text; null ⟺ the file is absent (empty map, §4.7). */
  aliasesText: string | null;
  /**
   * Exact prior `skills-classification.json` text; null ⟺ NO prior is being
   * consumed — first generation or the explicit §4.6 regenerate-without-prior
   * mode. A present-but-invalid prior must reach here as text and FAIL —
   * callers never swallow a load failure into null (owner gate 4).
   */
  priorText: string | null;
  /** Exact `stars.json` text (the generation snapshot). */
  starsText: string;
  /** Injected UTC timestamp (…Z) — the sole non-deterministic meta field. */
  generatedAt: string;
}

export interface GenerateSuccess {
  ok: true;
  artifactBytes: string;
  metaBytes: string;
  meta: SkillsClassificationMeta;
  diagnostics: string[];
  /** §5's three coverage numbers, derived from the resolved records. */
  coverage: { matched: number; unclassified: number; unresolved: number };
}

export interface GenerateFailure {
  ok: false;
  issues: string[];
  diagnostics: string[];
}

export type GenerateResult = GenerateSuccess | GenerateFailure;

function parseJson(text: string, label: string): { value?: unknown; issue?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return {
      issue: `${label}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function generateSkillsClassification(inputs: GenerateInputs): GenerateResult {
  const issues: string[] = [];
  const diagnostics: string[] = [];

  // 1. Source grammar (§4.9) — fail-closed with every violation named.
  const parsed = parseSkillsClassifiedSource(inputs.sourceText);
  if (!parsed.ok) {
    return { ok: false, issues: parsed.issues, diagnostics };
  }

  // 2. Aliases: absent ⇒ empty map; present-but-invalid ⇒ FAIL (§4.5).
  const aliasesByName = new Map<string, string>();
  if (inputs.aliasesText !== null) {
    const json = parseJson(inputs.aliasesText, 'skills-aliases.json');
    if (json.issue !== undefined) {
      issues.push(json.issue);
    } else {
      const aliases = SkillsAliasesSchema.safeParse(json.value);
      if (!aliases.success) {
        issues.push(
          `skills-aliases.json: schema-invalid — ${aliases.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      } else {
        for (const alias of aliases.data.aliases) {
          aliasesByName.set(alias.source_name_with_owner.toLowerCase(), alias.node_id);
        }
      }
    }
  }

  // 3. Prior artifact: read under the CURRENT schema; invalid ⇒ FAIL with the
  //    named §4.6 escape (regenerate-without-prior), never a silent null.
  const priorByName = new Map<string, string>();
  if (inputs.priorText !== null) {
    const json = parseJson(inputs.priorText, 'prior skills-classification.json');
    if (json.issue !== undefined) {
      issues.push(`${json.issue} — migrate it or rerun with --regenerate-without-prior (§4.6)`);
    } else {
      const prior = SkillsClassificationSchema.safeParse(json.value);
      if (!prior.success) {
        issues.push(
          `prior skills-classification.json fails the current schema — migrate it or rerun with --regenerate-without-prior (§4.6): ${prior.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      } else {
        for (const entry of prior.data.entries) {
          if (entry.node_id !== null) {
            priorByName.set(entry.source_name_with_owner.toLowerCase(), entry.node_id);
          }
        }
      }
    }
  }

  // 4. Stars snapshot: the resolution basis — missing/invalid ⇒ FAIL (§4.5).
  const starsByName = new Map<string, string>();
  const starsNodeIds = new Set<string>();
  let canonicalRepoCount = 0;
  {
    const json = parseJson(inputs.starsText, 'stars.json');
    if (json.issue !== undefined) {
      issues.push(json.issue);
    } else {
      const stars = StarsFileSchema.safeParse(json.value);
      if (!stars.success) {
        issues.push(
          `stars.json: schema-invalid — ${stars.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      } else {
        canonicalRepoCount = stars.data.repos.length;
        for (const repo of stars.data.repos) {
          starsByName.set(repo.name_with_owner.toLowerCase(), repo.node_id);
          starsNodeIds.add(repo.node_id);
        }
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues, diagnostics };

  // 5. Evaluate-all resolution (§5, gate 2).
  const resolution = resolveEntries(parsed.source.entries, {
    starsByName,
    aliasesByName,
    priorByName,
  });
  diagnostics.push(...resolution.diagnostics);
  if (resolution.issues.length > 0) {
    return { ok: false, issues: resolution.issues, diagnostics };
  }

  // 6. Canonical artifact — serialize validates EVERY §4.2 invariant.
  let artifactBytes: string;
  try {
    artifactBytes = serializeSkillsClassification({
      scope: SKILLS_SCOPE,
      categories: parsed.source.categories,
      entries: resolution.entries,
    });
  } catch (error) {
    return {
      ok: false,
      issues: [
        `artifact failed contract validation: ${error instanceof Error ? error.message : String(error)}`,
      ],
      diagnostics,
    };
  }
  const artifact = SkillsClassificationSchema.parse(JSON.parse(artifactBytes));

  // 7. Counts DERIVED from the validated resolved records (gate 6) — no
  //    separately maintained counters.
  const resolvedEntries = artifact.entries.filter((entry) => entry.node_id !== null);
  const presentCount = resolvedEntries.filter((entry) =>
    starsNodeIds.has(entry.node_id as string),
  ).length;
  const meta: SkillsClassificationMeta = {
    schema_version: artifact.schema_version,
    taxonomy_version: artifact.taxonomy_version,
    classification_sha256: sha256(artifactBytes),
    source_sha256: sha256(inputs.sourceText),
    aliases_sha256: inputs.aliasesText === null ? null : sha256(inputs.aliasesText),
    // Gate 3: consumed ⟺ non-null — the prior participated in resolution, so
    // the run is lineage-bearing even if the output equals a no-prior run.
    prior_classification_sha256: inputs.priorText === null ? null : sha256(inputs.priorText),
    generated_against_stars_sha256: sha256(inputs.starsText),
    generated_at: inputs.generatedAt,
    category_count: artifact.categories.length,
    source_entry_count: artifact.entries.length,
    resolved_entry_count: resolvedEntries.length,
    present_repo_count: presentCount,
    absent_repo_count: resolvedEntries.length - presentCount,
    unresolved_entry_count: artifact.entries.length - resolvedEntries.length,
    canonical_repo_count: canonicalRepoCount,
    unclassified_repo_count: canonicalRepoCount - presentCount,
  };

  // 8. Meta through its own schema (A-1..A-3 live there) + the C-1..C-4
  //    cross-check. Derived counts failing here would be a generator bug —
  //    still fail-closed, never emit.
  let metaBytes: string;
  try {
    metaBytes = serializeSkillsClassificationMeta(SkillsClassificationMetaSchema.parse(meta));
  } catch (error) {
    return {
      ok: false,
      issues: [
        `meta failed contract validation: ${error instanceof Error ? error.message : String(error)}`,
      ],
      diagnostics,
    };
  }
  const crossProblems = checkSkillsMetaConsistency(meta, artifact);
  if (crossProblems.length > 0) {
    return {
      ok: false,
      issues: crossProblems.map((problem) => `meta↔artifact cross-check: ${problem}`),
      diagnostics,
    };
  }

  return {
    ok: true,
    artifactBytes,
    metaBytes,
    meta,
    diagnostics,
    coverage: {
      matched: meta.present_repo_count,
      unclassified: meta.unclassified_repo_count,
      unresolved: meta.unresolved_entry_count,
    },
  };
}
