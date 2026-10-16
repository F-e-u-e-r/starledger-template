import type { SkillsCategory } from '@starred/skills-schema/contracts';
import type { SearchableRepo } from './select';

/** One rendered group: a taxonomy category with ≥ 1 repo in the result set. */
export interface ResultGroup {
  /** Taxonomy category id (a kebab slug — also the group's DOM id suffix). */
  id: string;
  label: string;
  /** Members in the effective result order (the partition never re-sorts). */
  repos: SearchableRepo[];
}

export interface GroupedResults {
  /** Non-empty groups in taxonomy `order` (empty categories are omitted, D7). */
  groups: ResultGroup[];
  /** `groupedRenderable.length` — every result carrying a classification. */
  groupedCount: number;
  /** `results.length − groupedCount` — matching repos omitted from the grouped
   *  presentation because they carry no classification (U1 disclosure). */
  excludedCount: number;
}

/**
 * Pure grouped-presentation projection (P7 §15.4, M4.1). Runs AFTER
 * search → filters → sort and never changes the effective result set: it
 * partitions `results` by `skills.primaryCategoryId` ONLY (§8 — each repo lands
 * in exactly one group; secondaries stay card metadata), keeps every bucket in
 * `results` order (within-group order = the effective sort), and emits buckets
 * in the taxonomy's `order` — `categories` as loaded, which I-5 guarantees is
 * canonical order — never alphabetically, never by count. Results without a
 * classification are not rendered but counted (`excludedCount`); there is no
 * "Unclassified" pseudo-group (absence of a classification is not one), and no
 * runtime salvage bucket: I-4 guarantees every primary id is a taxonomy member.
 * No DOM, no clock, no state.
 */
export function groupByPrimaryCategory(
  results: readonly SearchableRepo[],
  categories: readonly SkillsCategory[],
): GroupedResults {
  const buckets = new Map<string, SearchableRepo[]>();
  let groupedCount = 0;
  for (const repo of results) {
    if (repo.skills === null) continue;
    groupedCount += 1;
    const key = repo.skills.primaryCategoryId;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(repo);
    else buckets.set(key, [repo]);
  }
  const groups: ResultGroup[] = [];
  for (const category of categories) {
    const repos = buckets.get(category.id);
    if (repos) groups.push({ id: category.id, label: category.label, repos });
  }
  return { groups, groupedCount, excludedCount: results.length - groupedCount };
}
