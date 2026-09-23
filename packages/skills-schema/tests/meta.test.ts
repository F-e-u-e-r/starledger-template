import { describe, expect, it } from 'vitest';
import {
  SkillsClassificationMetaSchema,
  checkSkillsMetaConsistency,
  serializeSkillsClassificationMeta,
} from '../src/meta';
import { sortEntries } from '../src/artifact';
import { makeArtifact, makeEntry, makeMeta } from './helpers';

describe('skills classification meta — schema', () => {
  it('accepts the canonical meta', () => {
    expect(SkillsClassificationMetaSchema.safeParse(makeMeta()).success).toBe(true);
  });

  it('rejects an unknown field (strict)', () => {
    expect(
      SkillsClassificationMetaSchema.safeParse({ ...makeMeta(), dataset_sha256: 'a'.repeat(64) })
        .success,
    ).toBe(false);
  });

  it.each([
    ['uppercase hex', 'A'.repeat(64)],
    ['63 chars', 'a'.repeat(63)],
    ['65 chars', 'a'.repeat(65)],
    ['non-hex', 'g'.repeat(64)],
  ])('rejects a malformed classification_sha256 (%s)', (_name, hash) => {
    expect(
      SkillsClassificationMetaSchema.safeParse(makeMeta({ classification_sha256: hash })).success,
    ).toBe(false);
  });

  it('rejects a non-UTC generated_at', () => {
    expect(
      SkillsClassificationMetaSchema.safeParse(
        makeMeta({ generated_at: '2026-08-13T00:00:00+02:00' }),
      ).success,
    ).toBe(false);
  });

  it.each([
    ['negative', -1],
    ['non-integer', 1.5],
  ])('rejects %s counts', (_name, value) => {
    expect(
      SkillsClassificationMetaSchema.safeParse(makeMeta({ category_count: value })).success,
    ).toBe(false);
  });

  it('rejects wrong version literals', () => {
    expect(
      SkillsClassificationMetaSchema.safeParse(makeMeta({ schema_version: '2.0' as never }))
        .success,
    ).toBe(false);
    expect(
      SkillsClassificationMetaSchema.safeParse(makeMeta({ taxonomy_version: 'skills-2' as never }))
        .success,
    ).toBe(false);
  });

  it.each([
    ['A-1', { resolved_entry_count: 1 }],
    ['A-2', { absent_repo_count: 5 }],
    ['A-3', { canonical_repo_count: 9 }],
  ])(
    'the SCHEMA itself rejects %s-inconsistent counts (meta-internal arithmetic)',
    (id, override) => {
      const result = SkillsClassificationMetaSchema.safeParse(makeMeta(override));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.message).join('\n')).toContain(id);
      }
    },
  );

  it('input-lineage hashes: null means absent-input, non-null must be hex64', () => {
    expect(SkillsClassificationMetaSchema.safeParse(makeMeta()).success).toBe(true);
    expect(
      SkillsClassificationMetaSchema.safeParse(
        makeMeta({ aliases_sha256: 'd'.repeat(64), prior_classification_sha256: 'e'.repeat(64) }),
      ).success,
    ).toBe(true);
    expect(
      SkillsClassificationMetaSchema.safeParse(makeMeta({ aliases_sha256: 'nope' })).success,
    ).toBe(false);
    expect(
      SkillsClassificationMetaSchema.safeParse(
        makeMeta({ prior_classification_sha256: 'E'.repeat(64) }),
      ).success,
    ).toBe(false);
  });
});

