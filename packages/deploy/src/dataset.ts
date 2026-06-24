import { createHash } from 'node:crypto';
import {
  type DatasetMeta,
  DatasetMetaSchema,
  type StarsFile,
  StarsFileSchema,
} from '@starred/schema';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export class DatasetIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetIntegrityError';
  }
}

export interface VerifiedDataset {
  stars: StarsFile;
  meta: DatasetMeta;
  sha256: string;
}

/**
 * Validate the stars + dataset-meta bytes exactly as the in-browser loader will,
 * BEFORE they are shipped: both parse + schema-validate, the stars bytes hash to
 * `dataset-meta.stars_sha256`, `repo_count` matches, and node_ids are unique.
 * Throws {@link DatasetIntegrityError} on any discrepancy; never mutates input.
 */
export function verifyDatasetIntegrity(starsText: string, metaText: string): VerifiedDataset {
  let starsJson: unknown;
  let metaJson: unknown;
  try {
    starsJson = JSON.parse(starsText);
  } catch {
    throw new DatasetIntegrityError('stars.json is not valid JSON');
  }
  try {
    metaJson = JSON.parse(metaText);
  } catch {
    throw new DatasetIntegrityError('dataset-meta.json is not valid JSON');
  }

  const meta = DatasetMetaSchema.safeParse(metaJson);
  if (!meta.success) throw new DatasetIntegrityError('dataset-meta.json failed schema validation');
  const stars = StarsFileSchema.safeParse(starsJson);
  if (!stars.success) throw new DatasetIntegrityError('stars.json failed schema validation');

  const seen = new Set<string>();
  for (const repo of stars.data.repos) {
    if (seen.has(repo.node_id)) {
      throw new DatasetIntegrityError(`duplicate node_id ${repo.node_id}`);
    }
    seen.add(repo.node_id);
  }

  const hash = sha256Hex(starsText);
  if (meta.data.stars_sha256 !== hash) {
    throw new DatasetIntegrityError('dataset-meta.stars_sha256 does not match stars.json bytes');
  }
  if (meta.data.repo_count !== stars.data.repos.length) {
    throw new DatasetIntegrityError('dataset-meta.repo_count does not match stars.json');
  }

  return { stars: stars.data, meta: meta.data, sha256: hash };
}
