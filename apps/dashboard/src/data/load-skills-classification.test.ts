import {
  serializeSkillsClassification,
  serializeSkillsClassificationMeta,
  type SkillsClassificationInput,
  type SkillsClassificationMeta,
} from '@starred/skills-schema/contracts';
import { describe, expect, it } from 'vitest';
import { loadSkillsClassification } from './load-skills-classification';

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function artifactInput(): SkillsClassificationInput {
  return {
    scope: {
      id: 'coding-agent-skills-ecosystem',
      label: 'Coding-agent skills ecosystem',
      description: 'A curated subset; absence is not a classification.',
    },
    categories: [
      {
        id: 'verification-qa',
        label: 'Verification & QA',
        kind: 'domain',
        definition: 'Correctness-checking skills.',
        order: 0,
        target_pack: 'opus-pack',
      },
      {
        id: 'mcp-integrations',
        label: 'MCP Integrations',
        kind: 'infrastructure',
        definition: 'MCP servers.',
        order: 1,
        target_pack: null,
      },
    ],
    entries: [
      {
        source_name_with_owner: 'alpha/one',
        node_id: 'R_kgDOload0001',
        resolution: 'resolved',
        primary_category_id: 'verification-qa',
        secondary_category_ids: ['mcp-integrations'],
        summary: 'Loader fixture entry.',
      },
      {
        source_name_with_owner: 'gone/missing',
        node_id: null,
        resolution: 'missing_from_stars',
        primary_category_id: 'verification-qa',
        secondary_category_ids: [],
        summary: 'Unresolved fixture entry.',
      },
    ],
  };
}

async function validPair(
  metaOverrides: Partial<SkillsClassificationMeta> = {},
): Promise<{ artifactText: string; metaText: string }> {
  const artifactText = serializeSkillsClassification(artifactInput());
  const meta: SkillsClassificationMeta = {
    schema_version: '1.0',
    taxonomy_version: 'skills-1',
    classification_sha256: await sha256(artifactText),
    source_sha256: 'b'.repeat(64),
    aliases_sha256: null,
    prior_classification_sha256: null,
    generated_against_stars_sha256: 'c'.repeat(64),
    generated_at: '2026-08-14T00:00:00Z',
    category_count: 2,
    source_entry_count: 2,
    resolved_entry_count: 1,
    present_repo_count: 1,
    absent_repo_count: 0,
    unresolved_entry_count: 1,
    canonical_repo_count: 700,
    unclassified_repo_count: 699,
    ...metaOverrides,
  };
  return { artifactText, metaText: serializeSkillsClassificationMeta(meta) };
}

function fetchOf(
  meta: { ok: boolean; text?: string },
  artifact: { ok: boolean; text?: string },
): typeof fetch {
  return ((input: RequestInfo | URL) => {
    if (String(input).includes('skills-classification-meta.json')) {
      // A REAL Response for meta too — the loader reads it as BYTES now.
      return Promise.resolve(new Response(meta.text ?? '', { status: meta.ok ? 200 : 404 }));
    }
    // A REAL Response for the artifact body: integrity is a byte contract, and
    // a double exposing only `text()` cannot express the bytes-vs-decoded-text
    // distinction the loader now enforces (review finding F6).
    return Promise.resolve(new Response(artifact.text ?? '', { status: artifact.ok ? 200 : 404 }));
  }) as typeof fetch;
}

