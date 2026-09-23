import { describe, expect, it } from 'vitest';
import { SkillsClassificationMetaSchema, SkillsClassificationSchema } from '@starred/skills-schema';
import { generateSkillsClassification, type GenerateInputs } from '../src/generate';
import { sha256 } from '../src/hash';
import { FIXTURE_STARS, makeAliasesText, makeSourceText, makeStarsText } from './helpers';

const GENERATED_AT = '2026-08-14T00:00:00Z';

function inputs(overrides: Partial<GenerateInputs> = {}): GenerateInputs {
  return {
    sourceText: makeSourceText(),
    aliasesText: null,
    priorText: null,
    starsText: makeStarsText(FIXTURE_STARS),
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}

describe('generation happy path — counts derived from resolved records (gate 6)', () => {
  const result = generateSkillsClassification(inputs());

  it('emits a schema-valid artifact and meta', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(SkillsClassificationSchema.safeParse(JSON.parse(result.artifactBytes)).success).toBe(
      true,
    );
    expect(SkillsClassificationMetaSchema.safeParse(JSON.parse(result.metaBytes)).success).toBe(
      true,
    );
  });

  it('derives every count from the validated records against the snapshot', () => {
    if (!result.ok) return;
    expect(result.meta).toMatchObject({
      category_count: 3,
      source_entry_count: 3,
      resolved_entry_count: 3,
      present_repo_count: 3,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 4, // delta/unclassified exists only in stars
      unclassified_repo_count: 1,
    });
    expect(result.coverage).toEqual({ matched: 3, unclassified: 1, unresolved: 0 });
  });

  it('fingerprints every input (§4.3 lineage): source + stars always, aliases/prior null when absent', () => {
    if (!result.ok) return;
    expect(result.meta.source_sha256).toBe(sha256(makeSourceText()));
    expect(result.meta.generated_against_stars_sha256).toBe(sha256(makeStarsText(FIXTURE_STARS)));
    expect(result.meta.aliases_sha256).toBeNull();
    expect(result.meta.prior_classification_sha256).toBeNull();
    expect(result.meta.classification_sha256).toBe(sha256(result.artifactBytes));
  });
});

describe('determinism per artifact (§4.3, gate 5)', () => {
  it('identical inputs ⇒ byte-identical artifact AND meta (same injected clock)', () => {
    const first = generateSkillsClassification(inputs());
    const second = generateSkillsClassification(inputs());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.artifactBytes).toBe(first.artifactBytes);
    expect(second.metaBytes).toBe(first.metaBytes);
  });

  it('a different clock changes ONLY meta.generated_at — the data artifact is clock-free', () => {
    const first = generateSkillsClassification(inputs());
    const second = generateSkillsClassification(inputs({ generatedAt: '2026-08-15T12:34:56Z' }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.artifactBytes).toBe(first.artifactBytes);
    const firstMeta = { ...first.meta, generated_at: 'X' };
    const secondMeta = { ...second.meta, generated_at: 'X' };
    expect(secondMeta).toEqual(firstMeta);
    expect(second.meta.generated_at).toBe('2026-08-15T12:34:56Z');
  });
});

