import { createHash } from 'node:crypto';
import {
  type DatasetMeta,
  DatasetMetaSchema,
  type StarsFile,
  StarsFileSchema,
  checkCanonicalDatasetInvariants,
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
 *
 * `starsBytes` is BYTES, not text, and the parameter type says so deliberately.
 * Hashing a decoded string re-encodes it, so two byte strings that decode alike
 * (a BOM, a malformed sequence) hash alike — the build would pass an artifact
 * the byte-strict runtime loader then rejects, and for the CANONICAL dataset
 * that means the base dashboard fails closed on a file the build called sound.
 * Requiring bytes here is what keeps build-time and runtime verification
 * talking about the same thing.
 */
export function verifyDatasetIntegrity(starsBytes: Uint8Array, metaText: string): VerifiedDataset {
  const starsText = Buffer.from(starsBytes).toString('utf8');
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

  const hash = createHash('sha256').update(Buffer.from(starsBytes)).digest('hex');
  if (meta.data.stars_sha256 !== hash) {
    throw new DatasetIntegrityError('dataset-meta.stars_sha256 does not match stars.json bytes');
  }
  // Structural invariants come from the SHARED primitive so build-time and
  // runtime acceptance cannot drift apart (owner ruling R6-S1).
  const problems = checkCanonicalDatasetInvariants(stars.data, meta.data);
  if (problems.length > 0) throw new DatasetIntegrityError(problems[0]!);

  return { stars: stars.data, meta: meta.data, sha256: hash };
}