describe('loadSkillsClassification — §4.10 acceptance matrix, loader rows', () => {
  it('MATRIX-1 happy path: ready with exact node_id-keyed join material', async () => {
    const { artifactText, metaText } = await validPair();
    const result = await loadSkillsClassification({
      fetchImpl: fetchOf({ ok: true, text: metaText }, { ok: true, text: artifactText }),
    });
    expect(result).not.toBeNull();
    expect(result!.byNodeId.size).toBe(1);
    expect(result!.byNodeId.get('R_kgDOload0001')).toEqual({
      primaryCategoryId: 'verification-qa',
      secondaryCategoryIds: ['mcp-integrations'],
      summary: 'Loader fixture entry.',
    });
    expect(result!.categories.map((category) => category.id)).toEqual([
      'verification-qa',
      'mcp-integrations',
    ]);
    expect(result!.scope.id).toBe('coding-agent-skills-ecosystem');
    expect(result!.coverage).toEqual({ matched: 1, unclassified: 699, unresolved: 1 });
  });

  it('MATRIX-1b: unresolved entries never join — counts only (locked decision 4)', async () => {
    const { artifactText, metaText } = await validPair();
    const result = await loadSkillsClassification({
      fetchImpl: fetchOf({ ok: true, text: metaText }, { ok: true, text: artifactText }),
    });
    expect(result!.byNodeId.has('gone/missing')).toBe(false);
    expect([...result!.byNodeId.keys()]).toEqual(['R_kgDOload0001']);
    expect(result!.coverage.unresolved).toBe(1);
  });

  it('MATRIX-2 data artifact missing → null', async () => {
    const { metaText } = await validPair();
    expect(
      await loadSkillsClassification({
        fetchImpl: fetchOf({ ok: true, text: metaText }, { ok: false }),
      }),
    ).toBeNull();
  });

  it('MATRIX-3 meta missing → null (artifact side fully valid — independent row)', async () => {
    const { artifactText } = await validPair();
    expect(
      await loadSkillsClassification({
        fetchImpl: fetchOf({ ok: false }, { ok: true, text: artifactText }),
      }),
    ).toBeNull();
  });

  it('MATRIX-7b response-body read failure → null', async () => {
    const { metaText } = await validPair();
    const readRejectingFetch = ((input: RequestInfo | URL) => {
      if (String(input).includes('skills-classification-meta.json')) {
        return Promise.resolve(new Response(metaText, { status: 200 }));
      }
      // The double must reject on the method the loader ACTUALLY calls. An
      // earlier version only implemented a rejecting `text()`, so it passed
      // against both implementations for the wrong reason — the byte-reading
      // loader merely tripped over a missing `arrayBuffer`, which is a broken
      // double, not a body-read failure.
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.reject(new Error('stream reset')),
        text: () => Promise.reject(new Error('stream reset')),
      } as unknown as Response);
    }) as typeof fetch;
    expect(await loadSkillsClassification({ fetchImpl: readRejectingFetch })).toBeNull();
  });

  it('MATRIX-4 data malformed JSON → null (hash matches the corrupt bytes — parse stage isolated)', async () => {
    const corrupt = '{corrupt';
    const { metaText } = await validPair({ classification_sha256: await sha256(corrupt) });
    const result = await loadSkillsClassification({
      fetchImpl: fetchOf({ ok: true, text: metaText }, { ok: true, text: corrupt }),
    });
    expect(result).toBeNull();
  });

  it('MATRIX-4b NO PARTIAL SALVAGE: one bad entry rejects the whole layer (locked decision 2)', async () => {
    // Hand-corrupt ONE entry (resolution says resolved, node_id null — an I-3
    // breach) inside otherwise valid bytes: a per-record salvager would keep
    // the good entry and go ready; the contract demands null.
    const { artifactText } = await validPair();
    const corrupted = artifactText.replace('"node_id": "R_kgDOload0001"', '"node_id": null');
    const { metaText } = await validPair({ classification_sha256: await sha256(corrupted) });
    const result = await loadSkillsClassification({
      fetchImpl: fetchOf({ ok: true, text: metaText }, { ok: true, text: corrupted }),
    });
    expect(result).toBeNull();
  });

  it('MATRIX-5 meta malformed → null', async () => {
    const { artifactText, metaText } = await validPair();
    expect(
      await loadSkillsClassification({
        fetchImpl: fetchOf(
          { ok: true, text: metaText.replace('"category_count": 2', '"category_count": -1') },
          { ok: true, text: artifactText },
        ),
      }),
    ).toBeNull();
  });

  it('MATRIX-6 unsupported schema/taxonomy version → null (literal match)', async () => {
    const { artifactText, metaText } = await validPair();
    expect(
      await loadSkillsClassification({
        fetchImpl: fetchOf(
          {
            ok: true,
            text: metaText.replace('"schema_version": "1.0"', '"schema_version": "1.1"'),
          },
          { ok: true, text: artifactText },
        ),
      }),
    ).toBeNull();
    expect(
      await loadSkillsClassification({
        fetchImpl: fetchOf(
          {
            ok: true,
            text: metaText.replace(
              '"taxonomy_version": "skills-1"',
              '"taxonomy_version": "skills-2"',
            ),
          },
          { ok: true, text: artifactText },
        ),
      }),
    ).toBeNull();
  });

  it('MATRIX-7 network failure → null', async () => {
    const throwingFetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await loadSkillsClassification({ fetchImpl: throwingFetch })).toBeNull();
  });

  it('integrity: byte-hash mismatch → null', async () => {
    const { artifactText, metaText } = await validPair();
    const tampered = artifactText.replace('Loader fixture entry.', 'Tampered fixture entry.');
    expect(
      await loadSkillsClassification({
        fetchImpl: fetchOf({ ok: true, text: metaText }, { ok: true, text: tampered }),
      }),
    ).toBeNull();
  });

  it('consistency: a meta↔artifact mismatch that meta-internal arithmetic CANNOT catch → null (the cross-check is load-bearing)', async () => {
    // resolved 2 + unresolved 0 keeps A-1 (2 = 2+0), A-2 (2 = 2+0), A-3
    // (2 + 698 = 700) all green — the meta parses clean on its own. Only
    // checkSkillsMetaConsistency (C-3/C-4 against the artifact) can reject it,
    // so deleting the loader's cross-check call makes this test fail.
    const { artifactText, metaText } = await validPair();
    expect(
      await loadSkillsClassification({
        fetchImpl: fetchOf(
          {
            ok: true,
            text: metaText
              .replace('"resolved_entry_count": 1', '"resolved_entry_count": 2')
              .replace('"unresolved_entry_count": 1', '"unresolved_entry_count": 0')
              .replace('"present_repo_count": 1', '"present_repo_count": 2')
              .replace('"unclassified_repo_count": 699', '"unclassified_repo_count": 698'),
          },
          { ok: true, text: artifactText },
        ),
      }),
    ).toBeNull();
  });

  it('MATRIX-9 PROVENANCE IS NOT A GATE: any generated_against_stars_sha256 still loads ready (locked decision 3)', async () => {
    for (const snapshotHash of ['c'.repeat(64), 'f'.repeat(64)]) {
      const { artifactText, metaText } = await validPair({
        generated_against_stars_sha256: snapshotHash,
      });
      const result = await loadSkillsClassification({
        fetchImpl: fetchOf({ ok: true, text: metaText }, { ok: true, text: artifactText }),
      });
      expect(result).not.toBeNull();
      expect(result!.generatedAgainstStarsSha256).toBe(snapshotHash);
    }
  });
});