describe('unresolved / absent derivations', () => {
  it('an entry missing from stars stays retained as missing_from_stars and counts as unresolved', () => {
    const stars = makeStarsText(FIXTURE_STARS.filter((repo) => repo.name !== 'gamma/three'));
    const result = generateSkillsClassification(inputs({ starsText: stars }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const artifact = SkillsClassificationSchema.parse(JSON.parse(result.artifactBytes));
    const gamma = artifact.entries.find((entry) => entry.source_name_with_owner === 'gamma/three');
    expect(gamma).toMatchObject({ node_id: null, resolution: 'missing_from_stars' });
    expect(result.meta).toMatchObject({
      resolved_entry_count: 2,
      unresolved_entry_count: 1,
      present_repo_count: 2,
      absent_repo_count: 0,
      unclassified_repo_count: 1,
    });
  });

  it('an alias-recovered id absent from the snapshot counts absent (resolved = present + absent)', () => {
    const stars = makeStarsText(FIXTURE_STARS.filter((repo) => repo.name !== 'gamma/three'));
    const aliases = makeAliasesText([
      {
        source_name_with_owner: 'gamma/three',
        node_id: 'R_kgDOunstarred',
        reason: 'renamed then unstarred; confirmed by owner.',
      },
    ]);
    const result = generateSkillsClassification(inputs({ starsText: stars, aliasesText: aliases }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta).toMatchObject({
      resolved_entry_count: 3,
      present_repo_count: 2,
      absent_repo_count: 1,
      unresolved_entry_count: 0,
    });
    expect(result.meta.aliases_sha256).toBe(sha256(aliases));
  });
});

describe('prior lineage (§4.4/§4.6, gates 3 + 4)', () => {
  function priorArtifactText(): string {
    // A prior whose stored ids AGREE with today's exact matches — output will
    // equal a no-prior run, which is exactly gate 3's trap.
    const base = generateSkillsClassification(inputs());
    if (!base.ok) throw new Error('fixture generation failed');
    return base.artifactBytes;
  }

  it('GATE-3: a consumed prior is lineage-bearing even when the output equals a no-prior run', () => {
    const prior = priorArtifactText();
    const withPrior = generateSkillsClassification(inputs({ priorText: prior }));
    const withoutPrior = generateSkillsClassification(inputs());
    expect(withPrior.ok && withoutPrior.ok).toBe(true);
    if (!withPrior.ok || !withoutPrior.ok) return;
    expect(withPrior.artifactBytes).toBe(withoutPrior.artifactBytes);
    expect(withPrior.meta.prior_classification_sha256).toBe(sha256(prior));
    expect(withoutPrior.meta.prior_classification_sha256).toBeNull();
  });

  it('prior keeps a renamed entry resolved (sticky) when the exact match disappears', () => {
    const prior = priorArtifactText();
    const stars = makeStarsText([
      ...FIXTURE_STARS.filter((repo) => repo.name !== 'gamma/three'),
      // renamed on GitHub: same node_id, new name — exact match now misses.
      { name: 'gamma/renamed-three', id: 'R_kgDOfix00003' },
    ]);
    const result = generateSkillsClassification(inputs({ priorText: prior, starsText: stars }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const artifact = SkillsClassificationSchema.parse(JSON.parse(result.artifactBytes));
    const gamma = artifact.entries.find((entry) => entry.source_name_with_owner === 'gamma/three');
    expect(gamma).toMatchObject({ node_id: 'R_kgDOfix00003', resolution: 'resolved' });
    expect(result.meta.present_repo_count).toBe(3);
  });

  it('GATE-4: a prior that fails the current schema FAILS the build with the §4.6 escape named — never a silent no-prior fallback', () => {
    const result = generateSkillsClassification(
      inputs({ priorText: JSON.stringify({ schema_version: '0.9', bogus: true }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join('\n')).toContain('regenerate-without-prior');
  });

  it('GATE-4: a prior that is not JSON fails loudly with the escape named', () => {
    const result = generateSkillsClassification(inputs({ priorText: '{corrupt' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join('\n')).toContain('invalid JSON');
    expect(result.issues.join('\n')).toContain('regenerate-without-prior');
  });
});

describe('fail-closed inputs (§4.5 build column)', () => {
  it('a present-but-invalid aliases file fails (absent is the only soft case)', () => {
    const result = generateSkillsClassification(
      inputs({ aliasesText: JSON.stringify({ schema_version: '1.0', aliases: [{ bad: 1 }] }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join('\n')).toContain('skills-aliases.json');
  });

  it('schema-invalid stars fails — no resolution basis', () => {
    const result = generateSkillsClassification(
      inputs({ starsText: JSON.stringify({ schema_version: '1.0', repos: [{ nope: 1 }] }) }),
    );
    expect(result.ok).toBe(false);
  });

  it('a resolution conflict propagates as a build failure', () => {
    const aliases = makeAliasesText([
      {
        source_name_with_owner: 'alpha/one',
        node_id: 'R_kgDOdifferent',
        reason: 'stale mapping kept for the conflict test.',
      },
    ]);
    const result = generateSkillsClassification(inputs({ aliasesText: aliases }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join('\n')).toContain('resolution conflict for alpha/one');
  });

  it('a source grammar violation refuses to emit', () => {
    const result = generateSkillsClassification(
      inputs({ sourceText: makeSourceText().replace('| 2 | opus-pack |', '| 2 | opus-pack! |') }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('golden end-to-end bytes (gate 5 — exact canonical form of the data artifact)', () => {
  it('the synthetic fixture generates exactly the golden artifact bytes', () => {
    const result = generateSkillsClassification(inputs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const golden = [
      '{',
      '  "schema_version": "1.0",',
      '  "taxonomy_version": "skills-1",',
      '  "scope": {',
      '    "id": "coding-agent-skills-ecosystem",',
      '    "label": "Coding-agent skills ecosystem",',
      '    "description": "A curated subset; absence is not a classification."',
      '  },',
      '  "categories": [',
      '    {',
      '      "id": "verification-qa",',
      '      "label": "Verification & QA",',
      '      "kind": "domain",',
      '      "definition": "Correctness-checking skills.",',
      '      "order": 0,',
      '      "target_pack": "opus-pack"',
      '    },',
      '    {',
      '      "id": "design-ui-ux-visual-motion",',
      '      "label": "Design (UI/UX & Visual/Motion)",',
      '      "kind": "domain",',
      '      "definition": "Design skills.",',
      '      "order": 1,',
      '      "target_pack": "design-pack"',
      '    },',
      '    {',
      '      "id": "mcp-integrations",',
      '      "label": "MCP Integrations",',
      '      "kind": "infrastructure",',
      '      "definition": "MCP servers.",',
      '      "order": 2,',
      '      "target_pack": null',
      '    }',
      '  ],',
      '  "entries": [',
      '    {',
      '      "source_name_with_owner": "alpha/one",',
      '      "node_id": "R_kgDOfix00001",',
      '      "resolution": "resolved",',
      '      "primary_category_id": "verification-qa",',
      '      "secondary_category_ids": [],',
      '      "summary": "First fixture entry."',
      '    },',
      '    {',
      '      "source_name_with_owner": "beta/two",',
      '      "node_id": "R_kgDOfix00002",',
      '      "resolution": "resolved",',
      '      "primary_category_id": "verification-qa",',
      '      "secondary_category_ids": [',
      '        "design-ui-ux-visual-motion"',
      '      ],',
      '      "summary": "Second fixture entry."',
      '    },',
      '    {',
      '      "source_name_with_owner": "gamma/three",',
      '      "node_id": "R_kgDOfix00003",',
      '      "resolution": "resolved",',
      '      "primary_category_id": "design-ui-ux-visual-motion",',
      '      "secondary_category_ids": [],',
      '      "summary": "Third fixture entry."',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n');
    expect(result.artifactBytes).toBe(golden);
  });
});
