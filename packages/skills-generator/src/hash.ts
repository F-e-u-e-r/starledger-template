import { createHash } from 'node:crypto';

/** sha256 over exact UTF-8 bytes — the integrity/provenance digest (§4.4). */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
