import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveCategoryId, parseSkillsClassifiedSource } from '../src/parse-source';
import { makeSourceText } from './helpers';

// The vendored corpus is OWNER DATA: present in the real repo, absent in the
// P4 template scratch build. The evidence tests below run only where it
// exists — a labelled skip, never a silent failure; every synthetic-grammar
// test still runs everywhere.
const REAL_SOURCE_PATH = resolve(import.meta.dirname, '../../../skills-classified.md');
const HAS_REAL_SOURCE = existsSync(REAL_SOURCE_PATH);
const REAL_SOURCE = HAS_REAL_SOURCE ? readFileSync(REAL_SOURCE_PATH, 'utf8') : '';

function expectIssues(text: string, needle: string): void {
  const result = parseSkillsClassifiedSource(text);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.join('\n')).toContain(needle);
  }
}

describe('deriveCategoryId (§4.9 slug rule)', () => {
  it.each([
    ['Verification & QA', 'verification-qa'],
    ['Design (UI/UX & Visual/Motion)', 'design-ui-ux-visual-motion'],
    ['Roadmap & Spec-Driven Planning', 'roadmap-spec-driven-planning'],
    ['Marketing, SEO & Social Content', 'marketing-seo-social-content'],
    ['Skill/Plugin Collections & Meta-Frameworks', 'skill-plugin-collections-meta-frameworks'],
    ['Agent UX, Config & Hooks', 'agent-ux-config-hooks'],
  ])('%s → %s', (label, id) => {
    expect(deriveCategoryId(label)).toBe(id);
  });
});

describe.skipIf(!HAS_REAL_SOURCE)('real vendored corpus (byte-verbatim source evidence)', () => {
  const result = parseSkillsClassifiedSource(REAL_SOURCE);

  it('parses clean: 171 entries, 24 categories, zero issues', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.entries).toHaveLength(171);
    expect(result.source.categories).toHaveLength(24);
  });

  it('orders categories by table appearance, 0..23, domain before infrastructure', () => {
    if (!result.ok) return;
    expect(result.source.categories.map((category) => category.order)).toEqual(
      Array.from({ length: 24 }, (_v, index) => index),
    );
    const kinds = result.source.categories.map((category) => category.kind);
    expect(kinds.slice(0, 18).every((kind) => kind === 'domain')).toBe(true);
    expect(kinds.slice(18).every((kind) => kind === 'infrastructure')).toBe(true);
  });

  it('projects the whitelisted target-pack forms (annotation normalized, documented)', () => {
    if (!result.ok) return;
    const byId = new Map(result.source.categories.map((category) => [category.id, category]));
    expect(byId.get('verification-qa')?.target_pack).toBe('opus-pack');
    // `opus-pack (to be split out later)` → opus-pack (§4.9 projection).
    expect(byId.get('security')?.target_pack).toBe('opus-pack');
    expect(byId.get('roadmap-spec-driven-planning')?.target_pack).toBe('opus-pack');
    expect(byId.get('design-ui-ux-visual-motion')?.target_pack).toBe('design-pack');
    expect(byId.get('marketing-seo-social-content')?.target_pack).toBeNull();
    expect(byId.get('mcp-integrations')?.target_pack).toBeNull();
  });

  it('carries exactly the 38 secondary markers the multi-fit table lists', () => {
    if (!result.ok) return;
    const withSecondary = result.source.entries.filter(
      (entry) => entry.secondary_category_ids.length > 0,
    );
    expect(withSecondary).toHaveLength(38);
  });
});

describe('§4.9 target-pack whitelist — every counter-example fails closed', () => {
  it.each([
    'opus-pack foo',
    'opus-pack (later)',
    'opus-pack(to be split out later)',
    'Opus-Pack',
    'design-pack (something)',
    'opus-pack (to be split out later) extra',
  ])('rejects %s in the scheme table', (form) => {
    const text = makeSourceText().replace(
      '| Verification & QA | Correctness-checking skills. | 2 | opus-pack |',
      `| Verification & QA | Correctness-checking skills. | 2 | ${form} |`,
    );
    expectIssues(text, '§4.9 whitelist');
  });

  it('rejects a non-whitelisted form in a section header', () => {
    const text = makeSourceText().replace(
      '## Verification & QA (2) — target pack: **opus-pack**',
      '## Verification & QA (2) — target pack: **opus-pack extra**',
    );
    expectIssues(text, '§4.9 whitelist');
  });

  it('accepts the exact annotated form and projects it (documented normalization)', () => {
    const text = makeSourceText()
      .replace(
        '| Verification & QA | Correctness-checking skills. | 2 | opus-pack |',
        '| Verification & QA | Correctness-checking skills. | 2 | opus-pack (to be split out later) |',
      )
      .replace(
        '## Verification & QA (2) — target pack: **opus-pack**',
        '## Verification & QA (2) — target pack: **opus-pack (to be split out later)**',
      );
    const result = parseSkillsClassifiedSource(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.source.categories.find((category) => category.id === 'verification-qa')?.target_pack,
      ).toBe('opus-pack');
    }
  });
});

