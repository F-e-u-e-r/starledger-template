// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// M3-ID-4 / F-B / F-D — PARSER-based, not regex. index.html is parsed as HTML and
// favicon.svg as image/svg+xml, so single-quoted, double-quoted, and unquoted
// spellings all normalise to the same parsed attributes: quote style is no longer an
// escape surface (R3 boundary). The RESOLVED build output is the build gate
// (M3-ID-5): Vite rewrites `%BASE_URL%` to the deployment base derived by the
// GitHub Actions build from `GITHUB_REPOSITORY`, so for THIS repo it is
// `/starledger/favicon.svg`, for a template fork `/<fork-repo>/favicon.svg`, and
// `/favicon.svg` at a domain root — `/starledger/` is the resolved value here, not
// a universal path. The RENDERED favicon colour is the browser gate. These
// pin the parsed SOURCE contract — parsed semantics, not source spelling.
const appRoot = resolve(import.meta.dirname, '../../..');
const indexHtml = readFileSync(resolve(appRoot, 'index.html'), 'utf8');
const faviconSrc = readFileSync(resolve(appRoot, 'public/favicon.svg'), 'utf8');

describe('M3 identity — favicon wiring parsed from index.html (M3-ID-4, F-B)', () => {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html');
  // An APPLIED favicon is an HTML <link> that is a DIRECT CHILD of <head>: a link
  // nested in <svg>/<body> (foreign / SVG-namespace) parses and preserves rel/href
  // but is never applied as a favicon. Scope to `head > link` in the HTML namespace,
  // NOT any `<link>` anywhere in the document (invariant i).
  const icons = [...doc.querySelectorAll('head > link[rel~="icon"]')].filter(
    (el) => el.namespaceURI === 'http://www.w3.org/1999/xhtml',
  );

  it('declares exactly one rel~="icon" HTML <link> as a direct child of <head>', () => {
    expect(icons).toHaveLength(1);
  });

  it('the link is an APPLIED SVG favicon: href %BASE_URL%favicon.svg, type image/svg+xml, no non-matching media', () => {
    const href = icons[0]?.getAttribute('href') ?? '';
    expect(href).toBe('%BASE_URL%favicon.svg');
    expect(href).not.toMatch(/^data:/i);
    expect(href).not.toMatch(/^[a-z][a-z0-9+.-]*:\/\//i); // scheme://host
    expect(href).not.toMatch(/^\/\//); // //host — protocol-relative
    // MIME must match the SVG asset — a wrong `type` (e.g. text/plain) can make the
    // browser reject the icon (invariant i).
    expect(icons[0]?.getAttribute('type')).toBe('image/svg+xml');
    // A never-matching `media` (e.g. "not all") parses but is never applied (i).
    expect(icons[0]?.getAttribute('media')).toBeNull();
  });
});

describe('M3 identity — favicon.svg parsed as SVG: the `>_` prompt glyph in emerald (supersedes Concept-B + the F-1 blue accent; see ADR-005)', () => {
  const doc = new DOMParser().parseFromString(faviconSrc, 'image/svg+xml');
  const els = [...doc.querySelectorAll('*')];
  const attrsOf = (el: Element) =>
    Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));

  it('parses as valid SVG in the SVG namespace (no parser error; root <svg>; every element SVG-namespaced)', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.tagName.toLowerCase()).toBe('svg');
    expect(doc.documentElement.namespaceURI).toBe(SVG_NS);
    for (const el of els) expect(el.namespaceURI).toBe(SVG_NS);
  });

  it('ships VISIBLE — no element suppresses the favicon via opacity/visibility/display, any spelling (v)', () => {
    for (const el of [doc.documentElement, ...els]) {
      for (const attr of ['opacity', 'fill-opacity', 'stroke-opacity']) {
        const v = el.getAttribute(attr);
        if (v !== null) expect(Number.parseFloat(v)).toBeGreaterThan(0);
      }
      const vis = el.getAttribute('visibility');
      if (vis !== null) expect(['hidden', 'collapse']).not.toContain(vis.trim().toLowerCase());
      const disp = el.getAttribute('display');
      if (disp !== null) expect(['none', 'contents']).not.toContain(disp.trim().toLowerCase());
    }
  });

  it('uses ONLY the fixed element vocabulary — svg/title/rect/text; no <style>/<filter>/<image>/<g>/<path>/<line>/etc.', () => {
    const ALLOWED = new Set(['svg', 'title', 'rect', 'text']);
    expect(els.length).toBeGreaterThan(0);
    for (const el of els) expect(ALLOWED.has(el.tagName.toLowerCase())).toBe(true);
  });

  it('is the canonical `>_` favicon — a dark rounded tile + the emerald `>_` glyph, exact parsed attribute maps (iii/iv)', () => {
    // Fixed asset: pin the root attrs, the child order, and each shape's full parsed map.
    expect(doc.querySelectorAll('svg')).toHaveLength(1);
    expect(
      Object.fromEntries(
        [...doc.documentElement.attributes]
          .filter((a) => a.name !== 'xmlns')
          .map((a) => [a.name, a.value]),
      ),
    ).toEqual({ viewBox: '0 0 32 32', width: '32', height: '32' });
    expect([...doc.documentElement.children].map((el) => el.tagName.toLowerCase())).toEqual([
      'title',
      'rect',
      'text',
    ]);
    doc.querySelectorAll('title, rect, text').forEach((el) => expect(el.children.length).toBe(0));
    // The tile: a full-bleed dark rounded rect.
    expect(attrsOf(doc.querySelector('rect')!)).toEqual({
      width: '32',
      height: '32',
      rx: '7',
      fill: '#080b0a',
    });
    // The glyph: the emerald `>_`, bold, monospace, centred.
    const text = doc.querySelector('text')!;
    expect(text.textContent?.trim()).toBe('>_');
    expect(text.getAttribute('fill')).toBe('#35e0a1');
    expect(text.getAttribute('font-weight')).toBe('700');
    expect(text.getAttribute('text-anchor')).toBe('middle');
    expect((text.getAttribute('font-family') ?? '').toLowerCase()).toMatch(/mono/);
    expect(text.getAttribute('x')).toBe('16');
    expect(text.getAttribute('y')).toBe('22');
  });

  it('paints ONLY the two static brand colours — tile #080b0a + emerald #35e0a1; no inline style, no other hue', () => {
    const paints: string[] = [];
    for (const el of els) {
      expect(el.getAttribute('style')).toBeNull();
      for (const attr of ['fill', 'stroke']) {
        const v = el.getAttribute(attr);
        if (v !== null) paints.push(v.trim().toLowerCase());
      }
    }
    expect(paints.length).toBeGreaterThan(0);
    for (const p of paints) expect(['#080b0a', '#35e0a1', 'none']).toContain(p);
    // The emerald accent is actually used (the identity colour, not just the tile).
    expect(paints).toContain('#35e0a1');
  });
});
