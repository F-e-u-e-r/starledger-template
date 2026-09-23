import { parse as parseYaml } from 'yaml';

/**
 * Neutralize the `schedule:` trigger of a workflow for the template. The
 * original lines (including the cron) are preserved as comments so the user can
 * re-enable automation deliberately after `setup:doctor` passes — honoring the
 * opt-in invariant that nothing fires on a fresh repo before secrets are set.
 */

function leadingSpaces(line: string): number {
  const m = /^( *)/.exec(line);
  return m?.[1]?.length ?? 0;
}

/** Collect every `uses:` value anywhere in a parsed workflow tree. */
function collectUses(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectUses(item, out);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uses' && typeof value === 'string') out.push(value);
      else collectUses(value, out);
    }
  }
}

/**
 * Return every `uses:` action ref in a workflow that is NOT pinned to a full
 * 40-hex commit SHA (S4). A mutable tag (`@v3`, `@main`) or branch lets the
 * action's code change under a fixed ref — a supply-chain risk, acute for the
 * publish-credential actions (see docs/adr/ADR-003-sha-pin-actions.md). Local
 * refs (`./…`, `../…`) are ours, so they are ignored; anything else whose ref
 * after the final `@` is not 40 hex chars is reported.
 *
 * This PARSES the YAML (rather than scanning lines) so every `uses` key form
 * (block, flow `{ uses: … }`, quoted key/value, `uses :`) is caught, while text
 * inside a `run:` script block is NOT mistaken for an action ref. An unparseable
 * workflow is itself a failure and is reported as such.
 */
export function findUnpinnedActionRefs(yaml: string): string[] {
  let doc: unknown;
  try {
    doc = parseYaml(yaml);
  } catch (err) {
    return [`<unparseable workflow: ${err instanceof Error ? err.message : String(err)}>`];
  }
  const uses: string[] = [];
  collectUses(doc, uses);
  return uses.filter((ref) => {
    if (ref.startsWith('./') || ref.startsWith('../')) return false; // local action / reusable workflow
    const at = ref.lastIndexOf('@');
    const pin = at >= 0 ? ref.slice(at + 1) : '';
    return !/^[0-9a-f]{40}$/.test(pin);
  });
}

export interface NeutralizeResult {
  text: string;
  changed: boolean;
}

export function neutralizeSchedule(yaml: string): NeutralizeResult {
  const lines = yaml.split('\n');
  const out: string[] = [];
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // A top-level `on:` mapping key `schedule:` is indented two spaces.
    if (/^ {2}schedule:\s*$/.test(line)) {
      const indent = leadingSpaces(line); // 2
      const block: string[] = [line];
      i++;
      // Capture the schedule body: deeper-indented, non-blank lines.
      while (i < lines.length) {
        const next = lines[i] ?? '';
        if (next.trim() === '' || leadingSpaces(next) <= indent) {
          i--; // re-examine this line in the outer loop
          break;
        }
        block.push(next);
        i++;
      }
      const pad = ' '.repeat(indent);
      out.push(`${pad}# Scheduled triggers are disabled in the template until you set secrets.`);
      out.push(`${pad}# Uncomment to re-enable (see docs/setup/), and run once manually first:`);
      for (const b of block) {
        out.push(b.trim() === '' ? '' : `${pad}# ${b.slice(indent)}`);
      }
      changed = true;
      continue;
    }
    out.push(line);
  }

  return { text: out.join('\n'), changed };
}

/** Marker comment: the workflow step that follows it is omitted from the template. */
export const OMIT_STEP_MARKER = '# template-builder: omit';

export interface StripResult {
  text: string;
  changed: boolean;
  /** `name:` of every omitted step, in document order. */
  omitted: string[];
}

function countSteps(doc: unknown): number {
  if (doc === null || typeof doc !== 'object') return 0;
  const jobs = (doc as { jobs?: unknown }).jobs;
  if (jobs === null || typeof jobs !== 'object') return 0;
  let n = 0;
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    const steps = (job as { steps?: unknown })?.steps;
    if (Array.isArray(steps)) n += steps.length;
  }
  return n;
}

/**
 * Remove every workflow step annotated with OMIT_STEP_MARKER — the parent-only
 * steps (they run `scripts/`, which the allowlist never ships). Text-based like
 * neutralizeSchedule, but fail-closed:
 *
 * - a marker is a comment line on its own, followed (after optional contiguous
 *   comment lines at the same indentation — the step's own description) by a
 *   `- name:` step at that indentation; anything else throws;
 * - the removed block must parse as exactly one step, and the document must
 *   lose exactly one step per marker;
 * - input without a marker is returned unchanged, so a second pass is a no-op.
 *
 * A throw fails the build instead of emitting a half-edited workflow.
 */
export function stripOmittedSteps(yaml: string): StripResult {
  const lines = yaml.split('\n');
  if (!lines.some((l) => l.trim().startsWith('# template-builder:'))) {
    return { text: yaml, changed: false, omitted: [] };
  }
  const out: string[] = [];
  const omitted: string[] = [];
  const stepPattern = /^( *)- name:\s*(.+?)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed.startsWith('# template-builder:')) {
      out.push(line);
      continue;
    }
    if (trimmed !== OMIT_STEP_MARKER) {
      throw new Error(`template-builder: malformed marker at line ${i + 1}: "${trimmed}"`);
    }
    const indent = leadingSpaces(line);
    // Optional contiguous comment lines at the same indentation belong to the step.
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] ?? '';
      if (leadingSpaces(l) === indent && l.trim().startsWith('#')) j++;
      else break;
    }
    const stepLine = lines[j] ?? '';
    const m = stepPattern.exec(stepLine);
    if (!m || (m[1]?.length ?? -1) !== indent) {
      throw new Error(
        `template-builder: orphaned marker at line ${i + 1}: the next line must be a "- name:" step at the same indentation`,
      );
    }
    const block: string[] = [stepLine];
    let k = j + 1;
    while (k < lines.length) {
      const next = lines[k] ?? '';
      if (next.trim() === '' || leadingSpaces(next) > indent) {
        block.push(next);
        k++;
      } else break;
    }
    // Leave the blank separator before the next step in place.
    while (block.length > 0 && (block[block.length - 1] ?? '').trim() === '') {
      block.pop();
      k--;
    }
    const dedented = block
      .map((b) => (b.trim() === '' ? '' : b.slice(Math.min(indent, leadingSpaces(b)))))
      .join('\n');
    let parsed: unknown;
    try {
      parsed = parseYaml(dedented);
    } catch (err) {
      throw new Error(
        `template-builder: marker at line ${i + 1} does not enclose a parseable step (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const single = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
    if (single === null || typeof single !== 'object' || !('name' in (single as object))) {
      throw new Error(
        `template-builder: marker at line ${i + 1} does not enclose exactly one step`,
      );
    }
    omitted.push(String((single as { name: unknown }).name));
    // Never leave two blank lines behind (prettier would reject the output).
    if ((out[out.length - 1] ?? 'x').trim() === '' && (lines[k] ?? 'x').trim() === '') k++;
    i = k - 1;
  }

  const text = out.join('\n');
  let before: unknown;
  let after: unknown;
  try {
    before = parseYaml(yaml);
    after = parseYaml(text);
  } catch (err) {
    throw new Error(
      `template-builder: workflow no longer parses after omitting steps (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (countSteps(before) - countSteps(after) !== omitted.length) {
    throw new Error(
      `template-builder: expected to omit ${omitted.length} step(s) but the workflow lost ${countSteps(before) - countSteps(after)}`,
    );
  }
  return { text, changed: true, omitted };
}
