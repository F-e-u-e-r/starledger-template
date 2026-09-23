/**
 * Synthetic fixtures for the generator tests. `makeSourceText()` emits a
 * MINIMAL source that satisfies every §4.9 grammar + cross-validation rule
 * (2 domain + 1 infrastructure category, 3 entries, one secondary, matching
 * counts/subtotals/total/multi-fit); tests then break exactly one axis via
 * string replacement. `makeStarsText()` emits a schema-valid stars.json.
 */

export function makeSourceText(): string {
  return [
    '# Skills Repo Classification (3 repos)',
    '',
    'Source: synthetic fixture.',
    '',
    '## Category scheme',
    '',
    'Domain first, infrastructure last.',
    '',
    '### Domain-skill categories',
    '',
    '| Category | Definition | Count | Target pack |',
    '|---|---|---|---|',
    '| Verification & QA | Correctness-checking skills. | 2 | opus-pack |',
    '| Design (UI/UX & Visual/Motion) | Design skills. | 1 | design-pack |',
    '| **Subtotal** | | **3** | |',
    '',
    '### Infrastructure categories (excluded from domain skill packs)',
    '',
    '| Category | Definition | Count |',
    '|---|---|---|',
    '| MCP Integrations | MCP servers. | 0 |',
    '| **Subtotal** | | **0** |',
    '',
    '**Total: 3 + 0 = 3 repos.**',
    '',
    '---',
    '',
    '# Domain-skill categories',
    '',
    '## Verification & QA (2) — target pack: **opus-pack**',
    '',
    '*Correctness-checking skills.*',
    '',
    '- alpha/one (★10) — First fixture entry.',
    '- beta/two (★20) — Second fixture entry. [secondary: Design (UI/UX & Visual/Motion)]',
    '',
    '## Design (UI/UX & Visual/Motion) (1) — target pack: **design-pack**',
    '',
    '*Design skills.*',
    '',
    '- gamma/three (★30) — Third fixture entry.',
    '',
    '# Infrastructure categories',
    '',
    '## MCP Integrations (0)',
    '',
    '*MCP servers.*',
    '',
    '---',
    '',
    '## Multi-fit repos (primary / secondary)',
    '',
    '1 of 3 repos carries a secondary tag.',
    '',
    '| Repo | Primary | Secondary |',
    '|---|---|---|',
    '| beta/two | Verification & QA | Design (UI/UX & Visual/Motion) |',
    '',
    '---',
    '',
    '**Verification: 3 repos classified, each with exactly one primary category.**',
    '',
  ].join('\n');
}

export interface StarsRepoSpec {
  name: string;
  id: string;
}

export function makeStarsText(repos: readonly StarsRepoSpec[]): string {
  return JSON.stringify({
    schema_version: '1.0',
    repos: repos.map(({ name, id }) => ({
      node_id: id,
      name_with_owner: name,
      owner: name.split('/')[0],
      name: name.split('/')[1],
      url: `https://github.com/${name}`,
      description: null,
      homepage_url: null,
      primary_language: null,
      topics: [],
      license_spdx: null,
      stargazer_count: 1,
      fork_count: 0,
      open_issues_count: 0,
      is_archived: false,
      is_disabled: false,
      is_fork: false,
      created_at: null,
      pushed_at: null,
      updated_at: null,
      latest_stable_release: null,
      latest_any_release: null,
      starred_at: '2026-08-01T00:00:00Z',
      hydration_status: 'ok',
      unavailable_fields: [],
    })),
  });
}

export function makeAliasesText(
  aliases: readonly { source_name_with_owner: string; node_id: string; reason: string }[],
): string {
  return JSON.stringify({ schema_version: '1.0', aliases });
}

export const FIXTURE_STARS: StarsRepoSpec[] = [
  { name: 'alpha/one', id: 'R_kgDOfix00001' },
  { name: 'beta/two', id: 'R_kgDOfix00002' },
  { name: 'gamma/three', id: 'R_kgDOfix00003' },
  { name: 'delta/unclassified', id: 'R_kgDOfix00004' },
];
