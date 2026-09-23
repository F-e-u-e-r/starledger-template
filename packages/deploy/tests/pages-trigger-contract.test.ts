import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_ANNOTATIONS_FILE,
  AI_ANNOTATIONS_META_FILE,
  DATASET_META_FILE,
  DISCOVERY_CANDIDATES_FILE,
  DISCOVERY_CANDIDATES_META_FILE,
  SKILLS_CLASSIFICATION_FILE,
  SKILLS_CLASSIFICATION_META_FILE,
  SKILLS_SOURCE_FILE,
  STARS_FILE,
} from '../src/stage';

/**
 * DEPLOYMENT TRIGGER CONTRACT.
 *
 * Staging code that never runs publishes nothing. The Pages workflow fires on
 * `push.paths`, so every root data artifact this package stages must appear in
 * that filter — otherwise a commit that changes ONLY that artifact (exactly
 * what a generator rerun produces) matches no path, no deploy runs, and the
 * public site keeps serving the previous version indefinitely, silently.
 *
 * This is a call-site sweep expressed as a test: the artifact constants below
 * are the single source of truth, so ADDING a new artifact without adding its
 * trigger path fails here instead of being discovered in production months
 * later. Review finding F5 was precisely that omission for the two
 * classification artifacts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(HERE, '../../../.github/workflows/pages.yml');

/** Every root artifact whose change must cause a deploy. */
const DEPLOY_TRIGGERING_ARTIFACTS = [
  STARS_FILE,
  DATASET_META_FILE,
  AI_ANNOTATIONS_FILE,
  AI_ANNOTATIONS_META_FILE,
  DISCOVERY_CANDIDATES_FILE,
  DISCOVERY_CANDIDATES_META_FILE,
  SKILLS_CLASSIFICATION_FILE,
  SKILLS_CLASSIFICATION_META_FILE,
  // §4.12: a source-only change (edit, drift, removal) must also deploy — the
  // stage that CONVERGES the served download only runs on a deploy (R2b sol #5,
  // the F5 omission class this contract test exists to prevent).
  SKILLS_SOURCE_FILE,
] as const;

/** Extract the `paths:` list that sits under the workflow's `push:` trigger. */
function pushPaths(yaml: string): string[] {
  const lines = yaml.split('\n');
  const pushAt = lines.findIndex((l) => /^\s{2}push:\s*$/.test(l));
  if (pushAt < 0) throw new Error('pages.yml has no `push:` trigger');
  // The `paths:` must belong to `push:` — stop at the next top-level trigger
  // key, or a `pull_request.paths` block elsewhere in the file could satisfy
  // this contract while the push trigger has no filter at all (evidence
  // finding from the round-3 review).
  const pushBlockEnd = lines.findIndex((l, i) => i > pushAt && /^\s{2}\S/.test(l));
  const searchLimit = pushBlockEnd < 0 ? lines.length : pushBlockEnd;
  const pathsAt = lines.findIndex(
    (l, i) => i > pushAt && i < searchLimit && /^\s{4}paths:\s*$/.test(l),
  );
  if (pathsAt < 0) throw new Error('pages.yml `push:` trigger has no `paths:` filter');

  const collected: string[] = [];
  for (const line of lines.slice(pathsAt + 1)) {
    const entry = /^\s{6}-\s*'([^']+)'\s*$/.exec(line);
    if (!entry?.[1]) break; // the list ends at the first non-entry line
    const pattern = entry[1];
    // A NEGATIVE pattern subtracts from everything listed before it, so a
    // positive entry followed by `!same-file` matches nothing. Collecting only
    // positives would score such a filter as covering the artifact (round-6
    // evidence finding) — record exclusions so the contract can reject them.
    if (pattern.startsWith('!')) {
      throw new Error(
        `pages.yml push.paths uses a negative pattern (${pattern}); this contract ` +
          'cannot prove coverage in its presence — state the filter positively.',
      );
    }
    collected.push(pattern);
  }
  return collected;
}

describe('Pages deployment trigger covers every staged root artifact (F5)', () => {
  const paths = pushPaths(readFileSync(WORKFLOW, 'utf8'));

  it('parses a non-trivial paths filter (guards the parser itself)', () => {
    // Without this, a parsing regression yielding [] would make every
    // membership assertion below fail loudly rather than pass vacuously —
    // but an over-eager parser returning junk would go unnoticed.
    expect(paths.length).toBeGreaterThanOrEqual(DEPLOY_TRIGGERING_ARTIFACTS.length);
    expect(paths).toContain('apps/dashboard/**');
  });

  it.each(DEPLOY_TRIGGERING_ARTIFACTS)(
    'a change to %s triggers a Pages deploy',
    (artifact: string) => {
      expect(paths).toContain(artifact);
    },
  );

  /**
   * The parser must read `push:`'s OWN filter. Against the healthy production
   * workflow an unbounded search happens to land on the right block, so the
   * bounding is invisible there — this synthetic workflow is what actually
   * pins it (round-4 evidence finding). Without the bound, a `push:` with NO
   * paths filter (i.e. every push deploys, or none, depending on the rest of
   * the file) would be scored using `pull_request`'s list.
   */
  it('rejects a negative pattern that would exclude a required artifact', () => {
    const synthetic = [
      'name: Pages',
      'on:',
      '  push:',
      '    branches: [main]',
      '    paths:',
      "      - 'stars.json'",
      "      - 'skills-classification.json'",
      "      - '!skills-classification.json'",
      'jobs: {}',
      '',
    ].join('\n');
    // Positive membership alone would score this filter as covering the
    // artifact, while a skills-only push would in fact match nothing.
    expect(() => pushPaths(synthetic)).toThrow(/negative pattern/);
  });

  it('does not accept a pull_request paths block as the push filter', () => {
    const synthetic = [
      'name: Pages',
      'on:',
      '  push:',
      '    branches: [main]',
      '  pull_request:',
      '    paths:',
      "      - 'stars.json'",
      "      - 'skills-classification.json'",
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '',
    ].join('\n');

    expect(() => pushPaths(synthetic)).toThrow(/has no .*paths.* filter/);
  });
});
