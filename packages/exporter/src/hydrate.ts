import type { HydrateResult, RawStarEdge, Seed } from '@starred/github-client';
import { type CanonicalRepo, HYDRATABLE_FIELDS } from '@starred/schema';

export interface MergeResult {
  /** Fully hydrated repos. */
  edges: RawStarEdge[];
  /** Publishable degraded records: identity known, metadata unknown (hydration failed). */
  failedRecords: CanonicalRepo[];
  /** Seeds whose node was null on hydration: deleted/private/inaccessible after enumeration. */
  removedMidRun: number;
  /** Seeds we cannot represent at all (no identity). */
  droppedUnidentifiable: number;
}

/** Build a degraded CanonicalRepo from a seed whose metadata hydration failed. */
export function buildFailedRecord(seed: Seed): CanonicalRepo {
  const nameWithOwner = seed.name_with_owner as string;
  const slash = nameWithOwner.indexOf('/');
  const owner = slash >= 0 ? nameWithOwner.slice(0, slash) : nameWithOwner;
  const name = slash >= 0 ? nameWithOwner.slice(slash + 1) : nameWithOwner;
  return {
    node_id: seed.node_id,
    name_with_owner: nameWithOwner,
    owner,
    name,
    url: seed.url as string,
    description: null,
    homepage_url: null,
    primary_language: null,
    topics: [],
    license_spdx: null,
    stargazer_count: null,
    fork_count: null,
    open_issues_count: null,
    is_archived: null,
    is_disabled: null,
    is_fork: null,
    created_at: null,
    pushed_at: null,
    updated_at: null,
    latest_stable_release: null,
    latest_any_release: null,
    starred_at: seed.starred_at,
    hydration_status: 'failed',
    unavailable_fields: [...HYDRATABLE_FIELDS],
  };
}

function hasIdentity(seed: Seed): boolean {
  return Boolean(seed.name_with_owner && seed.url);
}

/**
 * Merge REST seeds with the bisection hydrate result, **by node_id**:
 *
 *  - hydrated node present ⇒ ok edge (current name via hydrated node — HYD-3).
 *  - node was null (API) ⇒ removed_mid_run (gone; drop).
 *  - node fetch failed ⇒ degraded record if identity is known, else dropped.
 */
export function mergeSeeds(
  seeds: readonly Seed[],
  hydrate: Pick<HydrateResult, 'nodesById' | 'nullNodeIds' | 'failedNodeIds'>,
): MergeResult {
  const nullSet = new Set(hydrate.nullNodeIds);
  const failedSet = new Set(hydrate.failedNodeIds);
  const edges: RawStarEdge[] = [];
  const failedRecords: CanonicalRepo[] = [];
  let removedMidRun = 0;
  let droppedUnidentifiable = 0;

  for (const seed of seeds) {
    const node = hydrate.nodesById.get(seed.node_id);
    if (node) {
      if (!node.id || !node.nameWithOwner || !node.url) {
        droppedUnidentifiable += 1;
        continue;
      }
      edges.push({ starredAt: seed.starred_at, node });
      continue;
    }
    if (nullSet.has(seed.node_id)) {
      removedMidRun += 1;
      continue;
    }
    if (failedSet.has(seed.node_id)) {
      if (hasIdentity(seed)) failedRecords.push(buildFailedRecord(seed));
      else droppedUnidentifiable += 1;
      continue;
    }
    // Not hydrated, not null, not failed — treat defensively as removed.
    removedMidRun += 1;
  }

  return { edges, failedRecords, removedMidRun, droppedUnidentifiable };
}
