import { describe, expect, it } from 'vitest';
import {
  SkillsClassificationSchema,
  SkillsEntrySchema,
  buildSkillsClassification,
  serializeSkillsClassification,
  sortCategories,
  sortEntries,
} from '../src/artifact';
import { makeArtifact, makeCategory, makeEntry, makeScope } from './helpers';

describe('skills classification artifact — acceptance', () => {
  it('ACC-1: the canonical artifact passes', () => {
    expect(SkillsClassificationSchema.safeParse(makeArtifact()).success).toBe(true);
  });

  it('ACC-2: unresolved entries stay in entries with node_id null', () => {
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
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(true);
  });

  it('ACC-3: two unresolved entries do not collide on null node_id (I-2 scopes to non-null)', () => {
    const artifact = makeArtifact({
      entries: sortEntries([
        makeEntry({
          source_name_with_owner: 'gone/one',
          node_id: null,
          resolution: 'missing_from_stars',
        }),
        makeEntry({
          source_name_with_owner: 'gone/two',
          node_id: null,
          resolution: 'missing_from_stars',
        }),
      ]),
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(true);
  });

  it('ACC-4: legacy MDEw… and current R_… node ids both pass (no format regex)', () => {
    for (const nodeId of ['MDEwOlJlcG9zaXRvcnkx', 'R_kgDOxyz']) {
      expect(SkillsEntrySchema.safeParse(makeEntry({ node_id: nodeId })).success).toBe(true);
    }
  });
});

describe('strictness — the closed field set IS the contract', () => {
  it.each([
    ['root', () => ({ ...makeArtifact(), extra: 1 })],
    ['scope', () => makeArtifact({ scope: { ...makeScope(), extra: 1 } as never })],
    [
      'category',
      // Keep the default category ID SET intact (verification-qa + roadmap-planning)
      // so the fixture stays I-4-valid and the unknown field is the ONLY violation.
      () =>
        makeArtifact({
          categories: [
            { ...makeCategory(), extra: 1 } as never,
            makeCategory({ id: 'roadmap-planning', order: 1, target_pack: null }),
          ],
        }),
    ],
    [
      'entry (live-join field smuggled in)',
      () =>
        makeArtifact({
          entries: [{ ...makeEntry(), stars: 999 } as never],
        }),
    ],
  ])('rejects an unknown field on %s', (_level, build) => {
    expect(SkillsClassificationSchema.safeParse(build()).success).toBe(false);
  });

  it('rejects wrong schema_version / taxonomy_version literals', () => {
    expect(
      SkillsClassificationSchema.safeParse({ ...makeArtifact(), schema_version: '1.1' }).success,
    ).toBe(false);
    expect(
      SkillsClassificationSchema.safeParse({ ...makeArtifact(), taxonomy_version: 'skills-2' })
        .success,
    ).toBe(false);
  });

  it.each([
    [
      'kind',
      () =>
        makeArtifact({
          categories: [makeCategory({ kind: 'tooling' as never })],
          entries: [makeEntry()],
        }),
    ],
    [
      'target_pack',
      () =>
        makeArtifact({
          categories: [makeCategory({ target_pack: 'mega-pack' as never })],
          entries: [makeEntry()],
        }),
    ],
    ['resolution', () => makeArtifact({ entries: [makeEntry({ resolution: 'maybe' as never })] })],
  ])('rejects an out-of-enum %s value (closed enums)', (_name, build) => {
    expect(SkillsClassificationSchema.safeParse(build()).success).toBe(false);
  });
});

describe('I-1 / I-2 — identity uniqueness', () => {
  it('I-1: rejects duplicate source_name_with_owner, including case variants', () => {
    const exact = makeArtifact({
      entries: [makeEntry(), makeEntry({ node_id: 'R_kgDOother001' })],
    });
    expect(SkillsClassificationSchema.safeParse(exact).success).toBe(false);

    const cased = makeArtifact({
      entries: [
        makeEntry(),
        makeEntry({ source_name_with_owner: 'Obra/Superpowers', node_id: 'R_kgDOother001' }),
      ],
    });
    expect(SkillsClassificationSchema.safeParse(cased).success).toBe(false);
  });

  it('I-2: rejects a duplicated non-null node_id', () => {
    const artifact = makeArtifact({
      entries: sortEntries([
        makeEntry(),
        makeEntry({ source_name_with_owner: 'acme/tooling', node_id: 'R_kgDOalpha01' }),
      ]),
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(false);
  });
});

describe('I-3 — resolution ⟺ node_id nullability (both directions)', () => {
  it('rejects resolved + null node_id', () => {
    expect(
      SkillsEntrySchema.safeParse(makeEntry({ node_id: null, resolution: 'resolved' })).success,
    ).toBe(false);
  });

  it('rejects missing_from_stars + non-null node_id', () => {
    expect(
      SkillsEntrySchema.safeParse(makeEntry({ resolution: 'missing_from_stars' })).success,
    ).toBe(false);
  });
});

describe('I-4 — category references', () => {
  it('rejects a primary_category_id that references no category', () => {
    const artifact = makeArtifact({
      entries: [makeEntry({ primary_category_id: 'no-such-category' })],
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects a secondary category that references no category', () => {
    const artifact = makeArtifact({
      entries: [makeEntry({ secondary_category_ids: ['no-such-category'] })],
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects secondary === primary', () => {
    expect(
      SkillsEntrySchema.safeParse(makeEntry({ secondary_category_ids: ['verification-qa'] }))
        .success,
    ).toBe(false);
  });

  it('rejects more than SECONDARY_CATEGORY_MAX secondaries (v1: 1)', () => {
    expect(
      SkillsEntrySchema.safeParse(makeEntry({ secondary_category_ids: ['a-cat', 'b-cat'] }))
        .success,
    ).toBe(false);
  });
});

describe('I-5 — category order is a sorted permutation', () => {
  it.each([
    ['a gap (0,2)', [makeCategory(), makeCategory({ id: 'b-cat', order: 2 })]],
    ['a duplicate order', [makeCategory(), makeCategory({ id: 'b-cat', order: 0 })]],
    [
      'unsorted emission (1,0)',
      [makeCategory({ order: 1 }), makeCategory({ id: 'b-cat', order: 0 })],
    ],
  ])('rejects %s', (_name, categories) => {
    const artifact = makeArtifact({
      categories,
      entries: [makeEntry()],
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects duplicate category ids', () => {
    const artifact = makeArtifact({
      categories: [makeCategory(), makeCategory({ order: 1 })],
      entries: [makeEntry()],
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(false);
  });
});

describe('I-6 — entries sorted by lowercased record identity', () => {
  it('rejects unsorted entries', () => {
    const artifact = makeArtifact({
      entries: [
        makeEntry(),
        makeEntry({
          source_name_with_owner: 'acme/tooling',
          node_id: 'R_kgDOacme0001',
          primary_category_id: 'roadmap-planning',
        }),
      ],
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(false);
  });

  it('orders case-insensitively ("B/x" sorts after "a/y")', () => {
    const artifact = makeArtifact({
      entries: [
        makeEntry({ source_name_with_owner: 'a/y', node_id: 'R_kgDOaaaa0001' }),
        makeEntry({ source_name_with_owner: 'B/x', node_id: 'R_kgDObbbb0001' }),
      ],
    });
    expect(SkillsClassificationSchema.safeParse(artifact).success).toBe(true);
  });

  it('orders by CODEPOINT, not UTF-16 code units (supplementary plane sorts high)', () => {
    // U+FF61 (0xff61) < U+10000 by codepoint, but by UTF-16 code units the
    // surrogate pair (0xd800,0xdc00) sorts BELOW 0xff61 — the buggy order.
    const low = makeEntry({
      source_name_with_owner: 'a/｡',
      node_id: 'R_kgDOlow00001',
    });
    const high = makeEntry({
      source_name_with_owner: 'a/\u{10000}',
      node_id: 'R_kgDOhigh0001',
    });
    const codepointOrder = makeArtifact({ entries: [low, high] });
    expect(SkillsClassificationSchema.safeParse(codepointOrder).success).toBe(true);
    const codeUnitOrder = makeArtifact({ entries: [high, low] });
    expect(SkillsClassificationSchema.safeParse(codeUnitOrder).success).toBe(false);
    expect(sortEntries([high, low]).map((entry) => entry.source_name_with_owner)).toEqual([
      'a/｡',
      'a/\u{10000}',
    ]);
  });
});

describe('build + serialize — determinism (P7 §4.3)', () => {
  it('DET-1: object insertion order does not affect serialized bytes', () => {
    const entry = makeEntry();
    const reordered = {
      summary: entry.summary,
      secondary_category_ids: entry.secondary_category_ids,
      primary_category_id: entry.primary_category_id,
      resolution: entry.resolution,
      node_id: entry.node_id,
      source_name_with_owner: entry.source_name_with_owner,
    };
    const base = makeArtifact({ entries: [makeEntry()] });
    const input = { scope: base.scope, categories: base.categories, entries: [reordered] };
    const reference = { scope: base.scope, categories: base.categories, entries: [entry] };
    expect(serializeSkillsClassification(input)).toBe(serializeSkillsClassification(reference));
  });

  it('DET-2: build sorts unsorted categories and entries into I-5/I-6 order', () => {
    const base = makeArtifact();
    const built = buildSkillsClassification({
      scope: base.scope,
      categories: [...base.categories].reverse(),
      entries: [...base.entries].reverse(),
    });
    expect(built.categories.map((category) => category.order)).toEqual([0, 1]);
    expect(built.entries.map((entry) => entry.source_name_with_owner)).toEqual([
      'acme/tooling',
      'obra/superpowers',
    ]);
    expect(built.schema_version).toBe('1.0');
    expect(built.taxonomy_version).toBe('skills-1');
  });

  it('DET-3: emits 2-space indentation and a single trailing newline', () => {
    const base = makeArtifact();
    const bytes = serializeSkillsClassification(base);
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes.endsWith('\n\n')).toBe(false);
    expect(bytes).toContain('\n  "entries"');
  });

  it('DET-4: serialize → parse → schema round-trip is closed', () => {
    const bytes = serializeSkillsClassification(makeArtifact());
    const reparsed = SkillsClassificationSchema.safeParse(JSON.parse(bytes));
    expect(reparsed.success).toBe(true);
  });

  it('DET-5: identical inputs serialize byte-identically', () => {
    expect(serializeSkillsClassification(makeArtifact())).toBe(
      serializeSkillsClassification(makeArtifact()),
    );
  });

  it('serialize rejects invariant-violating input (it validates, never repairs)', () => {
    const base = makeArtifact();
    const dupJoin = {
      scope: base.scope,
      categories: base.categories,
      entries: [
        makeEntry(),
        makeEntry({ source_name_with_owner: 'acme/tooling', node_id: 'R_kgDOalpha01' }),
      ],
    };
    expect(() => serializeSkillsClassification(dupJoin)).toThrow();
  });

  it('DET-6: canonical bytes match the golden declaration-order form exactly', () => {
    // Insertion-order independence (DET-1) alone would pass a consistently
    // WRONG key order; this pins the exact §4.3 bytes.
    const bytes = serializeSkillsClassification({
      scope: makeScope(),
      categories: [makeCategory()],
      entries: [makeEntry()],
    });
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
      '      "definition": "Skills and harnesses that verify agent output.",',
      '      "order": 0,',
      '      "target_pack": "opus-pack"',
      '    }',
      '  ],',
      '  "entries": [',
      '    {',
      '      "source_name_with_owner": "obra/superpowers",',
      '      "node_id": "R_kgDOalpha01",',
      '      "resolution": "resolved",',
      '      "primary_category_id": "verification-qa",',
      '      "secondary_category_ids": [],',
      '      "summary": "Curated one-liner for the entry."',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n');
    expect(bytes).toBe(golden);
  });

  it('sortCategories / sortEntries are pure (input arrays untouched)', () => {
    const categories = [makeCategory({ order: 1 }), makeCategory({ id: 'b-cat', order: 0 })];
    const entries = [
      makeEntry(),
      makeEntry({ source_name_with_owner: 'acme/tooling', node_id: 'R_x' }),
    ];
    sortCategories(categories);
    sortEntries(entries);
    expect(categories[0]?.order).toBe(1);
    expect(entries[0]?.source_name_with_owner).toBe('obra/superpowers');
  });
});