describe('source self-consistency — cross-validation failures are named', () => {
  it('baseline synthetic source parses clean', () => {
    expect(parseSkillsClassifiedSource(makeSourceText()).ok).toBe(true);
  });

  it('scheme-table pack ↔ section pack mismatch', () => {
    const text = makeSourceText().replace(
      '## Verification & QA (2) — target pack: **opus-pack**',
      '## Verification & QA (2) — target pack: **design-pack**',
    );
    expectIssues(text, 'target-pack source form mismatch');
  });

  it('scheme-table definition ↔ section italic definition mismatch', () => {
    const text = makeSourceText().replace('*Correctness-checking skills.*', '*Different words.*');
    expectIssues(text, 'definition mismatch');
  });

  it('section declared count ↔ actual entries mismatch', () => {
    const text = makeSourceText().replace('- gamma/three (★30) — Third fixture entry.\n', '');
    expectIssues(text, 'declares 1 entries, contains 0');
  });

  it('subtotal arithmetic is checked', () => {
    const text = makeSourceText().replace(
      '| **Subtotal** | | **3** | |',
      '| **Subtotal** | | **4** | |',
    );
    expectIssues(text, 'subtotal');
  });

  it('total line arithmetic is checked', () => {
    const text = makeSourceText().replace(
      '**Total: 3 + 0 = 3 repos.**',
      '**Total: 3 + 0 = 4 repos.**',
    );
    expectIssues(text, 'total line');
  });

  it('duplicate source name (case-insensitive) is rejected', () => {
    const text = makeSourceText().replace(
      '- gamma/three (★30) — Third fixture entry.',
      '- Alpha/One (★30) — Third fixture entry.',
    );
    expectIssues(text, 'duplicate source_name_with_owner');
  });

  it('unknown secondary label is rejected', () => {
    const text = makeSourceText().replace(
      '[secondary: Design (UI/UX & Visual/Motion)]',
      '[secondary: Nonexistent Category]',
    );
    expectIssues(text, 'matches no category');
  });

  it('a multi-fit row without a marker-carrying entry is rejected (redundant view must agree)', () => {
    const text = makeSourceText().replace(
      '- beta/two (★20) — Second fixture entry. [secondary: Design (UI/UX & Visual/Motion)]',
      '- beta/two (★20) — Second fixture entry.',
    );
    expectIssues(text, 'multi-fit');
  });

  it('a marker-carrying entry missing from the multi-fit table is rejected', () => {
    const text = makeSourceText().replace(
      '| beta/two | Verification & QA | Design (UI/UX & Visual/Motion) |\n',
      '',
    );
    expectIssues(text, 'multi-fit');
  });

  it('a multi-fit row disagreeing on primary is rejected', () => {
    const text = makeSourceText().replace(
      '| beta/two | Verification & QA | Design (UI/UX & Visual/Motion) |',
      '| beta/two | Design (UI/UX & Visual/Motion) | Design (UI/UX & Visual/Motion) |',
    );
    expectIssues(text, 'primary');
  });
});

describe('gate 1 — no generic cleanup: whitespace deviations are violations, never trimmed into shape', () => {
  it('rejects a line with trailing whitespace', () => {
    const text = makeSourceText().replace(
      '- alpha/one (★10) — First fixture entry.',
      '- alpha/one (★10) — First fixture entry. ',
    );
    expectIssues(text, 'trailing whitespace');
  });

  it('rejects a whitespace-padded whitelist form instead of trimming it into acceptance', () => {
    const doubled = makeSourceText().replace(
      '| Verification & QA | Correctness-checking skills. | 2 | opus-pack |',
      '| Verification & QA | Correctness-checking skills. | 2 |  opus-pack |',
    );
    expectIssues(doubled, 'extra inner whitespace');
    const unpadded = makeSourceText().replace(
      '| Verification & QA | Correctness-checking skills. | 2 | opus-pack |',
      '| Verification & QA | Correctness-checking skills. | 2 |opus-pack |',
    );
    expectIssues(unpadded, 'single-space padding');
  });

  it.each([
    ['double comma', '★1,,2'],
    ['bare comma', '★,'],
    ['bad grouping', '★1,23'],
  ])('rejects an invalid star count (%s) — digits or standard grouping only', (_name, star) => {
    const text = makeSourceText().replace('(★10)', `(${star.replace('★', '★')})`);
    expectIssues(text, 'entry bullet does not match');
  });

  it('accepts plain digits and standard thousands grouping', () => {
    const text = makeSourceText().replace('(★10)', '(★88,054)');
    expect(parseSkillsClassifiedSource(text).ok).toBe(true);
  });
});

