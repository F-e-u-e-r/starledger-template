import { HttpsUrlSchema } from '@starred/schema';
import { z } from 'zod';

export const DISCOVERY_SCHEMA_VERSION = 1;

export const DISCOVERY_VERSION = '0.1.0';

export const SourceKindSchema = z.enum([
  'manual',
  'notifier',
  'fixture',
  'future-telegram',
  'future-youtube',
  'future-web',
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const DiscoverySourceSchema = z
  .object({
    kind: SourceKindSchema,
    source_id: z.string().min(1),
    source_url: HttpsUrlSchema.optional(),
    observed_at: z.string().min(1),
    raw_ref: z.string().optional(),
  })
  .strict();
export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;

export const CandidateStatusSchema = z.enum(['candidate', 'dismissed', 'promoted']);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const DiscoveryCandidateSchema = z
  .object({
    node_id: z.string().min(1),
    owner: z.string().min(1),
    name: z.string().min(1),
    full_name: z.string().min(1),
    html_url: HttpsUrlSchema,
    description: z.string().nullable(),
    homepage_url: z.string().nullable(),
    primary_language: z.string().nullable(),
    stargazer_count: z.number().int().nonnegative().nullable(),
    archived: z.boolean(),
    disabled: z.boolean(),
    fork: z.boolean(),
    pushed_at: z.string().nullable(),
    discovered_at: z.string().min(1),
    first_seen_source: DiscoverySourceSchema,
    sources: z.array(DiscoverySourceSchema).min(1),
    status: CandidateStatusSchema,
    decision_reason: z.string().optional(),
  })
  .strict();
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidateSchema>;

export const DiscoveryCandidatesFileSchema = z
  .object({
    schema_version: z.literal(DISCOVERY_SCHEMA_VERSION),
    candidates: z.array(DiscoveryCandidateSchema),
  })
  .strict();
export type DiscoveryCandidatesFile = z.infer<typeof DiscoveryCandidatesFileSchema>;

export const DiscoveryCandidatesMetaSchema = z
  .object({
    schema_version: z.literal(DISCOVERY_SCHEMA_VERSION),
    generated_at: z.string().min(1),
    dataset_sha: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256'),
    candidate_count: z.number().int().nonnegative(),
    source_count: z.number().int().nonnegative(),
    generator_version: z.string().min(1),
  })
  .strict();
export type DiscoveryCandidatesMeta = z.infer<typeof DiscoveryCandidatesMetaSchema>;
