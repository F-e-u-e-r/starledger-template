import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { verifyDatasetIntegrity } from './dataset';
import { assertNoForbiddenFiles, DATASET_META_FILE, STARS_FILE } from './stage';

export interface VerifyOptions {
  distDir: string;
  /** Derived Pages base path, e.g. `/starledger/`. Default `/`. */
  base?: string;
}

export interface VerifyResult {
  repoCount: number;
  sha256: string;
  base: string;
}

function assetUrls(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1] ?? '')
    .filter((u) => u.includes('/assets/'));
}

/**
 * The EXACT Content-Security-Policy the built index.html must ship (SEC-B). The
 * deploy pins the WHOLE policy — every directive and its exact source list — so
 * that a dropped directive, a weakened source (e.g. adding `'unsafe-inline'`), an
 * extra/meta-ineffective directive (`frame-ancestors`), or a swap to the
 * non-enforcing `Content-Security-Policy-Report-Only` all fail the gate rather
 * than silently shipping. Change this map deliberately if the policy legitimately
 * evolves. Source lists are compared order-insensitively.
 */
const EXPECTED_CSP: Record<string, readonly string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/**
 * Parse `name="value"` attributes from a single tag string (lowercased names,
 * first occurrence wins — the order browsers honor). The leading `(?:^|\s)`
 * requires a real attribute-name boundary, so a decoy like `data-http-equiv`
 * is captured under its own name and never mistaken for `http-equiv`.
 */
function parseTagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*"([^"]*)"/g)) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? '');
  }
  return attrs;
}

/**
 * Parse a CSP policy string into a directive→sources map (directive names
 * lowercased). A DUPLICATE directive is rejected: browsers enforce only the
 * first occurrence, so a duplicate could hide a weakened first directive behind
 * a pinned-looking second one.
 */
function parseCspPolicy(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (!name) continue;
    if (map.has(name)) {
      throw new Error(
        `Content-Security-Policy has a duplicate "${name}" directive (SEC-B): browsers enforce only the first, so a duplicate can hide a weakened policy`,
      );
    }
    map.set(name, tokens);
  }
  return map;
}

/**
 * Assert the built index.html ships EXACTLY the pinned Content-Security-Policy
 * (SEC-B). GitHub Pages cannot send a CSP response header, so this meta is the
 * only backstop; the deploy must fail here rather than ship a missing, weakened,
 * report-only, or console-erroring policy. HTML comments are stripped first (a
 * commented-out CSP is not browser-enforced); the policy is read from a SINGLE
 * `<meta …>` tag whose `http-equiv` equals `Content-Security-Policy` exactly (so
 * a `-Report-Only` suffix or a later unrelated tag cannot satisfy the check), and
 * every directive's source list must match the pin exactly.
 */
function assertContentSecurityPolicy(html: string): void {
  const active = html.replace(/<!--[\s\S]*?-->/g, '');
  let policyText: string | undefined;
  for (const tag of active.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = parseTagAttributes(tag);
    if (attrs.get('http-equiv')?.toLowerCase() === 'content-security-policy') {
      policyText = attrs.get('content'); // undefined ⇒ the CSP meta has no content
      break;
    }
  }
  if (policyText === undefined) {
    throw new Error(
      'index.html is missing an enforcing Content-Security-Policy meta with a content attribute (SEC-B): Pages cannot set a CSP header, so this meta is the only backstop',
    );
  }
  const actual = parseCspPolicy(policyText);

  const extra = [...actual.keys()].filter((name) => !(name in EXPECTED_CSP));
  if (extra.length > 0) {
    throw new Error(
      `Content-Security-Policy has unexpected directive(s) "${extra.join(', ')}" (SEC-B): update the pinned policy deliberately (header-only directives such as frame-ancestors are ineffective in a <meta>)`,
    );
  }
  for (const [name, want] of Object.entries(EXPECTED_CSP)) {
    const got = actual.get(name);
    if (!got) {
      throw new Error(
        `Content-Security-Policy is missing the required "${name}" directive (SEC-B)`,
      );
    }
    const wantSorted = [...want].sort().join(' ');
    const gotSorted = [...got].sort().join(' ');
    if (wantSorted !== gotSorted) {
      throw new Error(
        `Content-Security-Policy directive "${name}" must be exactly "${want.join(' ')}" but is "${got.join(' ')}" (SEC-B): no weakening (e.g. 'unsafe-inline') is allowed`,
      );
    }
  }
}

