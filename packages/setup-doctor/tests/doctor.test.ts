import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveModes, runDoctor } from '../src/doctor';
import { EXIT_INVALID, EXIT_READY, exitCodeFor } from '../src/report';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const EXAMPLES = [
  'config.example.yaml',
  'config/ai.example.yaml',
  'config/notifier.example.yaml',
  'config/template.example.yaml',
];

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'starledger-doctor-'));
  dirs.push(d);
  return d;
}
function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}
/** A directory that passes --template-clean: examples present, nothing personal. */
function cleanTemplateDir(): string {
  const d = tmp();
  for (const f of EXAMPLES) write(d, f, '# example\n');
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('runDoctor — template-clean', () => {
  it('pristine template (examples, no personal data) → ready', async () => {
    const results = await runDoctor({
      root: cleanTemplateDir(),
      modes: ['template-clean'],
      offline: true,
      env: {},
    });
    expect(exitCodeFor(results)).toBe(EXIT_READY);
  });

  it('stray personal artifact → invalid', async () => {
    const d = cleanTemplateDir();
    write(d, 'stars.json', '{"repos":[]}');
    const results = await runDoctor({ root: d, modes: ['template-clean'], offline: true, env: {} });
    expect(exitCodeFor(results)).toBe(EXIT_INVALID);
  });
});

describe('runDoctor — github-actions', () => {
  it('no token → incomplete', async () => {
    const results = await runDoctor({
      root: tmp(),
      modes: ['github-actions'],
      offline: true,
      env: {},
    });
    expect(results.find((r) => r.id === 'github.token')?.status).toBe('incomplete');
  });

  it('token present + readable stars → token passes, stars read passes', async () => {
    const results = await runDoctor({
      root: tmp(),
      modes: ['github-actions'],
      env: { STAR_SYNC_TOKEN: 't' },
      fetchImpl: fakeFetch(200, {
        data: { viewer: { login: 'octocat', starredRepositories: { totalCount: 3 } } },
      }),
    });
    expect(results.find((r) => r.id === 'github.token')?.status).toBe('pass');
    expect(results.find((r) => r.id === 'github.stars-read')?.status).toBe('pass');
  });
});

describe('resolveModes', () => {
  it('no flags → local plus deployable core when no manifest', () => {
    const modes = resolveModes(undefined, tmp());
    expect([...modes]).toEqual(['local', 'github-actions']);
  });

  it('manifest enabling ai/notifier adds those modes', () => {
    const d = tmp();
    write(
      d,
      'config/template.yaml',
      'features:\n  notifier:\n    enabled: true\n  ai:\n    enabled: true\n',
    );
    const modes = resolveModes(undefined, d);
    expect(modes.has('local')).toBe(true);
    expect(modes.has('github-actions')).toBe(true);
    expect(modes.has('telegram')).toBe(true);
    expect(modes.has('ai')).toBe(true);
  });

  it('default run reports a missing core token as incomplete', async () => {
    const results = await runDoctor({ root: tmp(), offline: true, env: {} });
    expect(results.find((r) => r.id === 'github.token')?.status).toBe('incomplete');
  });

  it('explicit flags override feature inference', () => {
    expect([...resolveModes(['ai'], tmp())]).toEqual(['ai']);
  });
});

describe('cli exit codes (real process)', () => {
  function runCli(args: string[]): number {
    try {
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'packages/setup-doctor/src/cli.ts', ...args],
        {
          cwd: repoRoot,
          stdio: 'pipe',
        },
      );
      return 0;
    } catch (e) {
      const status = (e as { status?: number }).status;
      return typeof status === 'number' ? status : -1;
    }
  }

  it('clean template dir → exit 0', () => {
    expect(runCli(['--template-clean', '--offline', '--root', cleanTemplateDir()])).toBe(
      EXIT_READY,
    );
  });

  it('dir with personal artifact → exit 10', () => {
    const d = cleanTemplateDir();
    write(d, 'stars.json', '{"repos":[]}');
    expect(runCli(['--template-clean', '--offline', '--root', d])).toBe(EXIT_INVALID);
  });
});
