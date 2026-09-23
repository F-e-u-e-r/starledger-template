import { describe, expect, it } from 'vitest';
import { SkillsAliasesSchema } from '../src/aliases';

function makeAlias(overrides: Record<string, unknown> = {}) {
  return {
    source_name_with_owner: 'jacob-bd/notebooklm-mcp-cli',
    node_id: 'R_kgDOalias001',
    reason: 'renamed to jacob-bd/gemini-notebook-mcp-cli; confirmed by owner.',
    ...overrides,
  };
}

describe('skills aliases map', () => {
  it('accepts an empty map and a populated map', () => {
    expect(SkillsAliasesSchema.safeParse({ schema_version: '1.0', aliases: [] }).success).toBe(
      true,
    );
    expect(
      SkillsAliasesSchema.safeParse({ schema_version: '1.0', aliases: [makeAlias()] }).success,
    ).toBe(true);
  });

  it('rejects unknown fields at both levels (strict)', () => {
    expect(
      SkillsAliasesSchema.safeParse({ schema_version: '1.0', aliases: [], extra: 1 }).success,
    ).toBe(false);
    expect(
      SkillsAliasesSchema.safeParse({
        schema_version: '1.0',
        aliases: [makeAlias({ confirmed: true })],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate source names case-insensitively', () => {
    expect(
      SkillsAliasesSchema.safeParse({
        schema_version: '1.0',
        aliases: [
          makeAlias(),
          makeAlias({
            source_name_with_owner: 'Jacob-BD/NotebookLM-MCP-CLI',
            node_id: 'R_kgDOother01',
          }),
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate node_ids', () => {
    expect(
      SkillsAliasesSchema.safeParse({
        schema_version: '1.0',
        aliases: [makeAlias(), makeAlias({ source_name_with_owner: 'other/name' })],
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty bounded reason', () => {
    expect(
      SkillsAliasesSchema.safeParse({
        schema_version: '1.0',
        aliases: [makeAlias({ reason: '' })],
      }).success,
    ).toBe(false);
    expect(
      SkillsAliasesSchema.safeParse({
        schema_version: '1.0',
        aliases: [makeAlias({ reason: 'x'.repeat(401) })],
      }).success,
    ).toBe(false);
  });

  it('rejects a wrong aliases schema_version literal', () => {
    expect(SkillsAliasesSchema.safeParse({ schema_version: '1.1', aliases: [] }).success).toBe(
      false,
    );
  });
});
