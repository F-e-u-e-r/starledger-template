/**
 * Optional M2 skills-classification loading — FAIL-SOFT (P7 §4.10). Like
 * {@link loadAnnotations}, every failure resolves to `null`: a missing,
 * malformed, mis-hashed, schema-invalid, version-unsupported, or internally
 * inconsistent artifact pair can never prevent the canonical dashboard from
 * rendering. Validation is NEVER fail-open: the artifact is accepted as a
 * validated whole or rejected as a whole — no per-record salvage.
 *
 * Both files are validated via the crypto-free
 * `@starred/skills-schema/contracts` entrypoint — the SAME Zod contract the
 * generator publishes with, zero drift: strict meta (literal versions,
 * lineage hashes), strict artifact (I-1..I-6), then the stars-independent
 * `checkSkillsMetaConsistency` (C-1..C-4 + A-1..A-3).
 *
 * PROVENANCE STAYS PROVENANCE (§2.1, locked decision 3): this loader's only
 * inputs are the two skills files — it holds no live stars hash, so
 * `generated_against_stars_sha256` structurally CANNOT act as a freshness
 * gate here. The value is exposed on the result for M2.4's soft note;
 * the loader draws no conclusion from it.
 *
 * The loader also never resolves anything (locked decision 4): it loads
 * exactly the resolved records the generator emitted; unresolved source
 * entries surface only as counts.
 */
import {
  SkillsClassificationMetaSchema,
  SkillsClassificationSchema,
  checkSkillsMetaConsistency,
  type SkillsCategory,
  type SkillsScope,
} from '@starred/skills-schema/contracts';
import { readBytesVerified, readMetaJson } from './integrity';

/** Runtime classification for one starred repo (joined by node_id only). */
export interface RepoSkillsClassification {
  primaryCategoryId: string;
  secondaryCategoryIds: string[];
  summary: string;
}

export interface LoadedSkillsClassification {
  /** Classifications keyed by canonical repository node_id (the only join key). */
  byNodeId: Map<string, RepoSkillsClassification>;
  /** The full taxonomy in canonical `order` (M2.4 renders labels/badges from this). */
  categories: SkillsCategory[];
  scope: SkillsScope;
  taxonomyVersion: string;
  generatedAt: string;
  /** Provenance ONLY (§2.1) — exposed for M2.4's soft note, never a gate. */
  generatedAgainstStarsSha256: string;
  /** Generation-time snapshot statistics (§4.4 diagnostics; not live-recomputed). */
  coverage: { matched: number; unclassified: number; unresolved: number };
}

/**
 * Lifecycle of the optional skills layer — the M0 three-state model
 * (P7 §2.2/§4.10): `loading` from initialization until resolution completes;
 * `unavailable` only after a definitive failure. Never `Data | null`.
 */
export type SkillsClassificationStatus = 'loading' | 'ready' | 'unavailable';

export interface SkillsClassificationLoadOptions {
  base?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Load + verify the optional skills-classification artifacts, mirroring the
 * AI loader's meta → sha-busted content → byte-verify → parse flow, but
 * against the M2 contract: `null` on ANY problem (HTTP error, invalid JSON,
 * schema violation incl. unsupported literal versions, hash mismatch,
 * meta↔artifact inconsistency). The caller treats `null` as
 * "classification unavailable" and renders canonically.
 */
export async function loadSkillsClassification(
  opts: SkillsClassificationLoadOptions = {},
): Promise<LoadedSkillsClassification | null> {
  const base = opts.base ?? '/';
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const metaRes = await doFetch(`${base}skills-classification-meta.json`, {
      cache: 'no-cache',
    });
    if (!metaRes.ok) return null;
    const metaParsed = SkillsClassificationMetaSchema.safeParse(await readMetaJson(metaRes));
    if (!metaParsed.success) return null;
    const meta = metaParsed.data;

    const artifactRes = await doFetch(
      `${base}skills-classification.json?sha=${meta.classification_sha256}`,
    );
    if (!artifactRes.ok) return null;
    // Byte integrity is MANDATORY — no bypass exists on this surface — and it
    // is verified over the RECEIVED BYTES, decoding only afterwards. Hashing
    // decoded text would accept a body whose bytes differ from the digest but
    // decode alike (a leading BOM, a malformed sequence): review finding F6,
    // pinned in `integrity-bytes.test.ts` with a BOM case AND a non-BOM case.
    const artifactText = await readBytesVerified(artifactRes, meta.classification_sha256);
    if (artifactText === null) {
      return null; // integrity mismatch → fail-soft (classification is optional)
    }

    let json: unknown;
    try {
      json = JSON.parse(artifactText);
    } catch {
      return null;
    }
    // Whole-artifact contract or nothing — a partial parse is never `ready`.
    const artifactParsed = SkillsClassificationSchema.safeParse(json);
    if (!artifactParsed.success) return null;
    const artifact = artifactParsed.data;

    if (checkSkillsMetaConsistency(meta, artifact).length > 0) return null;

    const byNodeId = new Map<string, RepoSkillsClassification>();
    for (const entry of artifact.entries) {
      if (entry.node_id === null) continue; // unresolved: counts only, never joined
      byNodeId.set(entry.node_id, {
        primaryCategoryId: entry.primary_category_id,
        secondaryCategoryIds: [...entry.secondary_category_ids],
        summary: entry.summary,
      });
    }

    return {
      byNodeId,
      categories: artifact.categories.map((category) => ({ ...category })),
      scope: { ...artifact.scope },
      taxonomyVersion: meta.taxonomy_version,
      generatedAt: meta.generated_at,
      generatedAgainstStarsSha256: meta.generated_against_stars_sha256,
      coverage: {
        matched: meta.present_repo_count,
        unclassified: meta.unclassified_repo_count,
        unresolved: meta.unresolved_entry_count,
      },
    };
  } catch {
    return null; // any unexpected failure is non-fatal for optional enrichment
  }
}