describe('structural completeness — required blocks exactly once, in order', () => {
  it('a missing multi-fit section is a named violation', () => {
    const text = makeSourceText()
      .replace('## Multi-fit repos (primary / secondary)\n', '')
      .replace('| Repo | Primary | Secondary |\n', '')
      .replace('|---|---|---|\n', (match, offset, full) =>
        full.lastIndexOf('|---|---|---|\n') === offset ? '' : match,
      )
      .replace('| beta/two | Verification & QA | Design (UI/UX & Visual/Motion) |\n', '')
      .replace('1 of 3 repos carries a secondary tag.\n', '');
    expectIssues(text, 'missing required structure: ## Multi-fit repos');
  });

  it('a missing total line is a named violation', () => {
    const text = makeSourceText().replace('**Total: 3 + 0 = 3 repos.**\n', '');
    expectIssues(text, 'missing total line');
  });

  it('a duplicate total line is a named violation', () => {
    const text = makeSourceText().replace(
      '**Total: 3 + 0 = 3 repos.**',
      '**Total: 3 + 0 = 3 repos.**\n\n**Total: 3 + 0 = 3 repos.**',
    );
    expectIssues(text, 'duplicate total line');
  });

  it('stray prose after the scheme tables start is rejected', () => {
    const text = makeSourceText().replace(
      '| **Subtotal** | | **3** | |',
      '| **Subtotal** | | **3** | |\nSneaky prose between tables.',
    );
    expectIssues(text, 'unrecognized line inside the scheme zone');
  });

  it('content after the closing verification line is rejected', () => {
    const text = makeSourceText().replace(
      '**Verification: 3 repos classified, each with exactly one primary category.**',
      '**Verification: 3 repos classified, each with exactly one primary category.**\n\nTrailing junk.',
    );
    expectIssues(text, 'unexpected content after the verification line');
  });

  it('a section filed under the wrong kind h1 is rejected', () => {
    const text = makeSourceText().replace('# Infrastructure categories\n\n', '');
    expectIssues(text, 'missing required structure: # Infrastructure categories');
    expectIssues(text, 'filed under the domain h1');
  });
});

describe('round-2 strictness — marker spacing, typed subtotals, exact closers, dividers', () => {
  it('rejects a padded secondary label instead of trimming it', () => {
    const text = makeSourceText().replace(
      '[secondary: Design (UI/UX & Visual/Motion)]',
      '[secondary:  Design (UI/UX & Visual/Motion)]',
    );
    expectIssues(text, 'malformed [secondary: …] marker spacing');
  });

  it('rejects a doubled separator space before the marker', () => {
    const text = makeSourceText().replace(
      'Second fixture entry. [secondary:',
      'Second fixture entry.  [secondary:',
    );
    expectIssues(text, 'malformed [secondary: …] marker spacing');
  });

  it('rejects two domain subtotals masquerading as domain+infra', () => {
    const text = makeSourceText()
      .replace('| **Subtotal** | | **0** |', '| **Subtotal** | | **0** | |')
      .replace(
        '### Infrastructure categories (excluded from domain skill packs)',
        '### Infrastructure categories (excluded from domain skill packs) IGNORED',
      );
    const result = parseSkillsClassifiedSource(text);
    expect(result.ok).toBe(false);
  });

  it('rejects a total line before the subtotal rows', () => {
    const text = makeSourceText()
      .replace('Domain first, infrastructure last.', '**Total: 3 + 0 = 3 repos.**')
      .replace(
        '\n**Total: 3 + 0 = 3 repos.**\n\n---\n\n# Domain-skill categories',
        '\n\n---\n\n# Domain-skill categories',
      );
    expectIssues(text, 'total line before both subtotal rows');
  });

  it('rejects a verification line that does not close with **', () => {
    const text = makeSourceText().replace(
      '**Verification: 3 repos classified, each with exactly one primary category.**',
      '**Verification: 3 repos classified, each with exactly one primary category.',
    );
    expectIssues(text, 'malformed verification line');
  });

  it('rejects an hr after the verification line (the tail accepts nothing)', () => {
    const text = `${makeSourceText()}---\n`;
    expectIssues(text, 'unexpected content after the verification line');
  });

  it('rejects a data-bearing line hiding in the preamble', () => {
    const text = makeSourceText().replace(
      'Source: synthetic fixture.',
      '**Total: 9 + 9 = 18 repos.**',
    );
    expectIssues(text, 'data-bearing line in the preamble');
  });

  it('rejects a missing table divider', () => {
    const text = makeSourceText().replace('|---|---|---|---|\n', '');
    expectIssues(text, 'table row before the required divider');
  });

  it('rejects a divider whose column count disagrees with the table', () => {
    const text = makeSourceText().replace('|---|---|---|---|', '|---|---|---|');
    expectIssues(text, 'divider has 3 columns, expected 4');
  });

  it('rejects an entry name that is not <owner/name>', () => {
    const text = makeSourceText().replace(
      '- gamma/three (★30) — Third fixture entry.',
      '- gammathree (★30) — Third fixture entry.',
    );
    expectIssues(text, 'entry name is not <owner/name>');
  });
});

