import { describe, expect, it } from 'vitest';
import { loadAnnotations } from './load-annotations';

function metaDoc(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: '1.0',
    annotations_sha256: 'a'.repeat(64),
    annotation_count: 1,
    taxonomy_version: '1',
    dataset_sha256: '0'.repeat(64),
    generated_at: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

function annotationsDoc(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: '1.0',
    taxonomy_version: '1',
    annotations: [
      {
        node_id: 'R_1',
        category: 'developer-tools',
        tags: ['automation', 'cli'],
        summary:
          'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
        source: {
          kind: 'metadata',
          readme_path: null,
          readme_oid: null,
          repo_metadata_sha256: 'b'.repeat(64),
          fingerprint: 'c'.repeat(64),
        },
        generation: {
          executor_kind: 'claude-routine',
          execution_profile_version: 'agent-v1',
          model_label: 'informational-only',
          prompt_version: 'classify-v1',
          generated_at: '2026-06-20T00:00:00Z',
        },
      },
    ],
    ...overrides,
  };
}

function fetchOf(
  meta: { ok: boolean; body?: unknown },
  ann: { ok: boolean; text?: string },
): typeof fetch {
  return ((input: RequestInfo | URL) => {
    if (String(input).includes('ai-annotations-meta.json')) {
      return Promise.resolve({
        ok: meta.ok,
        status: meta.ok ? 200 : 404,
        json: () => Promise.resolve(meta.body),
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: ann.ok,
      status: ann.ok ? 200 : 404,
      text: () => Promise.resolve(ann.text ?? ''),
    } as unknown as Response);
  }) as typeof fetch;
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('loadAnnotations (fail-soft AI loading)', () => {
  it('LOAD-1: a valid AI artifact loads and is keyed by node_id', async () => {
    const result = await loadAnnotations({
      fetchImpl: fetchOf(
        { ok: true, body: metaDoc() },
        { ok: true, text: JSON.stringify(annotationsDoc()) },
      ),
      verifyBytes: false,
    });
    expect(result?.byNodeId.get('R_1')?.category).toBe('developer-tools');
    expect(result?.byNodeId.get('R_1')?.tags).toEqual(['automation', 'cli']);
    expect(result?.generatedAt).toBe('2026-06-20T00:00:00Z');
  });

  it('LOAD-1: verifies the annotation bytes against the meta hash', async () => {
    const text = JSON.stringify(annotationsDoc());
    const result = await loadAnnotations({
      fetchImpl: fetchOf(
        { ok: true, body: metaDoc({ annotations_sha256: await sha256(text) }) },
        { ok: true, text },
      ),
    });
    expect(result?.byNodeId.has('R_1')).toBe(true);
  });

  it('LOAD-2: a missing AI artifact (404) is fail-soft → null', async () => {
    expect(await loadAnnotations({ fetchImpl: fetchOf({ ok: false }, { ok: false }) })).toBeNull();
  });

  it('LOAD-3: an unsupported taxonomy version is fail-soft → null', async () => {
    const result = await loadAnnotations({
      fetchImpl: fetchOf(
        { ok: true, body: metaDoc({ taxonomy_version: '2' }) },
        { ok: true, text: JSON.stringify(annotationsDoc({ taxonomy_version: '2' })) },
      ),
      verifyBytes: false,
    });
    expect(result).toBeNull();
  });

  it('LOAD-3: a malformed annotation is fail-soft → null', async () => {
    const result = await loadAnnotations({
      fetchImpl: fetchOf(
        { ok: true, body: metaDoc() },
        { ok: true, text: JSON.stringify(annotationsDoc({ annotations: [{ node_id: 'R_1' }] })) },
      ),
      verifyBytes: false,
    });
    expect(result).toBeNull();
  });

  it('LOAD-4: a hash mismatch is fail-soft → null', async () => {
    const result = await loadAnnotations({
      fetchImpl: fetchOf(
        { ok: true, body: metaDoc({ annotations_sha256: 'f'.repeat(64) }) },
        { ok: true, text: JSON.stringify(annotationsDoc()) },
      ),
    });
    expect(result).toBeNull();
  });
});

function validAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    node_id: 'R_1',
    category: 'developer-tools',
    tags: ['automation', 'cli'],
    summary:
      'A concise, factual description of what this repository does, who it is for, and why it is useful to developers.',
    source: {
      kind: 'metadata',
      readme_path: null,
      readme_oid: null,
      repo_metadata_sha256: 'b'.repeat(64),
      fingerprint: 'c'.repeat(64),
    },
    generation: {
      executor_kind: 'claude-routine',
      execution_profile_version: 'agent-v1',
      model_label: 'informational-only',
      prompt_version: 'classify-v1',
      generated_at: '2026-06-20T00:00:00Z',
    },
    ...overrides,
  };
}

