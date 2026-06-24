/** Deterministic template export: copy the allowlist, transform workflows, swap the README. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  ALLOW_DIRS,
  ALLOW_FILES,
  NEUTRALIZE_SCHEDULE_WORKFLOWS,
  README_OUTPUT,
  README_TEMPLATE,
  isExcluded,
} from './allowlist';
import { neutralizeSchedule } from './workflows';

export interface BuildOptions {
  srcRoot: string;
  outDir: string;
  /** Compute the manifest without writing anything. */
  dryRun?: boolean;
}

export interface BuildManifest {
  copied: string[];
  transformed: string[];
  skipped: string[];
  outDir: string;
  dryRun: boolean;
}

function walkFiles(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

export function buildTemplate(options: BuildOptions): BuildManifest {
  const { srcRoot, outDir } = options;
  const dryRun = options.dryRun ?? false;
  const manifest: BuildManifest = { copied: [], transformed: [], skipped: [], outDir, dryRun };

  const readmeSrc = join(srcRoot, README_TEMPLATE);
  if (!existsSync(readmeSrc)) {
    throw new Error(
      `${README_TEMPLATE} not found in ${srcRoot}; cannot build the template without it`,
    );
  }

  const writeText = (rel: string, text: string): void => {
    if (dryRun) return;
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  };
  const copyFile = (rel: string): void => {
    if (dryRun) return;
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(srcRoot, rel), dest);
  };

  // 1. Allowed directories, recursively, minus exclusions.
  for (const dir of ALLOW_DIRS) {
    const absDir = join(srcRoot, dir);
    if (!existsSync(absDir)) continue;
    for (const abs of walkFiles(absDir)) {
      const rel = relative(srcRoot, abs);
      if (isExcluded(rel)) {
        manifest.skipped.push(rel);
        continue;
      }
      const parts = rel.split(sep);
      const base = parts[parts.length - 1] ?? '';
      const inWorkflows = parts.includes('.github') && parts.includes('workflows');
      if (inWorkflows && NEUTRALIZE_SCHEDULE_WORKFLOWS.has(base)) {
        const { text, changed } = neutralizeSchedule(readFileSync(abs, 'utf8'));
        writeText(rel, text);
        (changed ? manifest.transformed : manifest.copied).push(rel);
      } else {
        copyFile(rel);
        manifest.copied.push(rel);
      }
    }
  }

  // 2. Allowed root files.
  for (const f of ALLOW_FILES) {
    if (!existsSync(join(srcRoot, f))) continue;
    copyFile(f);
    manifest.copied.push(f);
  }

  // 3. README.template.md → README.md (the personal README is never copied).
  writeText(README_OUTPUT, readFileSync(readmeSrc, 'utf8'));
  manifest.copied.push(README_OUTPUT);

  return manifest;
}