describe('round-3 strictness — reserved markers cannot degrade to prose; tables close', () => {
  it('rejects a malformed marker (missing space) instead of absorbing it into the summary', () => {
    const text = makeSourceText().replace(
      '[secondary: Design (UI/UX & Visual/Motion)]',
      '[secondary:Design (UI/UX & Visual/Motion)]',
    );
    expectIssues(text, 'malformed or repeated [secondary: ...] marker');
  });

  it('rejects repeated markers instead of validating only the last', () => {
    const text = makeSourceText().replace(
      '[secondary: Design (UI/UX & Visual/Motion)]',
      '[secondary: MCP Integrations] [secondary: Design (UI/UX & Visual/Motion)]',
    );
    expectIssues(text, '[secondary: ...] marker');
  });

  it('rejects a category row after its kind subtotal', () => {
    const text = makeSourceText().replace(
      '| **Subtotal** | | **3** | |',
      '| **Subtotal** | | **3** | |\n| Late Category | Late. | 0 | - |',
    );
    expectIssues(text, 'table row after the domain subtotal');
  });

  it('rejects any table row after the total line', () => {
    const text = makeSourceText().replace(
      '**Total: 3 + 0 = 3 repos.**',
      '**Total: 3 + 0 = 3 repos.**\n\n| Sneaky | Row. | 0 |',
    );
    expectIssues(text, 'table row after the total line');
  });
});

describe('hosted-review strictness — horizontal rules are boundary-only', () => {
  it('rejects an hr between entries inside a section', () => {
    const text = makeSourceText().replace(
      '- alpha/one (★10) — First fixture entry.',
      '- alpha/one (★10) — First fixture entry.\n\n---',
    );
    expectIssues(text, 'horizontal rule in a non-boundary position');
  });

  it('rejects an hr inside a scheme table', () => {
    const text = makeSourceText().replace(
      '| Verification & QA | Correctness-checking skills. | 2 | opus-pack |',
      '| Verification & QA | Correctness-checking skills. | 2 | opus-pack |\n\n---',
    );
    expectIssues(text, 'horizontal rule in a non-boundary position');
  });

  it('keeps the three legitimate boundary hrs accepted (baseline still clean)', () => {
    expect(parseSkillsClassifiedSource(makeSourceText()).ok).toBe(true);
  });
});

describe('grammar shape — malformed data-bearing lines fail closed, named with line numbers', () => {
  it('an entry bullet missing the star count is rejected', () => {
    const text = makeSourceText().replace(
      '- gamma/three (★30) — Third fixture entry.',
      '- gamma/three — Third fixture entry.',
    );
    expectIssues(text, 'entry bullet does not match');
  });

  it('prose inside a section zone is rejected (entries cannot be silently skipped)', () => {
    const text = makeSourceText().replace(
      '- gamma/three (★30) — Third fixture entry.',
      'Some stray prose.\n- gamma/three (★30) — Third fixture entry.',
    );
    expectIssues(text, 'unrecognized line inside the sections zone');
  });

  it('a section heading in a non-§4.9 form is rejected', () => {
    const text = makeSourceText().replace('## MCP Integrations (0)', '## MCP Integrations (zero)');
    expectIssues(text, 'section heading does not match');
  });
});