describe('loadAnnotations enforces the full artifact contract (fail-soft)', () => {
  const cases: Array<[string, unknown]> = [
    ['unknown category', validAnnotation({ category: 'not-a-category' })],
    ['unknown tag', validAnnotation({ tags: ['not-a-real-tag'] })],
    ['duplicate tags', validAnnotation({ tags: ['cli', 'cli'] })],
    ['unsorted tags', validAnnotation({ tags: ['cli', 'automation'] })],
    [
      'too many tags',
      validAnnotation({
        tags: ['api', 'automation', 'backend', 'cli', 'database', 'editor', 'frontend'],
      }),
    ],
    ['summary too short', validAnnotation({ summary: 'too short' })],
    [
      'invalid generated_at',
      validAnnotation({
        generation: {
          executor_kind: 'claude-routine',
          execution_profile_version: 'agent-v1',
          model_label: null,
          prompt_version: 'classify-v1',
          generated_at: 'not-a-date',
        },
      }),
    ],
    [
      'missing source',
      (() => {
        const a = validAnnotation();
        delete (a as Record<string, unknown>).source;
        return a;
      })(),
    ],
    [
      'missing generation',
      (() => {
        const a = validAnnotation();
        delete (a as Record<string, unknown>).generation;
        return a;
      })(),
    ],
    ['unknown field', validAnnotation({ surprise: true })],
  ];

  it.each(cases)(
    'rejects a hash-VALID but schema-invalid artifact (%s) → null',
    async (_label, annotation) => {
      // Genuinely hash-valid: compute the real digest so the byte check PASSES and
      // only the shared schema rejects it.
      const text = JSON.stringify(annotationsDoc({ annotations: [annotation] }));
      const result = await loadAnnotations({
        fetchImpl: fetchOf(
          { ok: true, body: metaDoc({ annotations_sha256: await sha256(text) }) },
          { ok: true, text },
        ),
      });
      expect(result).toBeNull();
    },
  );

  it('rejects a hash-valid artifact whose annotations are not sorted by node_id', async () => {
    const text = JSON.stringify(
      annotationsDoc({
        annotations: [validAnnotation({ node_id: 'R_2' }), validAnnotation({ node_id: 'R_1' })],
      }),
    );
    const result = await loadAnnotations({
      fetchImpl: fetchOf(
        {
          ok: true,
          body: metaDoc({ annotation_count: 2, annotations_sha256: await sha256(text) }),
        },
        { ok: true, text },
      ),
    });
    expect(result).toBeNull();
  });
});

describe('loadAnnotations enforces the meta contract (fail-soft)', () => {
  const metaCases: Array<[string, unknown]> = [
    ['invalid dataset_sha256', metaDoc({ dataset_sha256: 'not-hex' })],
    ['bad annotations_sha256', metaDoc({ annotations_sha256: 'short' })],
    ['non-UTC generated_at', metaDoc({ generated_at: '2026-06-20 00:00:00' })],
    ['unknown field', metaDoc({ surprise: true })],
    [
      'missing dataset_sha256',
      (() => {
        const m = metaDoc();
        delete (m as Record<string, unknown>).dataset_sha256;
        return m;
      })(),
    ],
  ];

  it.each(metaCases)(
    'rejects an invalid ai-annotations-meta.json (%s) → null',
    async (_label, meta) => {
      const result = await loadAnnotations({
        fetchImpl: fetchOf(
          { ok: true, body: meta },
          { ok: true, text: JSON.stringify(annotationsDoc()) },
        ),
        verifyBytes: false,
      });
      expect(result).toBeNull();
    },
  );
});