describe('C-1..C-4 / A-1..A-3 — meta ↔ artifact consistency', () => {
  it('returns no problems for a consistent pair', () => {
    expect(checkSkillsMetaConsistency(makeMeta(), makeArtifact())).toEqual([]);
  });

  it('handles the unresolved split (C-3/C-4 count by resolution)', () => {
    const artifact = makeArtifact({
      entries: sortEntries([
        makeEntry(),
        makeEntry({
          source_name_with_owner: 'gone/missing',
          node_id: null,
          resolution: 'missing_from_stars',
        }),
      ]),
    });
    const meta = makeMeta({
      resolved_entry_count: 1,
      unresolved_entry_count: 1,
      present_repo_count: 1,
      canonical_repo_count: 699,
    });
    expect(checkSkillsMetaConsistency(meta, artifact)).toEqual([]);
  });

  it.each([
    ['C-1', { category_count: 3 }],
    ['C-2', { source_entry_count: 3 }],
    ['C-3', { resolved_entry_count: 1, unresolved_entry_count: 1 }],
    ['A-2', { absent_repo_count: 5 }],
    ['A-3', { unclassified_repo_count: 1 }],
  ])('%s violation is named', (id, override) => {
    const problems = checkSkillsMetaConsistency(makeMeta(override), makeArtifact());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain(id);
  });

  it('C-4/A-1: an unresolved count that matches neither artifact nor arithmetic is doubly named', () => {
    const problems = checkSkillsMetaConsistency(
      makeMeta({ unresolved_entry_count: 1 }),
      makeArtifact(),
    );
    expect(problems.join('\n')).toContain('C-4');
    expect(problems.join('\n')).toContain('A-1');
  });

  it('reports every violation, not just the first', () => {
    const problems = checkSkillsMetaConsistency(
      makeMeta({ category_count: 9, source_entry_count: 9, canonical_repo_count: 9 }),
      makeArtifact(),
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('meta serializer — determinism', () => {
  it('emits fixed key order regardless of construction order', () => {
    const meta = makeMeta();
    const reordered = Object.fromEntries(Object.entries(meta).reverse()) as typeof meta;
    expect(serializeSkillsClassificationMeta(reordered)).toBe(
      serializeSkillsClassificationMeta(meta),
    );
  });

  it('emits 2-space indent, single trailing newline, byte-stable', () => {
    const bytes = serializeSkillsClassificationMeta(makeMeta());
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes.endsWith('\n\n')).toBe(false);
    expect(bytes).toContain('\n  "classification_sha256"');
    expect(bytes).toBe(serializeSkillsClassificationMeta(makeMeta()));
  });

  it('round-trips through the schema', () => {
    const bytes = serializeSkillsClassificationMeta(makeMeta());
    expect(SkillsClassificationMetaSchema.safeParse(JSON.parse(bytes)).success).toBe(true);
  });

  it('is fail-closed: refuses to serialize schema-invalid meta', () => {
    expect(() =>
      serializeSkillsClassificationMeta(makeMeta({ classification_sha256: 'not-a-hash' })),
    ).toThrow();
    expect(() => serializeSkillsClassificationMeta(makeMeta({ category_count: -1 }))).toThrow();
  });

  it('is fail-closed against arithmetically impossible counts (A-1..A-3 live in the schema)', () => {
    expect(() =>
      serializeSkillsClassificationMeta(makeMeta({ unresolved_entry_count: 3 })),
    ).toThrow();
  });

  it('canonical bytes match the golden declaration-order form exactly', () => {
    const golden = [
      '{',
      '  "schema_version": "1.0",',
      '  "taxonomy_version": "skills-1",',
      `  "classification_sha256": "${'a'.repeat(64)}",`,
      `  "source_sha256": "${'b'.repeat(64)}",`,
      '  "aliases_sha256": null,',
      '  "prior_classification_sha256": null,',
      `  "generated_against_stars_sha256": "${'c'.repeat(64)}",`,
      '  "generated_at": "2026-08-13T00:00:00Z",',
      '  "category_count": 2,',
      '  "source_entry_count": 2,',
      '  "resolved_entry_count": 2,',
      '  "present_repo_count": 2,',
      '  "absent_repo_count": 0,',
      '  "unresolved_entry_count": 0,',
      '  "canonical_repo_count": 700,',
      '  "unclassified_repo_count": 698',
      '}',
      '',
    ].join('\n');
    expect(serializeSkillsClassificationMeta(makeMeta())).toBe(golden);
  });
});
