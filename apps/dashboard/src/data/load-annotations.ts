/**
 * Optional AI enrichment loading — FAIL-SOFT. Unlike {@link loadStars} (which
 * fails closed), every failure here resolves to `null`, so a missing, malformed,
 * mis-hashed, or schema-INVALID AI artifact can never prevent the canonical
 * dashboard from rendering.
 *
 * BOTH files are validated against the SHARED public contract via the crypto-free
 * `@starred/ai-schema/contracts` entrypoint: `AiAnnotationsMetaSchema` for the
 * meta (dataset hash, UTC timestamp, no unknown fields) and `AiAnnotationsSchema`
 * for the annotations (controlled category/tag vocabulary, sorted + bounded tags,
 * canonical summary, sorted-by-node_id, no unknown fields). A hash-valid but
 * schema-invalid artifact therefore fails soft instead of displaying. Byte hashing
 * uses the browser `crypto.subtle`.
 */
import { AiAnnotationsMetaSchema, AiAnnotationsSchema } from '@starred/ai-schema/contracts';

export interface RepoAnnotation {
  category: string;
  tags: string[];
  summary: string;
  generatedAt: string;
  modelLabel: string | null;
}

export interface LoadedAnnotations {
  /** Annotations keyed by canonical repository node_id (the only join key). */
  byNodeId: Map<string, RepoAnnotation>;
  taxonomyVersion: string;
  generatedAt: string;
}

export interface AnnotationLoadOptions {
  base?: string;
  fetchImpl?: typeof fetch;
  /** Verify the annotation bytes against the meta hash (default true). */
  verifyBytes?: boolean;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Strictly validate the annotations file against the SHARED public contract; null
 * on ANY violation (fail-soft). `AiAnnotationsSchema` enforces the controlled
 * category/tag vocabulary, sorted + unique + bounded tags, canonical summary
 * bounds, the source/generation shape, sorted-by-node_id order, and rejects
 * unknown fields — so an artifact that passed the hash but not the contract is
 * never displayed.
 */
function parseAnnotations(
  json: unknown,
  expectedCount: number,
): Map<string, RepoAnnotation> | null {
  const parsed = AiAnnotationsSchema.safeParse(json);
  if (!parsed.success || parsed.data.annotations.length !== expectedCount) return null;
  const byNodeId = new Map<string, RepoAnnotation>();
  for (const annotation of parsed.data.annotations) {
    byNodeId.set(annotation.node_id, {
      category: annotation.category,
      tags: [...annotation.tags],
      summary: annotation.summary,
      generatedAt: annotation.generation.generated_at,
      modelLabel: annotation.generation.model_label,
    });
  }
  return byNodeId;
}

/**
 * Load + verify the optional AI artifacts, mirroring the canonical loader's
 * meta → sha-busted content → verify → parse flow, but resolving to `null` on
 * ANY problem (HTTP error, schema mismatch, hash mismatch, malformed annotation).
 * The caller treats `null` as "no AI" and renders canonically.
 */
export async function loadAnnotations(
  opts: AnnotationLoadOptions = {},
): Promise<LoadedAnnotations | null> {
  const base = opts.base ?? '/';
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const metaRes = await doFetch(`${base}ai-annotations-meta.json`, { cache: 'no-cache' });
    if (!metaRes.ok) return null;
    const metaParsed = AiAnnotationsMetaSchema.safeParse(await metaRes.json());
    if (!metaParsed.success) return null;
    const meta = metaParsed.data;

    const annRes = await doFetch(`${base}ai-annotations.json?sha=${meta.annotations_sha256}`);
    if (!annRes.ok) return null;
    const annText = await annRes.text();

    if (opts.verifyBytes !== false && (await sha256Hex(annText)) !== meta.annotations_sha256) {
      return null; // hash mismatch → fail-soft (no re-fetch; AI is optional)
    }

    let json: unknown;
    try {
      json = JSON.parse(annText);
    } catch {
      return null;
    }
    const byNodeId = parseAnnotations(json, meta.annotation_count);
    if (byNodeId === null) return null;

    return { byNodeId, taxonomyVersion: meta.taxonomy_version, generatedAt: meta.generated_at };
  } catch {
    return null; // any unexpected failure is non-fatal for optional enrichment
  }
}
