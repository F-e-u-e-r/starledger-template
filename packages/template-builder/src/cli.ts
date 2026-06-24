#!/usr/bin/env node
/**
 * template:build — regenerate the sanitized `starledger-template` from this repo.
 * Invoked via `pnpm template:build --out ../starledger-template`.
 *
 *   --out <dir>    destination (required)
 *   --dry-run      report what would be copied, write nothing
 *   --force        allow writing into a non-empty destination
 *   --verify       after export, run install/typecheck/test/build + doctor in <dir>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import { buildTemplate } from './build';

const HELP = `template:build — deterministic template export

Usage: pnpm template:build --out <dir> [--dry-run] [--force] [--verify]

--force replaces generated files in a non-empty destination, preserving only its
.git directory so an existing template repository keeps its history.`;

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function isSameOrNested(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === '' ||
    (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      rel !== '..' &&
      !isAbsolute(rel))
  );
}

/**
 * Reset generated output without deleting the destination repository's Git
 * metadata. A full reset is required to prevent a formerly-allowlisted file
 * from lingering after the source policy changes.
 */
function clearGeneratedOutput(outDir: string): void {
  for (const entry of readdirSync(outDir)) {
    if (entry === '.git') continue;
    rmSync(join(outDir, entry), { recursive: true, force: true });
  }
}

function runPostChecks(outDir: string): void {
  const steps: Array<[string, string[]]> = [
    ['pnpm', ['install', '--frozen-lockfile']],
    ['pnpm', ['typecheck']],
    ['pnpm', ['test']],
    ['pnpm', ['build']],
    ['pnpm', ['setup:doctor', '--template-clean']],
  ];
  for (const [cmd, args] of steps) {
    console.log(`\n[template] $ ${cmd} ${args.join(' ')}`);
    execFileSync(cmd, args, { cwd: outDir, stdio: 'inherit' });
  }
}

function main(): void {
  const args = argv.slice(2);
  if (hasFlag(args, 'help') || hasFlag(args, 'h')) {
    console.log(HELP);
    exit(0);
  }
  const out = flagValue(args, 'out');
  if (!out) {
    console.error(`error: --out <dir> is required\n\n${HELP}`);
    exit(10);
  }
  const dryRun = hasFlag(args, 'dry-run');
  const force = hasFlag(args, 'force');
  const outDir = resolve(cwd(), out);
  const srcRoot = resolve(import.meta.dirname, '../../..');

  // Building into the source checkout can recursively copy files, and `--force`
  // would otherwise be capable of deleting that checkout. The documented target
  // is a sibling repository, so reject both directions explicitly.
  if (isSameOrNested(srcRoot, outDir) || isSameOrNested(outDir, srcRoot)) {
    console.error('error: --out must be outside the source checkout');
    exit(10);
  }

  if (!dryRun && existsSync(outDir) && readdirSync(outDir).length > 0 && !force) {
    console.error(`error: ${outDir} is not empty — pass --force to write into it`);
    exit(10);
  }
  if (!dryRun) {
    if (existsSync(outDir) && readdirSync(outDir).length > 0) clearGeneratedOutput(outDir);
    mkdirSync(outDir, { recursive: true });
  }

  const manifest = buildTemplate({ srcRoot, outDir, dryRun });
  const prefix = dryRun ? '(dry-run) ' : '';
  console.log(
    `[template] ${prefix}copied ${manifest.copied.length} file(s), ` +
      `transformed ${manifest.transformed.length} workflow(s), skipped ${manifest.skipped.length} excluded path(s) → ${outDir}`,
  );
  for (const t of manifest.transformed) console.log(`  ~ ${t} (schedule → dispatch-only)`);

  if (hasFlag(args, 'verify')) {
    if (dryRun) {
      console.error('error: --verify cannot be combined with --dry-run');
      exit(10);
    }
    runPostChecks(outDir);
  }
}

main();
