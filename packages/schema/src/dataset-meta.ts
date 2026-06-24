import { z } from 'zod';
import { SCHEMA_VERSION } from './stars';

/**
 * Committed alongside stars.json, and ONLY rewritten when stars.json content
 * changes. Holds the dataset fingerprint so the workflow can implement
 * commit-on-change without re-hashing, and so consumers can detect updates.
 */
export const DatasetMetaSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    dataset_generated_at: z.string(),
    stars_sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256'),
    repo_count: z.number().int().nonnegative(),
  })
  .strict();

export type DatasetMeta = z.infer<typeof DatasetMetaSchema>;
