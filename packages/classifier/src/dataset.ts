import { sha256Bytes } from '@starred/ai-schema';
import {
  DatasetMetaSchema,
  StarsFileSchema,
  type CanonicalRepo,
  type DatasetMeta,
  type StarsFile,
} from '@starred/schema';

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

export interface VerifiedDataset {
  stars: StarsFile;
  meta: DatasetMeta;
  /** SHA-256 of the EXACT stars.json bytes — identical to the exporter/dashboard. */
  datasetSha256: string;
  repos: readonly CanonicalRepo[];
}

/**
 * Load and verify the canonical dataset EXACTLY as the dashboard loader and the
 * exporter publish step do: both files schema-validate, the stars BYTES hash to
 * `dataset-meta.stars_sha256`, `repo_count` matches, and node_ids are unique.
 * The planner classifies only repositories that pass this gate, so a malformed
 * or incomplete canonical identity can never enter a job (DATA-1/DATA-2).
 *
 * `starsBytes` is BYTES, not text, and the parameter type says so deliberately
 * (round-9 closure of the decoded-text digest class; mirrors `@starred/deploy`'s
 * `verifyDatasetIntegrity`). Hashing a decoded string re-encodes it, so two
 * byte strings that decode alike (a BOM, a malformed sequence) hash alike — the
 * classifier would then produce content against a dataset the byte-strict
 * deployed runtime refuses to load. Requiring bytes keeps the exporter, the
 * build, the dashboard, and the classifier agreeing on `dataset_sha256` (the
 * P3.3 provenance gate relies on that agreement).
 */
export function loadCanonicalDataset(starsBytes: Uint8Array, metaText: string): VerifiedDataset {
  const starsText = Buffer.from(starsBytes).toString('utf8');
  let starsJson: unknown;
  let metaJson: unknown;
  try {
    starsJson = JSON.parse(starsText);
  } catch {
    throw new DatasetError('stars.json is not valid JSON');
  }
  try {
    metaJson = JSON.parse(metaText);
  } catch {
    throw new DatasetError('dataset-meta.json is not valid JSON');
  }

  const meta = DatasetMetaSchema.safeParse(metaJson);
  if (!meta.success) throw new DatasetError('dataset-meta.json failed schema validation');
  const stars = StarsFileSchema.safeParse(starsJson);
  if (!stars.success) throw new DatasetError('stars.json failed schema validation');

  const seen = new Set<string>();
  for (const repo of stars.data.repos) {
    if (seen.has(repo.node_id)) throw new DatasetError(`duplicate node_id ${repo.node_id}`);
    seen.add(repo.node_id);
  }

  const datasetSha256 = sha256Bytes(starsBytes);
  if (meta.data.stars_sha256 !== datasetSha256) {
    throw new DatasetError('dataset-meta.stars_sha256 does not match stars.json bytes');
  }
  if (meta.data.repo_count !== stars.data.repos.length) {
    throw new DatasetError('dataset-meta.repo_count does not match stars.json');
  }

  return { stars: stars.data, meta: meta.data, datasetSha256, repos: stars.data.repos };
}
