#!/usr/bin/env node
import { ExporterError, redactSecrets } from '@starred/github-client';
import { Command } from 'commander';
import { NOTIFIER_VERSION, run, runExitCode } from './run';

const program = new Command();

program
  .name('stars-notify')
  .description('Discover repositories (YouTube / awesome-stars) and notify via Telegram (P2).')
  .version(NOTIFIER_VERSION)
  .option('-c, --config <path>', 'path to notifier.yaml')
  .option(
    '-C, --cwd <path>',
    'repository directory whose origin holds the state branch',
    process.cwd(),
  )
  .action(async (opts: { config?: string; cwd: string }) => {
    const secrets = (): (string | undefined)[] => [
      process.env.STAR_SYNC_TOKEN,
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID,
    ];
    try {
      const outcome = await run({ configPath: opts.config, cwd: opts.cwd });
      const save = outcome.save.changed
        ? outcome.save.pushed
          ? 'state pushed'
          : 'state NOT pushed (remote unchanged)'
        : 'state unchanged';
      process.stdout.write(
        `✓ discovered ${outcome.discovered}, enqueued ${outcome.enqueued}, ` +
          `pending ${outcome.pendingCount}, permanent ${outcome.permanentFailures.length} — ${save}\n`,
      );
      for (const e of outcome.errors) {
        process.stderr.write(
          `  ! ${e.source} ${e.target}: ${redactSecrets(e.message, secrets())}\n`,
        );
      }
      for (const e of outcome.permanentFailures) {
        process.stderr.write(
          `  ✗ permanent ${e.source} ${e.target}: ${redactSecrets(e.message, secrets())}\n`,
        );
      }
      for (const a of outcome.attention) {
        process.stderr.write(
          `  ⚠ attention ${a.item_key}: ${a.attempts} attempts; ` +
            `${redactSecrets(a.last_error ?? '', secrets())}\n`,
        );
      }
      process.exit(runExitCode(outcome));
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err), secrets());
      // 10 = fatal (config/token/credential/schema); 20 = deferred (state preserved).
      if (err instanceof ExporterError) {
        process.stderr.write(`${err.code} (exit ${err.exitCode}): ${message}\n`);
        process.exit(err.exitCode);
      }
      process.stderr.write(`fatal (exit 10): ${message}\n`);
      process.exit(10);
    }
  });

void program.parseAsync(process.argv);
