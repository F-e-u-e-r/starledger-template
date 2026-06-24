import { z } from 'zod';
import { SUMMARY_MAX_LENGTH, SUMMARY_MIN_LENGTH } from './taxonomy';

function hasCanonicalControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function hasRawTextControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export const UtcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith('Z'), {
    message: 'must be a UTC timestamp ending in Z',
  });

/**
 * Opaque Git object id from GitHub README metadata. It may be SHA-1 or SHA-256
 * depending on repository/storage evolution; it is not StarLedger's own SHA-256
 * fingerprint.
 */
export const GitObjectOidSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !hasCanonicalControlCharacter(value), {
    message: 'must not contain control characters',
  });

export function normalizeSummary(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

export const RawSummarySchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => !hasRawTextControlCharacter(value), {
    message: 'summary must not contain control characters',
  });

export const CanonicalSummarySchema = z
  .string()
  .min(SUMMARY_MIN_LENGTH)
  .max(SUMMARY_MAX_LENGTH)
  .refine((value) => !hasCanonicalControlCharacter(value), {
    message: 'summary must not contain control characters',
  })
  .refine((value) => value === normalizeSummary(value), {
    message: 'summary must be normalized',
  });

export function normalizeOptionalModelLabel(value: string | null): string | null {
  if (value === null) return null;
  return value
    .normalize('NFC')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export const RawModelLabelSchema = z
  .string()
  .min(1)
  .max(256)
  .nullable()
  .refine((value) => value === null || !hasCanonicalControlCharacter(value), {
    message: 'model_label must not contain control characters',
  });

export const OptionalModelLabelSchema = z
  .string()
  .min(1)
  .max(128)
  .nullable()
  .refine((value) => value === null || !hasCanonicalControlCharacter(value), {
    message: 'model_label must not contain control characters',
  })
  .refine((value) => value === normalizeOptionalModelLabel(value), {
    message: 'model_label must be normalized',
  });
