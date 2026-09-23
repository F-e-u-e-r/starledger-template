import { describe, expect, it } from 'vitest';
import { AnnotationSchema } from '../src/annotation';
import { serializeAnnotations } from '../src/artifact';
import { buildAiAnnotationsMeta } from '../src/meta-build';
import {
  CanonicalSummarySchema,
  normalizeSummary,
  OptionalModelLabelSchema,
  RawSummarySchema,
} from '../src/scalars';
import { makeAnnotation } from './helpers';

describe('AI scalar contracts', () => {
  it('TIME-1: accepts canonical UTC Z timestamps', () => {
    expect(
      AnnotationSchema.safeParse(
        makeAnnotation({
          generation: { ...makeAnnotation().generation, generated_at: '2026-06-20T12:34:56Z' },
        }),
      ).success,
    ).toBe(true);
    expect(() =>
      buildAiAnnotationsMeta({
        annotationsBytes: serializeAnnotations([makeAnnotation()]),
        annotationCount: 1,
        datasetSha256: 'c'.repeat(64),
        generatedAt: '2026-06-20T12:34:56Z',
      }),
    ).not.toThrow();
  });

  it('TIME-2/TIME-3/STRICT-2: rejects offsets, date-only values, and arbitrary text', () => {
    for (const generated_at of ['2026-06-20T20:34:56+08:00', '2026-06-20', 'tomorrow']) {
      expect(
        AnnotationSchema.safeParse({
          ...makeAnnotation(),
          generation: { ...makeAnnotation().generation, generated_at },
        }).success,
      ).toBe(false);
    }
  });

  it('TIME-4: serialization preserves normalized UTC Z timestamps', () => {
    const bytes = serializeAnnotations([
      makeAnnotation({
        generation: { ...makeAnnotation().generation, generated_at: '2026-06-20T12:34:56Z' },
      }),
    ]);
    expect(JSON.parse(bytes).annotations[0].generation.generated_at).toBe('2026-06-20T12:34:56Z');
  });

  it('normalizes summary whitespace and Unicode deterministically', () => {
    expect(normalizeSummary(' Café  toolkit\r\nfor\tdevelopers. ')).toBe(
      'Café toolkit for developers.',
    );
  });
});

describe('SEC-A: canonical summary rejects deceptive format characters', () => {
  // >= SUMMARY_MIN_LENGTH (80), already normalized, no control/format chars.
  const baseline =
    'A deterministic command-line toolkit that helps developers ship reproducible builds every day.';

  it('accepts a clean, normalized baseline summary', () => {
    expect(baseline.length).toBeGreaterThanOrEqual(80);
    expect(CanonicalSummarySchema.safeParse(baseline).success).toBe(true);
  });

  it.each([
    ['U+202E RLO (right-to-left override)', '‮'],
    ['U+200B ZWSP (zero-width space)', '​'],
    ['U+FEFF BOM (zero-width no-break)', '﻿'],
    ['U+0085 NEL (C1 control)', ''],
    ['U+2066 LRI (bidi isolate)', '⁦'],
    ['U+200E LRM', '‎'],
    ['U+2060 WORD JOINER', '⁠'],
    ['U+061C ARABIC LETTER MARK', '؜'],
  ])('rejects a summary containing %s', (_label, ch) => {
    const poisoned = baseline.replace('developers', `develop${ch}ers`);
    expect(CanonicalSummarySchema.safeParse(poisoned).success).toBe(false);
  });

  it('still accepts ZWNJ/ZWJ — legitimate in Arabic/Persian shaping and emoji', () => {
    for (const ch of ['‌', '‍']) {
      const withJoiner = baseline.replace('developers', `develop${ch}ers`);
      expect(CanonicalSummarySchema.safeParse(withJoiner).success).toBe(true);
    }
  });

  it('applies the same guard to the rendered model_label', () => {
    expect(OptionalModelLabelSchema.safeParse('claude-‮opus').success).toBe(false);
    expect(OptionalModelLabelSchema.safeParse('claude-opus-4').success).toBe(true);
    expect(OptionalModelLabelSchema.safeParse(null).success).toBe(true);
  });
});

describe('SEC-A: summary rejects embedded URLs (links, not markup)', () => {
  const baseline =
    'A deterministic command-line toolkit that helps developers ship reproducible builds every day.';
  const withInsert = (phrase: string): string =>
    baseline.replace('developers', `developers (${phrase})`);

  it.each([
    ['http scheme', 'http://example.com/pwn'],
    ['https scheme', 'https://example.com'],
    ['ftp scheme', 'ftp://files.example.com'],
    ['non-web scheme git://', 'git://host/repo.git'],
    ['file scheme', 'file:///etc/passwd'],
    ['uppercase HTTP://', 'HTTP://Example.COM'],
    ['protocol-relative //dotted.host', '//cdn.example.com/p'],
    ['//host after a punctuation boundary', '=//cdn.example.com/p'],
    ['www host', 'www.example.com'],
    ['uppercase WWW.', 'WWW.Example.COM'],
    // fullwidth h t t p s ： ／ ／ — NFC-stable (so it passes the normalized refine),
    // caught only because hasUrl also probes the NFKC-folded copy.
    ['fullwidth https look-alike (NFKC)', 'ｈｔｔｐｓ：／／evil.example'],
  ])('rejects a summary containing a %s (canonical and raw)', (_label, url) => {
    const poisoned = withInsert(`see ${url}`);
    expect(CanonicalSummarySchema.safeParse(poisoned).success).toBe(false);
    expect(RawSummarySchema.safeParse(poisoned).success).toBe(false);
  });

  it.each([
    ['an HTTP client (no scheme)', 'an HTTP client and daemon'],
    ['HTTPS as a plain word', 'served over HTTPS'],
    ['a Node.js dotted name', 'that run on Node.js'],
    ['a generic type List<T>', 'returning a List<T>'],
    ['an array index arr[0]', 'reading arr[0] first'],
    ['a // floor-division operator', 'using // for floor division'],
    // round-2: the refined regex must NOT false-positive on these.
    ['a //go:build directive (no dotted host)', 'parsing //go:build directives'],
    ['a bare "://" with no scheme', 'a parser for ://-style transport'],
    ['a non-ASCII letter before www', 'handling αwww.value identifiers'],
    // round-3: scheme-label words and identifier boundaries (_ / -) must NOT FP.
    ['the "Magnet:" app name (bare scheme label)', 'named Magnet: a tiling window helper'],
    ['an underscore identifier (parse_www.config)', 'exposing parse_www.config knobs'],
    ['a hyphen identifier (config-www.local)', 'reading config-www.local settings'],
    // DOCUMENTED RESIDUALS: bare scheme-less domains and non-`//` schemes stay allowed —
    // blocking them false-positives on prose; the plain-text render + prompt bound them.
    ['a bare scheme-less domain (residual, allowed)', 'documented at evil.com/get'],
    ['a bare mailto scheme (residual, allowed)', 'contact via mailto:ops@example'],
  ])('still accepts technical prose with %s (canonical and raw)', (_label, phrase) => {
    const summary = withInsert(phrase);
    expect(CanonicalSummarySchema.safeParse(summary).success).toBe(true);
    expect(RawSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('rejects (fast, no ReDoS) an oversized crafted string', () => {
    // Without the length short-circuit in hasUrl the scheme alternative backtracks
    // polynomially; the length refine rejects it regardless, this asserts it stays cheap.
    const huge = 'a'.repeat(20_000);
    expect(CanonicalSummarySchema.safeParse(huge).success).toBe(false);
    expect(RawSummarySchema.safeParse(huge).success).toBe(false);
  });
});
