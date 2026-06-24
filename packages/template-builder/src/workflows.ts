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
