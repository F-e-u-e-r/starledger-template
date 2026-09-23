import { createHash } from 'node:crypto';

/**
 * Lowercase-hex SHA-256 of a STRING's UTF-8 encoding (mirrors the exporter).
 * GENERATION-side by construction: hash the canonical serialization this
 * process just produced and will write verbatim as UTF-8 — for that string the
 * digest equals the byte digest of the file that lands. NEVER feed it text
 * decoded from an existing file: decoding is lossy (a BOM, a malformed
 * sequence), so byte-different files can hash alike; acceptance and integrity
 * checks over existing artifacts use {@link sha256Bytes} instead. This module
 * is the ONLY `node:crypto` user in the package, isolated so the schema
 * contracts (`./contracts`) stay browser-safe for in-browser validation.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Lowercase-hex SHA-256 of EXACT bytes. ACCEPTANCE-side: verifying an existing
 * artifact against a recorded digest hashes the received/on-disk bytes — the
 * representation the byte-strict deploy stagers and runtime loaders
 * contractually validate — never their decoding (P7 §4.10, round-9 owner
 * ruling on the decoded-text digest class).
 */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