/**
 * Validate a built + staged dist before upload (DEPLOY-1):
 *  - index.html, a non-empty assets/, and both data files exist;
 *  - the data passes schema / hash / count integrity;
 *  - no secret or telemetry files leaked into the artifact;
 *  - under a project base path, every emitted asset URL is base-prefixed (PATH-2).
 */
export function verifyBuiltArtifact(opts: VerifyOptions): VerifyResult {
  const { distDir } = opts;
  const base = opts.base ?? '/';

  const indexPath = resolve(distDir, 'index.html');
  if (!existsSync(indexPath)) throw new Error('dist/index.html is missing');
  const assetsDir = resolve(distDir, 'assets');
  if (!existsSync(assetsDir) || readdirSync(assetsDir).length === 0) {
    throw new Error('dist/assets is missing or empty');
  }

  const starsPath = resolve(distDir, STARS_FILE);
  const metaPath = resolve(distDir, DATASET_META_FILE);
  if (!existsSync(starsPath) || !existsSync(metaPath)) {
    throw new Error('dist is missing staged data files (run staging first)');
  }
  const verified = verifyDatasetIntegrity(readFileSync(starsPath), readFileSync(metaPath, 'utf8'));

  assertNoForbiddenFiles(distDir);

  const html = readFileSync(indexPath, 'utf8');
  assertContentSecurityPolicy(html);
  const assets = assetUrls(html);
  if (assets.length === 0) throw new Error('index.html references no /assets/ URLs');
  if (base !== '/') {
    const bad = assets.filter((u) => !u.startsWith(base));
    if (bad.length > 0) throw new Error(`assets not under base ${base}: ${bad.join(', ')}`);
  }

  return { repoCount: verified.meta.repo_count, sha256: verified.sha256, base };
}

/**
 * End-to-end static smoke (DEPLOY-2): serve the dist so that `<base>` maps to its
 * root, then resolve index.html, an asset, dataset-meta.json and the sha-busted
 * stars.json over HTTP and re-verify integrity — the same path the browser takes.
 */
export async function staticSmoke(opts: VerifyOptions): Promise<VerifyResult> {
  const { distDir } = opts;
  const base = opts.base ?? '/';

  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      let rel = urlPath.startsWith(base) ? urlPath.slice(base.length) : urlPath.replace(/^\/+/, '');
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const filePath = resolve(distDir, rel);
      if (!filePath.startsWith(resolve(distDir)) || !existsSync(filePath)) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.statusCode = 200;
      res.end(readFileSync(filePath));
    } catch {
      res.statusCode = 500;
      res.end('error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); // otherwise a bind failure (EPERM/EADDRINUSE) would hang
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  try {
    const metaRes = await fetch(`${origin}${base}${DATASET_META_FILE}`);
    if (!metaRes.ok) throw new Error(`${DATASET_META_FILE} → HTTP ${metaRes.status}`);
    // Decoded WITHOUT swallowing a BOM, matching both the build's
    // `Buffer.toString('utf8')` and the runtime's decoder. `Response.text()`
    // strips one, so a BOM-prefixed meta would pass this live smoke while the
    // build and the browser both refuse it (review finding).
    const metaText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      new Uint8Array(await metaRes.arrayBuffer()),
    );
    const sha = (JSON.parse(metaText) as { stars_sha256: string }).stars_sha256;

    const starsRes = await fetch(`${origin}${base}${STARS_FILE}?sha=${sha}`);
    if (!starsRes.ok) throw new Error(`${STARS_FILE} → HTTP ${starsRes.status}`);
    // The live smoke must hash what the CDN actually served, byte for byte.
    const starsBytes = new Uint8Array(await starsRes.arrayBuffer());
    const verified = verifyDatasetIntegrity(starsBytes, metaText);

    const indexRes = await fetch(`${origin}${base}`);
    if (!indexRes.ok) throw new Error(`index → HTTP ${indexRes.status}`);
    const asset = assetUrls(await indexRes.text())[0];
    if (asset) {
      const assetRes = await fetch(`${origin}${asset}`);
      if (!assetRes.ok) throw new Error(`asset ${asset} → HTTP ${assetRes.status}`);
    }

    return { repoCount: verified.meta.repo_count, sha256: verified.sha256, base };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
