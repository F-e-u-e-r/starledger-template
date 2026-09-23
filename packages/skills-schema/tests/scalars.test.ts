import { describe, expect, it } from 'vitest';
import {
  Hex64Schema,
  NameWithOwnerSchema,
  NodeIdSchema,
  SlugSchema,
  UtcTimestampSchema,
  normalizePlainText,
  plainTextSchema,
} from '../src/scalars';

describe('normalizePlainText', () => {
  it('NFC-normalizes, collapses whitespace runs (incl. CRLF), trims', () => {
    expect(normalizePlainText('  á  b\r\nc\t d  ')).toBe('á b c d');
  });

  it('is idempotent', () => {
    const once = normalizePlainText('x \n y');
    expect(normalizePlainText(once)).toBe(once);
  });
});

describe('plainTextSchema', () => {
  const schema = plainTextSchema(1, 40);

  it('accepts normalized bounded text', () => {
    expect(schema.safeParse('Curated one-liner.').success).toBe(true);
  });

  it.each([
    ['C0 control', 'a\u0007b'],
    ['DEL', 'a\u007fb'],
    ['C1 control (NEL)', 'a\u0085b'],
    ['RLO bidi override', 'a\u202eb'],
    ['bidi isolate', 'a\u2066b'],
    ['zero-width space', 'a\u200bb'],
    ['BOM', 'a\ufeffb'],
    ['word joiner', 'a\u2060b'],
    ['un-normalized double space', 'a  b'],
    ['leading space', ' ab'],
    ['NFD decomposed', 'a\u0301bc'],
    ['soft hyphen (Cf member a hand-list missed)', 'a\u00adb'],
    ['invisible separator U+2063', 'a\u2063b'],
    ['invisible times U+2062', 'a\u2062b'],
    ['tag-block character', 'a\u{e0041}b'],
  ])('rejects %s', (_name, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('keeps ZWNJ/ZWJ allowed (Arabic shaping, emoji sequences)', () => {
    expect(schema.safeParse('\u{1F469}\u200d\u{1F4BB} dev').success).toBe(true);
  });

  it('accepts URLs — deliberate difference from the AI scalars (owner-curated source)', () => {
    expect(schema.safeParse('see https://example.com').success).toBe(true);
  });

  it('enforces bounds', () => {
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse('x'.repeat(41)).success).toBe(false);
  });
});

describe('SlugSchema', () => {
  it.each(['verification-qa', 'a', 'x1-y2-z3'])('accepts %s', (value) => {
    expect(SlugSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['uppercase', 'Verification'],
    ['underscore', 'a_b'],
    ['leading hyphen', '-a'],
    ['trailing hyphen', 'a-'],
    ['double hyphen', 'a--b'],
    ['empty', ''],
    ['overlong', 'a'.repeat(65)],
  ])('rejects %s', (_name, value) => {
    expect(SlugSchema.safeParse(value).success).toBe(false);
  });
});

describe('Hex64Schema / UtcTimestampSchema', () => {
  it('accepts a lowercase 64-hex digest and a Z-suffixed timestamp', () => {
    expect(Hex64Schema.safeParse('0123456789abcdef'.repeat(4)).success).toBe(true);
    expect(UtcTimestampSchema.safeParse('2026-08-13T07:30:30Z').success).toBe(true);
  });

  it('rejects offset timestamps and bare dates', () => {
    expect(UtcTimestampSchema.safeParse('2026-08-13T07:30:30+00:00').success).toBe(false);
    expect(UtcTimestampSchema.safeParse('2026-08-13').success).toBe(false);
  });
});

describe('NodeIdSchema', () => {
  it('accepts legacy and current GitHub id shapes without pinning a format', () => {
    expect(NodeIdSchema.safeParse('MDEwOlJlcG9zaXRvcnkxMjM=').success).toBe(true);
    expect(NodeIdSchema.safeParse('R_kgDOLxyz').success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['overlong', 'R'.repeat(257)],
    ['control character', 'R_\u0000x'],
    ['C1 control (identity scalars ban ALL controls)', 'R_\u0085x'],
    ['ZWJ (no joiner exception for ids)', 'R_\u200dx'],
    ['zero-width space', 'R_\u200bx'],
  ])('rejects %s', (_name, value) => {
    expect(NodeIdSchema.safeParse(value).success).toBe(false);
  });
});

describe('NameWithOwnerSchema', () => {
  it.each(['a/b', 'obra/superpowers', 'F-e-u-e-r/github-starred'])('accepts %s', (value) => {
    expect(NameWithOwnerSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['no slash', 'nobody'],
    ['two slashes', 'a/b/c'],
    ['empty owner', '/repo'],
    ['empty name', 'owner/'],
    ['whitespace', 'owner /repo'],
    ['tab', 'owner/\trepo'],
    ['overlong', `${'o'.repeat(100)}/${'r'.repeat(41)}`],
    ['control character', 'a/b\u0007'],
    ['C1 control', 'a/b\u0080c'],
    ['ZWJ joiner-disguised near-duplicate', 'obra/super\u200dpowers'],
    ['soft hyphen', 'a/b\u00adc'],
  ])('rejects %s', (_name, value) => {
    expect(NameWithOwnerSchema.safeParse(value).success).toBe(false);
  });
});
