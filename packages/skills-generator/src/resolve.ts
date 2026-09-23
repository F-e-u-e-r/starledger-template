import type { SkillsEntry } from '@starred/skills-schema';
import type { ParsedEntry } from './parse-source';

/**
 * §5 evaluate-all resolution (M2.1 rule, owner gate 2): for EVERY entry, ALL
 * three sources are consulted and their candidates collected BEFORE any
 * adjudication — never a precedence loop that returns on first match. A
 * first-hit walk cannot even see the exact-vs-alias conflict (a recycled
 * name) or the exact-vs-prior conflict (same-name different-repo swap) this
 * rule exists to surface.
 *
 * Lookups are case-insensitive on `source_name_with_owner`; a prior record
 * with `node_id: null` contributes no candidate (§5).
 */

export interface ResolutionSources {
  /** lowercased live name_with_owner → node_id (generation-snapshot stars). */
  starsByName: ReadonlyMap<string, string>;
  /** lowercased alias source name → manually confirmed node_id. */
  aliasesByName: ReadonlyMap<string, string>;
  /** lowercased prior-record source name → its stored non-null node_id. */
  priorByName: ReadonlyMap<string, string>;
}

export interface ResolutionResult {
  entries: SkillsEntry[];
  /** Conflicts — build failures (§4.5), every candidate named. */
  issues: string[];
  /** Non-fatal surfaced diagnostics (§5): stale alias rows. */
  diagnostics: string[];
}

export function resolveEntries(
  parsed: readonly ParsedEntry[],
  sources: ResolutionSources,
): ResolutionResult {
  const issues: string[] = [];
  const diagnostics: string[] = [];
  const entries: SkillsEntry[] = [];

  for (const entry of parsed) {
    const key = entry.source_name_with_owner.toLowerCase();

    // Evaluate ALL sources first (gate 2) …
    const candidates = new Map<string, string[]>();
    const propose = (source: string, nodeId: string | undefined): void => {
      if (nodeId === undefined) return;
      const proposers = candidates.get(nodeId) ?? [];
      proposers.push(source);
      candidates.set(nodeId, proposers);
    };
    propose('exact-match', sources.starsByName.get(key));
    propose('alias-map', sources.aliasesByName.get(key));
    propose('prior-artifact', sources.priorByName.get(key));

    // … then adjudicate on the collected set (§5): 0 → unresolved,
    // 1 → resolved, >1 → named build failure.
    if (candidates.size > 1) {
      const detail = [...candidates.entries()]
        .map(([nodeId, proposers]) => `${nodeId} (${proposers.join(', ')})`)
        .join(' vs ');
      issues.push(
        `resolution conflict for ${entry.source_name_with_owner}: ${detail} — fix the .md or the alias map (§5)`,
      );
      continue;
    }
    const resolvedId = candidates.size === 1 ? [...candidates.keys()][0]! : null;
    entries.push({
      source_name_with_owner: entry.source_name_with_owner,
      node_id: resolvedId,
      resolution: resolvedId === null ? 'missing_from_stars' : 'resolved',
      primary_category_id: entry.primary_category_id,
      secondary_category_ids: entry.secondary_category_ids,
      summary: entry.summary,
    });
  }

  // Stale alias rows resolve nothing, so they can corrupt nothing — surfaced,
  // never fatal (§5 auxiliary-input semantics).
  const entryNames = new Set(parsed.map((entry) => entry.source_name_with_owner.toLowerCase()));
  for (const aliasName of sources.aliasesByName.keys()) {
    if (!entryNames.has(aliasName)) {
      diagnostics.push(
        `stale alias: ${aliasName} matches no current source entry — prune it from skills-aliases.json`,
      );
    }
  }

  return { entries, issues, diagnostics };
}
