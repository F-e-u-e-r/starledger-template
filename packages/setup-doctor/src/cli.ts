#!/usr/bin/env node
/**
 * setup:doctor — tells a fresh StarLedger repo what is missing or unsafe before
 * any workflow is enabled. Invoked via `pnpm setup:doctor [modes]`.
 *
 *   --local            workspace/files/config/dataset checks (default)
 *   --github-actions   STAR_SYNC_TOKEN presence + viewer-stars read
 *   --telegram         Telegram bot token / chat validation
 *   --ai               AI config + artifact-pair sanity
 *   --template-clean   assert a pristine template (no personal data / live config)
 *   --offline          skip all network checks
 *   --json             machine-readable output
 *   --root <dir>       inspect <dir> instead of the current directory
 *
 * Exit: 0 ready · 20 incomplete / needs setup · 10 invalid / unsafe.
 */
import { argv, cwd, env, exit, stdout } from 'node:process';
import type { Mode } from './doctor';
import { runDoctor } from './doctor';
import { EXIT_INVALID, exitCodeFor, formatResult, summarize, verdict } from './report';

interface ParsedArgs {
  modes: Mode[];
  root: string;
  offline: boolean;
  json: boolean;
}

const HELP = `setup:doctor — check whether a StarLedger repo is ready

Usage: pnpm setup:doctor [--local] [--github-actions] [--telegram] [--ai]
                         [--template-clean] [--offline] [--json] [--root <dir>]

With no mode flags it runs --local + --github-actions, plus any optional feature
group enabled in config/template.yaml. Exit codes: 0 ready · 20 incomplete · 10 invalid/unsafe.`;

function parseArgs(args: string[]): ParsedArgs {
  const modes: Mode[] = [];
  let root = cwd();
  let offline = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--local':
        modes.push('local');
        break;
      case '--github-actions':
        modes.push('github-actions');
        break;
      case '--telegram':
        modes.push('telegram');
        break;
      case '--ai':
        modes.push('ai');
        break;
      case '--template-clean':
        modes.push('template-clean');
        break;
      case '--offline':
        offline = true;
        break;
      case '--json':
        json = true;
        break;
      case '--root':
        root = args[++i] ?? root;
        break;
      case '--help':
      case '-h':
        console.log(HELP);
        exit(0);
        break;
      default:
        console.error(`unknown argument: ${String(a)}\n\n${HELP}`);
        exit(EXIT_INVALID);
    }
  }
  return { modes, root, offline, json };
}

async function main(): Promise<void> {
  const { modes, root, offline, json } = parseArgs(argv.slice(2));
  const results = await runDoctor({ root, env, modes, offline });
  const code = exitCodeFor(results);
  if (json) {
    stdout.write(
      `${JSON.stringify({ exitCode: code, verdict: verdict(code), results }, null, 2)}\n`,
    );
  } else {
    for (const r of results) console.log(formatResult(r));
    console.log('');
    console.log(`setup:doctor → ${summarize(results)} → exit ${code} (${verdict(code)})`);
  }
  exit(code);
}

main().catch((e: unknown) => {
  console.error(e);
  exit(EXIT_INVALID);
});
