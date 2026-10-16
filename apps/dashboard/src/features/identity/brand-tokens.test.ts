import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WS4-SL brand-token contrast contract (ADR-005 / docs/brand-tokens.md).
 *
 * This is a REAL gate, not a change detector: it parses the ACTUAL token values
 * out of styles.css and recomputes WCAG 2.x contrast from the W3C relative-
 * luminance formula (the external authority), then asserts the published
 * thresholds. Edit a token to a failing value — darken the dark accent, drop the
 * light caution, put white back on an emerald fill — and the computed ratio
 * crosses the line and this test goes red. (Proven able to fail: temporarily
 * setting the dark `--accent` to `#0a3a28` takes `accent on bg` to ~1.55 and
 * fails `>= 4.5`.)
 */

const css = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8');

// --- WCAG relative luminance + contrast (W3C definition) ---
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
/** Composite `rgba(r,g,b,a)` over an opaque hex background. */
function over(rgba: string, bgHex: string): [number, number, number] {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgb/rgba value: ${rgba}`);
  const parts = (m[1] ?? '').split(',').map((x) => parseFloat(x.trim()));
  const r = parts[0] ?? 0;
  const g = parts[1] ?? 0;
  const b = parts[2] ?? 0;
  const a = parts[3] ?? 1;
  const bg = hexToRgb(bgHex);
  return [
    Math.round(a * r + (1 - a) * bg[0]),
    Math.round(a * g + (1 - a) * bg[1]),
    Math.round(a * b + (1 - a) * bg[2]),
  ];
}
function contrast(fg: string, bgHex: string): number {
  const l1 = luminance(fg.startsWith('#') ? hexToRgb(fg) : over(fg, bgHex));
  const l2 = luminance(hexToRgb(bgHex));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Extract a `:root { ... }` token map (brace-balanced) ---
function tokenBlock(source: string): Record<string, string> {
  const open = source.indexOf('{');
  let depth = 0;
  let end = source.length;
  for (let i = open; i < source.length; i++) {
    if (source.charAt(i) === '{') depth++;
    else if (source.charAt(i) === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const map: Record<string, string> = {};
  for (const m of source.slice(open + 1, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const key = m[1];
    const val = m[2];
    if (key !== undefined && val !== undefined) map[key.trim()] = val.trim();
  }
  return map;
}
function req(map: Record<string, string>, name: string): string {
  const v = map[name];
  if (v === undefined) throw new Error(`missing token ${name}`);
  return v;
}

const light = tokenBlock(css.slice(css.indexOf(':root {')));
const darkMediaAt = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = tokenBlock(css.slice(css.indexOf(':root {', darkMediaAt)));

const MODES: Record<string, Record<string, string>> = { light, dark };

describe('WS4-SL brand-token contrast contract (ADR-005)', () => {
  for (const [mode, t] of Object.entries(MODES)) {
    describe(`${mode} mode`, () => {
      it('defines every brand token the contract names', () => {
        for (const name of [
          '--bg',
          '--fg',
          '--muted',
          '--border',
          '--accent',
          '--accent-muted',
          '--accent-contrast',
          '--surface',
          '--chip-bg',
          '--focus',
          '--caution',
        ]) {
          expect(t[name], `${mode} ${name}`).toBeTruthy();
        }
      });

      it('body/secondary text clears 4.5:1 on every surface', () => {
        for (const surf of [req(t, '--bg'), req(t, '--surface'), req(t, '--chip-bg')]) {
          expect(contrast(req(t, '--fg'), surf)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(req(t, '--muted'), surf)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('interactive accent clears 4.5:1 as link text on every surface', () => {
        for (const surf of [req(t, '--bg'), req(t, '--surface'), req(t, '--chip-bg')]) {
          expect(contrast(req(t, '--accent'), surf)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('text on a filled-accent control (accent-contrast on accent) clears 4.5:1', () => {
        expect(contrast(req(t, '--accent-contrast'), req(t, '--accent'))).toBeGreaterThanOrEqual(
          4.5,
        );
      });

      it('the focus ring clears 3:1 against surfaces', () => {
        expect(contrast(req(t, '--focus'), req(t, '--bg'))).toBeGreaterThanOrEqual(3);
        expect(contrast(req(t, '--focus'), req(t, '--surface'))).toBeGreaterThanOrEqual(3);
      });

      it('accent-muted clears 4.5:1 as text on every surface (it paints badge/marker TEXT, not just the >_ logotype)', () => {
        // .badge-skill / .badge-ai / .badge-discovery-candidate / .card-skill-summary
        // all use --accent-muted as `color`, so it is normal text and owes 4.5:1.
        for (const surf of [req(t, '--bg'), req(t, '--surface'), req(t, '--chip-bg')]) {
          expect(contrast(req(t, '--accent-muted'), surf)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('preserved caution/status colour stays readable (>= 4.5:1 on bg + surface)', () => {
        expect(contrast(req(t, '--caution'), req(t, '--bg'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(req(t, '--caution'), req(t, '--surface'))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it('no filled-accent control uses white text (the pre-WS4 3.10:1 regression stays fixed)', () => {
    // `#fff`/`#ffffff`/white as a `color` must never return: filled emerald needs
    // the dark/white `--accent-contrast`, not a hardcoded white that fails on the
    // bright dark-mode emerald. (`--bg: #ffffff` is a token value, not a `color:`.)
    expect(css).not.toMatch(/color:\s*(?:#fff(?:fff)?|white)\b/i);
    expect(css).toContain('var(--accent-contrast)');
  });

  it('JetBrains Mono is self-hosted via @font-face with a no-CLS fallback face', () => {
    expect(css).toMatch(/@font-face/);
    expect(css).toMatch(/'JetBrains Mono Variable'/);
    expect(css).toMatch(/'JetBrains Mono Fallback'/);
    expect(css).toMatch(/font-display:\s*swap/);
    expect(css).toMatch(/url\(['"]?\/fonts\/jetbrains-mono-[^)]+\.woff2['"]?\)/);
    expect(css).not.toMatch(/https?:\/\/[^)]*fonts/i);
  });
});
