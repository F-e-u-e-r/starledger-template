import { createHash } from 'node:crypto';

/**
 * Lowercase-hex SHA-256 of the exact UTF-8 bytes (mirrors the exporter). This is
 * the ONLY `node:crypto` user in the package, isolated in its own module so the
 * schema contracts (`./contracts`) stay browser-safe for in-browser validation.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
