import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, type InlineConfig, type ResolvedConfig } from 'vite';
import { describe, expect, it } from 'vitest';

// Regression guard for the dev-server / preview surface the repo actually uses
// (`pnpm --filter @starred/dashboard dev` / `preview`). The dashboard sets no
// `server` options, so these are Vite's resolved defaults for apps/dashboard/vite.config.ts.
// They were pinned when Vite moved 5 -> 7 so a later config edit (or a Vite upgrade) cannot
// silently widen the surface: loopback-only binding, strict fs allowlist inside the repo with
// the secret-file deny patterns, localhost-only CORS, no extra allowed hosts, no proxy.
// Every check fails CLOSED: an unrecognised shape is a violation, never a pass.
const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(dashboardRoot, '..', '..');

async function resolved(command: 'serve' | 'build', overrides: InlineConfig = {}) {
  return resolveConfig(
    {
      configFile: resolve(dashboardRoot, 'vite.config.ts'),
      root: dashboardRoot,
      logLevel: 'silent',
      ...overrides,
    },
    command,
  );
}

/** True only for a path equal to `root` or strictly inside it (segment-aware, not a string prefix). */
function insideRoot(root: string, dir: string): boolean {
  const rel = relative(root, resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Accepts only CORS fully disabled, or an object whose `origin` is a RegExp that admits localhost and nothing else. */
function corsViolation(label: string, cors: ResolvedConfig['server']['cors']): string[] {
  if (cors === false) return [];
  if (typeof cors !== 'object' || cors === null || !(cors.origin instanceof RegExp)) {
    return [
      `${label}: cors must be false or an object with a RegExp origin, got ${JSON.stringify(cors)}`,
    ];
  }
  const out: string[] = [];
  if (!cors.origin.test('http://localhost:5173'))
    out.push(`${label}: cors origin must admit localhost`);
  if (cors.origin.test('https://evil.example'))
    out.push(`${label}: cors origin admits a foreign origin`);
  return out;
}

/** Every violation of the pinned dev-server policy; an empty list is the only passing result. */
function serveViolations(config: ResolvedConfig): string[] {
  const out: string[] = [];
  for (const [label, host] of [
    ['server', config.server.host],
    ['preview', config.preview.host],
  ] as const) {
    if (![undefined, 'localhost', '127.0.0.1'].includes(host as string | undefined)) {
      out.push(`${label}: host must stay on loopback, got ${JSON.stringify(host)}`);
    }
  }
  if (config.server.fs.strict !== true) out.push('server.fs.strict must be true');
  for (const pattern of ['.env', '.env.*', '*.{crt,pem}', '**/.git/**']) {
    if (!config.server.fs.deny.includes(pattern)) out.push(`server.fs.deny is missing ${pattern}`);
  }
  for (const dir of config.server.fs.allow) {
    if (!insideRoot(repoRoot, dir)) out.push(`server.fs.allow escapes the repository root: ${dir}`);
  }
  out.push(
    ...corsViolation('server', config.server.cors),
    ...corsViolation('preview', config.preview.cors),
  );
  for (const [label, hosts] of [
    ['server', config.server.allowedHosts],
    ['preview', config.preview.allowedHosts],
  ] as const) {
    if (!Array.isArray(hosts) || hosts.length !== 0) {
      out.push(`${label}: allowedHosts must be the empty default, got ${JSON.stringify(hosts)}`);
    }
  }
  // Vite resolves the preview proxy independently (`preview.proxy ?? server.proxy`),
  // so a preview-only proxy would slip past a server-only check: guard both surfaces,
  // matching the host/cors/allowedHosts checks above. Do not collapse back to server-only.
  for (const [label, proxy] of [
    ['server', config.server.proxy],
    ['preview', config.preview.proxy],
  ] as const) {
    if (proxy !== undefined) out.push(`${label}.proxy must stay unset`);
  }
  return out;
}

describe('dashboard Vite dev-server security defaults', () => {
  it('the committed config resolves with zero policy violations', async () => {
    expect(serveViolations(await resolved('serve'))).toEqual([]);
  });

  it('rejects a widened config: network host, permissive CORS, wildcard hosts, loose fs', async () => {
    const widened = await resolved('serve', {
      server: {
        host: true,
        cors: { origin: '*' },
        allowedHosts: ['*.example.com'],
        fs: { strict: false, allow: [resolve(repoRoot, '..', 'wt-sibling')] },
      },
      preview: { cors: true },
    });
    const violations = serveViolations(widened);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('server: host must stay on loopback'),
        'server.fs.strict must be true',
        expect.stringContaining('server.fs.allow escapes the repository root'),
        expect.stringContaining('server: cors must be false or an object with a RegExp origin'),
        expect.stringContaining('preview: cors must be false or an object with a RegExp origin'),
        expect.stringContaining('server: allowedHosts must be the empty default'),
      ]),
    );
  });

  it('flags a preview-only proxy (DEV-GUARD-001: Vite resolves preview.proxy independently)', async () => {
    const config = await resolved('serve', {
      preview: { proxy: { '/api': 'http://127.0.0.1:4100' } },
    });
    // The discriminating precondition: server.proxy stays unset, so a server-only
    // check sees nothing; only reading preview.proxy catches this.
    expect(config.server.proxy).toBeUndefined();
    expect(config.preview.proxy).toBeDefined();
    const violations = serveViolations(config);
    expect(violations).toContain('preview.proxy must stay unset');
    expect(violations).not.toContain('server.proxy must stay unset');
  });

  it('flags a server-only proxy', async () => {
    const config = await resolved('serve', {
      server: { proxy: { '/api': 'http://127.0.0.1:4100' } },
    });
    expect(serveViolations(config)).toContain('server.proxy must stay unset');
  });

  it('flags a proxy configured on both surfaces with both named violations', async () => {
    const config = await resolved('serve', {
      server: { proxy: { '/api': 'http://127.0.0.1:4100' } },
      preview: { proxy: { '/api': 'http://127.0.0.1:4100' } },
    });
    expect(serveViolations(config)).toEqual(
      expect.arrayContaining(['server.proxy must stay unset', 'preview.proxy must stay unset']),
    );
  });

  it('safe unrelated server/preview settings keep the proxy guard green', async () => {
    const config = await resolved('serve', {
      server: { port: 5174 },
      preview: { port: 4174 },
    });
    const violations = serveViolations(config);
    expect(violations).not.toContain('server.proxy must stay unset');
    expect(violations).not.toContain('preview.proxy must stay unset');
    expect(violations).toEqual([]);
  });

  it('path containment is segment-aware: a sibling directory sharing the root prefix is outside', () => {
    expect(insideRoot(repoRoot, repoRoot)).toBe(true);
    expect(insideRoot(repoRoot, dashboardRoot)).toBe(true);
    expect(insideRoot(repoRoot, `${repoRoot}-sibling`)).toBe(false);
    expect(insideRoot(repoRoot, resolve(repoRoot, '..'))).toBe(false);
  });

  it('builds a static site with no manifest, sourcemaps or dev artifacts', async () => {
    const config = await resolved('build');
    expect(config.build.manifest).toBe(false);
    expect(config.build.sourcemap).toBe(false);
    expect(config.build.outDir).toBe('dist');
  });
});
