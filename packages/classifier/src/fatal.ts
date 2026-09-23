import { ExporterError } from '@starred/github-client';

export function fatal(error: unknown): never {
  // Honor the error's exit code so a DeferredError (recoverable — e.g. a probe that
  // exhausted retries or a rate-limit cooldown) exits 20 ("retry next run, keep
  // last-known-good") instead of masquerading as a terminal exit 10, matching the
  // exporter CLI. Non-ExporterError faults stay terminal (10).
  const exitCode = error instanceof ExporterError ? error.exitCode : 10;
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fatal (exit ${exitCode}): ${message}\n`);
  process.exit(exitCode);
}
