import { z } from 'zod';
import { CanonicalRepoSchema } from './canonical-repo';

export const SCHEMA_VERSION = '1.0';

/**
 * The canonical dataset. This is the ONLY committed file that changes on every
 * star delta. It deliberately contains NO timestamps and NO enumeration
 * provenance, so that the GraphQL path and the REST-fallback path produce a
 * byte-identical document for the same logical dataset (invariant I2 / DET-1).
 */
export const StarsFileSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    repos: z.array(CanonicalRepoSchema),
  })
  .strict();

export type StarsFile = z.infer<typeof StarsFileSchema>;
