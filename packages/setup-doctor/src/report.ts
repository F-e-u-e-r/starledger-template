/**
 * Result model and exit-code aggregation for the setup doctor.
 *
 * Exit codes (see docs/P4-template-spec.md):
 *   0   ready
 *   20  incomplete / needs setup
 *   10  invalid / unsafe
 */

/** Severity of a single check. `warn` is advisory and never fails the run. */
export type CheckStatus = 'pass' | 'warn' | 'incomplete' | 'invalid';

export interface CheckResult {
  /** Stable identifier, e.g. `local.node-version`. */
  id: string;
  title: string;
  status: CheckStatus;
  /** One-line explanation; for non-`pass`, says how to fix it. */
  detail: string;
}

export const EXIT_READY = 0;
export const EXIT_INCOMPLETE = 20;
export const EXIT_INVALID = 10;

/**
 * Aggregate results to a process exit code. `invalid` (unsafe) is the hardest
 * stop and outranks `incomplete`; `warn`/`pass` never change the code.
 */
export function exitCodeFor(results: readonly CheckResult[]): number {
  if (results.some((r) => r.status === 'invalid')) return EXIT_INVALID;
  if (results.some((r) => r.status === 'incomplete')) return EXIT_INCOMPLETE;
  return EXIT_READY;
}

export function verdict(code: number): string {
  if (code === EXIT_READY) return 'ready';
  if (code === EXIT_INCOMPLETE) return 'incomplete — needs setup';
  return 'invalid — unsafe';
}

const ICON: Record<CheckStatus, string> = {
  pass: '✓',
  warn: '!',
  incomplete: '·',
  invalid: '✗',
};

export function formatResult(r: CheckResult): string {
  return `${ICON[r.status]} [${r.status}] ${r.title} — ${r.detail}`;
}

export function summarize(results: readonly CheckResult[]): string {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, incomplete: 0, invalid: 0 };
  for (const r of results) counts[r.status] += 1;
  return `pass ${counts.pass} · warn ${counts.warn} · incomplete ${counts.incomplete} · invalid ${counts.invalid}`;
}

/** Keep the first result per id (a check may be requested by several modes). */
export function dedupeById(results: readonly CheckResult[]): CheckResult[] {
  const seen = new Set<string>();
  const out: CheckResult[] = [];
  for (const r of results) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
