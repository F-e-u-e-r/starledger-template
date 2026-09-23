import type { DatasetMeta } from './dataset-meta';
import type { StarsFile } from './stars';

/**
 * Structural invariants of the CANONICAL dataset, as pure functions.
 *
 * These live here — in the schema package both the build and the browser
 * already depend on — so that build-time and runtime acceptance cannot drift
 * apart. Byte agreement is not acceptance agreement: before this was shared,
 * a correctly-hashed dataset with a wrong `repo_count` or a repeated `node_id`
 * was REFUSED by the build and ACCEPTED by the runtime.
 *
 * Deliberately dependency-free and Node-free: the dashboard bundles this, so
 * nothing here may reach for a filesystem, a process, or a crypto backend.
 * Integrity digests stay with each side's own transport.
 *
 * Returns the problems found, in a stable order, so each caller can map them
 * onto ITS OWN failure semantics — the build throws, the runtime raises a typed
 * error — without this module deciding either.
 */
export function checkCanonicalDatasetInvariants(stars: StarsFile, meta: DatasetMeta): string[] {
  const problems: string[] = [];

  if (meta.repo_count !== stars.repos.length) {
    problems.push(
      `dataset-meta.repo_count (${meta.repo_count}) does not match stars.json (${stars.repos.length} repos)`,
    );
  }

  const seen = new Set<string>();
  for (const repo of stars.repos) {
    if (seen.has(repo.node_id)) {
      problems.push(`duplicate node_id ${repo.node_id}`);
      break; // one report is enough; the dataset is rejected either way
    }
    seen.add(repo.node_id);
  }

  return problems;
}
