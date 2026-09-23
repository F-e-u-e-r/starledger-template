import { z } from 'zod';
import {
  NAME_WITH_OWNER_MAX_LENGTH,
  NAME_WITH_OWNER_MIN_LENGTH,
  NODE_ID_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from './constants';

/**
 * Free-text discipline for the skills contract (P7 §4.2). PARALLEL to (not
 * imported from) `@starred/ai-schema`'s scalars — the §4.0 ownership boundary
 * keeps the two contracts free to evolve independently, so the C0/C1/bidi/
 * zero-width rules are restated here.
 *
 * DELIBERATE difference from the AI scalars: NO URL rejection. The AI summary
 * is attacker-influenceable (a starred README steers the classifier), so it
 * rejects links; `skills-classified.md` is owner-curated and rendered
 * exclusively as plain React text children, so a URL is inert text here. Any
 * consumer that linkifies, markdown-renders, or places these fields in an
 * href/src MUST re-open this control (P7 §4.2).
 */

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * The COMPLETE invisible/steering class: every Unicode format character
 * (category Cf — bidi controls, zero-width chars, soft hyphen, invisible
 * operators, tag block, …) plus C1 controls. Enumerated lists miss members
 * (a review caught U+00AD/U+2061..64 absent from a hand-list); `\p{Cf}` is
 * closed under Unicode updates.
 */
const FORMAT_OR_C1 = /[\p{Cf}\u0080-\u009f]/u;

/**
 * Plain-text rule: format characters are rejected EXCEPT U+200C/U+200D
 * (ZWNJ/ZWJ) — legitimate in Arabic/Persian shaping and emoji ZWJ sequences
 * (same deliberate exception as the AI scalars; P7 §4.2 names it).
 */
function hasUnsafeFormatCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x200c || code === 0x200d) continue;
    if (FORMAT_OR_C1.test(ch)) return true;
  }
  return false;
}

/**
 * Identity-scalar rule (`node_id`, `source_name_with_owner`): NO exceptions —
 * ZWNJ/ZWJ have no business inside an opaque id or an `owner/name`, and a
 * joiner-disguised near-duplicate identity must fail loudly (P7 §4.2).
 */
function hasAnyFormatCharacter(value: string): boolean {
  return FORMAT_OR_C1.test(value);
}

/** Canonical plain-text form: NFC, all whitespace runs collapsed to one space, trimmed. */
export function normalizePlainText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * A bounded, normalized, control-character-free plain-text field (labels,
 * definitions, summaries, scope text, alias reasons).
 */
export function plainTextSchema(minLength: number, maxLength: number) {
  return z
    .string()
    .min(minLength)
    .max(maxLength)
    .refine((value) => !hasControlCharacter(value), {
      message: 'must not contain control characters',
    })
    .refine((value) => !hasUnsafeFormatCharacter(value), {
      message: 'must not contain bidi, zero-width, or C1 format characters',
    })
    .refine((value) => value === normalizePlainText(value), {
      message: 'must be NFC-normalized with collapsed whitespace',
    });
}

/** Lowercase kebab slug: category/scope ids (P7 §4.2). */
export const SlugSchema = z
  .string()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a lowercase kebab-case slug');

export const Hex64Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256');

export const UtcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith('Z'), {
    message: 'must be a UTC timestamp ending in Z',
  });

/**
 * Opaque GitHub repository node id. NO format regex — GitHub ships both legacy
 * (`MDEw…`) and current (`R_…`) ids, so like `CanonicalRepoSchema` we bound and
 * sanitize without pinning a shape (P7 §4.2). Control-free means ALL controls:
 * C0/DEL, C1, and every format character (no ZWNJ/ZWJ exception for ids).
 */
export const NodeIdSchema = z
  .string()
  .min(1)
  .max(NODE_ID_MAX_LENGTH)
  .refine((value) => !hasControlCharacter(value), {
    message: 'must not contain control characters',
  })
  .refine((value) => !hasAnyFormatCharacter(value), {
    message: 'must not contain C1 or format characters',
  });

/**
 * `owner/name` as written in the curated source: exactly one `/`, no
 * whitespace, no control characters (P7 §4.2). Historical record identity —
 * never displayed as live repo data.
 */
export const NameWithOwnerSchema = z
  .string()
  .min(NAME_WITH_OWNER_MIN_LENGTH)
  .max(NAME_WITH_OWNER_MAX_LENGTH)
  .refine((value) => value.split('/').length === 2, {
    message: 'must contain exactly one "/"',
  })
  .refine((value) => value.split('/').every((part) => part.length > 0), {
    message: 'owner and name must be non-empty',
  })
  .refine((value) => !/\s/.test(value), {
    message: 'must not contain whitespace',
  })
  .refine((value) => !hasControlCharacter(value), {
    message: 'must not contain control characters',
  })
  .refine((value) => !hasAnyFormatCharacter(value), {
    message: 'must not contain C1 or format characters',
  });
