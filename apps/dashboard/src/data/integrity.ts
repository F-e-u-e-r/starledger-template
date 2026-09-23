/**
 * Byte-level artifact integrity, shared by every loader.
 *
 * The publication contract is a BYTE contract: each `*_sha256` in a meta
 * document is generated over the exact bytes of its artifact. Verifying that
 * digest against `await response.text()` does NOT honour it — `text()` runs a
 * UTF-8 decode first, which strips a leading BOM and rewrites malformed
 * sequences, so distinct byte strings that decode alike hash alike and a
 * mutated transport body passes the check meant to reject it.
 *
 * Every loader therefore digests the received bytes and only decodes AFTER the
 * digest matches. Decoding second is what makes the guarantee real; a loader
 * that decodes first has already destroyed the evidence.
 *
 * Pinned by `integrity-bytes.test.ts` across all four loaders, with both a
 * BOM case and a non-BOM byte mutation that decodes to identical text (so the
 * behaviour cannot regress into special-casing one prefix).
 */
export async function sha256HexOfBytes(bytes: ArrayBuffer): Promise<string> {
  // Wrap in a view rather than passing the ArrayBuffer straight through. A
  // buffer produced by `Response.arrayBuffer()` can come from a different
  // realm than the SubtleCrypto implementation, and the identity check then
  // rejects it — observed as `2nd argument is not instance of ArrayBuffer`,
  // which the loaders' fail-soft catch turned into a SILENT "unavailable".
  // That is how the production default path stayed unexercised: every test
  // injected its own loader, so nothing ever ran this line for real.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Read a response body as bytes, verify its digest, and decode only on success.
 * Returns `null` on an integrity mismatch; callers map that to their OWN
 * failure semantics (a typed throw for the canonical dataset, a fail-soft
 * `null` for the optional layers) — this helper deliberately imposes none.
 *
 * The decode is non-fatal by design: a matching digest already proves the bytes
 * are exactly the published artifact, so there is nothing left to guard here.
 */
export async function readBytesVerified(
  res: Response,
  expectedSha256: string,
): Promise<string | null> {
  const bytes = await res.arrayBuffer();
  if ((await sha256HexOfBytes(bytes)) !== expectedSha256) return null;
  // `ignoreBOM: true` means "do NOT strip a leading BOM" — it is treated as an
  // ordinary character. That is deliberate: the default decoder SWALLOWS a BOM,
  // so a BOM-prefixed artifact whose digest covers the BOM would parse here
  // while the build-side `Buffer.toString('utf8')` keeps it and JSON.parse
  // rejects. Build and runtime must accept exactly the same artifacts; with
  // this flag both refuse a BOM instead of disagreeing about it.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/**
 * Read a META document verbatim.
 *
 * `Response.json()` decodes with a BOM-STRIPPING decoder, so a BOM-prefixed
 * meta parses at runtime while the build's `Buffer.toString('utf8')` keeps
 * U+FEFF and `JSON.parse` rejects it — the two ends accepting different
 * artifacts. Fixing that for the artifact body alone left the META half of
 * every pair diverging (review finding). Both halves now decode the same way:
 * a BOM is an ordinary character and JSON parsing refuses it on both sides.
 *
 * Throws whatever `JSON.parse` throws; callers map it onto their own failure
 * semantics.
 */
export async function readMetaJson(res: Response): Promise<unknown> {
  return parseMetaJson(await readMetaBytes(res));
}

/** The transport half — separated so a stream failure can be typed as `fetch`. */
export async function readMetaBytes(res: Response): Promise<ArrayBuffer> {
  return res.arrayBuffer();
}

/** The parse half — separated so malformed JSON can be typed as `schema`. */
export function parseMetaJson(bytes: ArrayBuffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes));
}
