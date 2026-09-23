import { createHash } from 'node:crypto';
import {
  serializeSkillsClassification,
  serializeSkillsClassificationMeta,
  type SkillsClassificationInput,
  type SkillsClassificationMeta,
} from '@starred/skills-schema/contracts';
import { describe, expect, it } from 'vitest';
import { makeRepo, makeStarsFile } from '../test-utils';
import { loadAnnotations } from './load-annotations';
import { loadDiscovery } from './load-discovery';
import { loadSkillsClassification } from './load-skills-classification';
import { DataLoadError, loadStars } from './load-stars';

/**
 * INTEGRITY IS A BYTE CONTRACT (P7 §4.10; the same guarantee every loader's
 * own docstring already claims).
 *
 * Every loader publishes a `*_sha256` digest that is generated over the EXACT
 * bytes of the artifact. Verifying it against `await res.text()` does not check
 * those bytes: `Response.text()` performs a UTF-8 decode first, which strips a
 * leading BOM and rewrites malformed sequences. Two byte strings that decode to
 * the same text therefore produce the same digest, and a mutated transport body
 * passes a check whose whole purpose is to reject it.
 *
 * These tests serve BYTES that differ from the digest'd bytes while decoding to
 * identical text. A loader that hashes decoded text ACCEPTS them (the defect);
 * a loader that hashes received bytes REJECTS them.
 *
 * The fixtures deliberately use real `Response` objects. A hand-rolled double
 * exposing only `text()` cannot express the distinction under test — that is
 * precisely how this class of defect stayed invisible to the existing suite.
 */

const BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
const utf8 = (text: string) => new TextEncoder().encode(text);
const sha256OfBytes = (bytes: Uint8Array) =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex');

function withBom(text: string): Uint8Array {
  const body = utf8(text);
  const out = new Uint8Array(BOM.length + body.length);
  out.set(BOM, 0);
  out.set(body, BOM.length);
  return out;
}

/**
 * A byte mutation that is NOT a BOM, so a fix cannot pass by special-casing
 * one prefix: the three bytes of an existing U+FFFD are replaced by a single
 * malformed 0xFF, which a UTF-8 decoder maps straight back to U+FFFD. Decoded
 * text is identical; the byte string is one byte shorter.
 */
function collapseReplacementChar(text: string): Uint8Array | null {
  const body = utf8(text);
  const at = Buffer.from(body).indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
  if (at < 0) return null;
  const out = new Uint8Array(body.length - 2);
  out.set(body.subarray(0, at), 0);
  out[at] = 0xff;
  out.set(body.subarray(at + 3), at + 1);
  return out;
}

function bytesResponse(bytes: Uint8Array): Response {
  return new Response(Buffer.from(bytes), { status: 200 });
}

// --------------------------------------------------------------------------
// stars — the canonical base dataset (failure semantics: typed throw)
// --------------------------------------------------------------------------

/**
 * Assert that a loader rejects a NON-BOM byte mutation which decodes to
 * identical text. Without this, every loader could regress to hashing decoded
 * text plus a BOM special case and keep the suite green (evidence finding from
 * the round-3 review, which observed that only discovery carried this trap).
 */
async function expectRejectsDecodeInvariantMutation(
  canonicalText: string,
  load: (body: Uint8Array) => Promise<unknown>,
  isRejected: (result: unknown) => boolean,
): Promise<void> {
  const mutated = collapseReplacementChar(canonicalText);
  expect(mutated, 'fixture must contain U+FFFD for this trap to exist').not.toBeNull();
  // Preconditions of the trap: the BYTES differ, the decoded TEXT does not.
  expect(Buffer.from(mutated!).equals(Buffer.from(utf8(canonicalText)))).toBe(false);
  expect(new TextDecoder().decode(mutated!)).toBe(canonicalText);
  expect(isRejected(await load(mutated!))).toBe(true);
}

describe('INTEG-BYTES: stars integrity is verified over received bytes', () => {
  const starsText = JSON.stringify(
    makeStarsFile([makeRepo({ node_id: 'R_1', description: 'replacement � inside' })]),
  );
  const metaJson = JSON.stringify({
    schema_version: '1.0',
    dataset_generated_at: '2026-06-18T00:00:00Z',
    stars_sha256: sha256OfBytes(utf8(starsText)),
    repo_count: 1,
  });
  const starsFetch = (body: Uint8Array): typeof fetch =>
    (async (url: string | URL) =>
      String(url).includes('dataset-meta.json')
        ? new Response(metaJson, { status: 200 })
        : bytesResponse(body)) as typeof fetch;

  it('CONTROL: accepts the unmutated canonical bytes', async () => {
    await expect(loadStars({ fetchImpl: starsFetch(utf8(starsText)) })).resolves.toBeTruthy();
  });

  it('rejects a body whose bytes differ from the digest but decode identically (BOM)', async () => {
    await expect(loadStars({ fetchImpl: starsFetch(withBom(starsText)) })).rejects.toBeInstanceOf(
      DataLoadError,
    );
  });

  /**
   * The canonical loader promises TYPED failures — the UI distinguishes fetch
   * from schema from integrity. A rejecting transport layer (broken stream,
   * unreachable host, unreadable meta JSON) previously escaped untyped and the
   * dashboard fell back to a generic error (round-5 finding).
   */
  it('TYPED: a rejecting body read surfaces as DataLoadError, not a raw Error', async () => {
    const brokenBody = (async (url: string | URL) =>
      String(url).includes('dataset-meta.json')
        ? new Response(metaJson, { status: 200 })
        : ({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.reject(new Error('stream reset')),
          } as unknown as Response)) as typeof fetch;
    await expect(loadStars({ fetchImpl: brokenBody })).rejects.toBeInstanceOf(DataLoadError);
  });

  it('TYPED: an unreadable meta STREAM is a fetch failure, not a schema failure', async () => {
    // The double must reject on the method actually called. An earlier version
    // supplied only `json()`, which the loader no longer calls, so it passed by
    // throwing on a missing method — and the kind was wrong besides: a stream
    // reset rendered as "Data failed validation" (review finding).
    const brokenMeta = (async () =>
      ({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.reject(new Error('stream reset')),
      }) as unknown as Response) as typeof fetch;
    await expect(loadStars({ fetchImpl: brokenMeta })).rejects.toMatchObject({
      name: 'DataLoadError',
      kind: 'fetch',
    });
  });

  it('TYPED: malformed meta JSON is a schema failure', async () => {
    const badJson = (async (url: string | URL) =>
      String(url).includes('dataset-meta.json')
        ? new Response('{not json', { status: 200 })
        : new Response('{}', { status: 200 })) as typeof fetch;
    await expect(loadStars({ fetchImpl: badJson })).rejects.toMatchObject({
      name: 'DataLoadError',
      kind: 'schema',
    });
  });

  /**
   * BUILD/RUNTIME AGREEMENT ON A BOM (round-6 finding). The default
   * `TextDecoder` SWALLOWS a leading BOM, so a BOM-prefixed artifact whose
   * digest covers the BOM used to parse fine here — while the build's
   * `Buffer.toString('utf8')` keeps U+FEFF and `JSON.parse` rejects it. Runtime
   * accepted what the build refused. Both must now refuse it.
   */
  it('AGREE-BOM: a BOM-prefixed artifact whose digest covers the BOM is rejected', async () => {
    const bomBytes = withBom(starsText);
    const bomMeta = JSON.stringify({
      schema_version: '1.0',
      dataset_generated_at: '2026-06-18T00:00:00Z',
      stars_sha256: sha256OfBytes(bomBytes),
      repo_count: 1,
    });
    const fetchImpl = (async (url: string | URL) =>
      String(url).includes('dataset-meta.json')
        ? new Response(bomMeta, { status: 200 })
        : bytesResponse(bomBytes)) as typeof fetch;
    // The digest MATCHES these bytes, so this is not an integrity rejection —
    // it must fail because the BOM is not silently eaten.
    expect(sha256OfBytes(bomBytes)).toBe(JSON.parse(bomMeta).stars_sha256);
    // Assert the KIND, not just that it threw. A digest-over-decoded-text
    // implementation also rejects this fixture — but as an INTEGRITY mismatch,
    // the right answer for the wrong reason (review finding). Only a
    // byte-digest + BOM-preserving decode reaches the parse stage, so `schema`
    // is what proves the decoder is the thing being pinned.
    await expect(loadStars({ fetchImpl })).rejects.toMatchObject({
      name: 'DataLoadError',
      kind: 'schema',
    });
  });

  it('TYPED: a SYNCHRONOUS transport throw is typed too', async () => {
    // `doFetch(...).catch(...)` does not cover this: the call runs before the
    // handler is attached, so the error escapes untyped (round-6 finding).
    const syncThrow = (() => {
      throw new Error('sync boom');
    }) as unknown as typeof fetch;
    await expect(loadStars({ fetchImpl: syncThrow })).rejects.toBeInstanceOf(DataLoadError);
  });

  it('rejects a NON-BOM byte mutation that decodes to identical text', async () => {
    await expectRejectsDecodeInvariantMutation(
      starsText,
      async (body) => {
        try {
          await loadStars({ fetchImpl: starsFetch(body) });
          return 'loaded';
        } catch (error) {
          return error;
        }
      },
      (result) => result instanceof DataLoadError,
    );
  });
});

// --------------------------------------------------------------------------
// annotations — optional layer (failure semantics: fail-soft null)
// --------------------------------------------------------------------------

describe('INTEG-BYTES: annotations integrity is verified over received bytes', () => {
  const annText = JSON.stringify({
    schema_version: '1.0',
    taxonomy_version: '1',
    annotations: [
      {
        node_id: 'R_1',
        category: 'developer-tools',
        tags: ['automation', 'cli'],
        // U+FFFD in free text is what makes the non-BOM trap below possible.
        summary:
          'A concise, factual description � of what this repository does, who it is for, and why it is useful.',
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
  });
  const metaDoc = {
    schema_version: '1.0',
    annotations_sha256: sha256OfBytes(utf8(annText)),
    annotation_count: 1,
    taxonomy_version: '1',
    dataset_sha256: '0'.repeat(64),
    generated_at: '2026-06-20T00:00:00Z',
  };
  const annFetch = (body: Uint8Array): typeof fetch =>
    (async (url: string | URL) =>
      String(url).includes('ai-annotations-meta.json')
        ? new Response(JSON.stringify(metaDoc), { status: 200 })
        : bytesResponse(body)) as typeof fetch;

  it('CONTROL: accepts the unmutated canonical bytes', async () => {
    await expect(loadAnnotations({ fetchImpl: annFetch(utf8(annText)) })).resolves.not.toBeNull();
  });

  it('rejects a BOM-prefixed body carrying the unmodified digest', async () => {
    await expect(loadAnnotations({ fetchImpl: annFetch(withBom(annText)) })).resolves.toBeNull();
  });

  it('rejects a NON-BOM byte mutation that decodes to identical text', async () => {
    await expectRejectsDecodeInvariantMutation(
      annText,
      (body) => loadAnnotations({ fetchImpl: annFetch(body) }),
      (result) => result === null,
    );
  });
});

// --------------------------------------------------------------------------
// discovery — optional layer (failure semantics: fail-soft null)
// --------------------------------------------------------------------------

const discoverySource = {
  kind: 'manual',
  source_id: 'owner/repo',
  source_url: 'https://github.com/owner/repo',
  observed_at: '2026-01-01T00:00:00.000Z',
};

function discoveryFile(description: string) {
  return {
    schema_version: 1,
    candidates: [
      {
        node_id: 'R_1',
        owner: 'owner',
        name: 'repo',
        full_name: 'owner/repo',
        html_url: 'https://github.com/owner/repo',
        description,
        homepage_url: null,
        primary_language: 'TypeScript',
        stargazer_count: 100,
        archived: false,
        disabled: false,
        fork: false,
        pushed_at: '2026-01-01T00:00:00.000Z',
        discovered_at: '2026-01-15T00:00:00.000Z',
        first_seen_source: discoverySource,
        sources: [discoverySource],
        status: 'candidate',
      },
    ],
  };
}

function discoveryFetch(candidateBytes: Uint8Array, digest: string): typeof fetch {
  return (async (url: string | URL) =>
    String(url).includes('discovery-candidates-meta.json')
      ? new Response(
          JSON.stringify({
            schema_version: 1,
            generated_at: '2026-01-15T00:00:00.000Z',
            dataset_sha: digest,
            candidate_count: 1,
            source_count: 1,
            generator_version: '0.1.0',
          }),
          { status: 200 },
        )
      : bytesResponse(candidateBytes)) as typeof fetch;
}

describe('INTEG-BYTES: discovery integrity is verified over received bytes', () => {
  // CONTROL. Without this, a malformed fixture would make every rejection test
  // below pass vacuously (the loader returning null for a schema reason, not an
  // integrity one). This must stay GREEN before and after the fix.
  it('CONTROL: accepts the unmutated canonical bytes', async () => {
    const text = JSON.stringify(discoveryFile('A test repo'));
    const result = await loadDiscovery({
      fetchImpl: discoveryFetch(utf8(text), sha256OfBytes(utf8(text))),
    });
    expect(result).not.toBeNull();
  });

  it('rejects a BOM-prefixed body carrying the unmodified digest', async () => {
    const text = JSON.stringify(discoveryFile('A test repo'));
    const result = await loadDiscovery({
      fetchImpl: discoveryFetch(withBom(text), sha256OfBytes(utf8(text))),
    });
    expect(result).toBeNull();
  });

  it('rejects a NON-BOM byte mutation that decodes to identical text', async () => {
    const text = JSON.stringify(discoveryFile('A test repo � end'));
    const mutated = collapseReplacementChar(text);
    expect(mutated).not.toBeNull();
    // Precondition of the trap: the mutated BYTES differ, the decoded TEXT does not.
    expect(Buffer.from(mutated!).equals(Buffer.from(utf8(text)))).toBe(false);
    expect(new TextDecoder().decode(mutated!)).toBe(text);

    const result = await loadDiscovery({
      fetchImpl: discoveryFetch(mutated!, sha256OfBytes(utf8(text))),
    });
    expect(result).toBeNull();
  });
});

// --------------------------------------------------------------------------
// skills classification — the M2.3 loader (failure semantics: fail-soft null)
// --------------------------------------------------------------------------

function skillsInput(): SkillsClassificationInput {
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
    ],
    entries: [
      {
        source_name_with_owner: 'alpha/one',
        node_id: 'R_kgDOload0001',
        resolution: 'resolved',
        primary_category_id: 'verification-qa',
        secondary_category_ids: [],
        // U+FFFD in free text is what makes the non-BOM trap possible.
        summary: 'Loader fixture � entry.',
      },
    ],
  };
}

describe('INTEG-BYTES: skills-classification integrity is verified over received bytes', () => {
  it('rejects a BOM-prefixed artifact carrying the unmodified digest', async () => {
    const artifactText = serializeSkillsClassification(skillsInput());
    const meta: SkillsClassificationMeta = {
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: sha256OfBytes(utf8(artifactText)),
      source_sha256: 'b'.repeat(64),
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256: 'c'.repeat(64),
      generated_at: '2026-08-14T00:00:00Z',
      category_count: 1,
      source_entry_count: 1,
      resolved_entry_count: 1,
      present_repo_count: 1,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 699,
    };
    const metaText = serializeSkillsClassificationMeta(meta);

    const skillsFetch = (body: Uint8Array): typeof fetch =>
      (async (url: string | URL) =>
        String(url).includes('skills-classification-meta.json')
          ? new Response(metaText, { status: 200 })
          : bytesResponse(body)) as typeof fetch;

    // CONTROL and trap in one test so they cannot drift apart: the canonical
    // bytes must load, the BOM-prefixed bytes must not.
    await expect(
      loadSkillsClassification({ fetchImpl: skillsFetch(utf8(artifactText)) }),
    ).resolves.not.toBeNull();

    await expect(
      loadSkillsClassification({ fetchImpl: skillsFetch(withBom(artifactText)) }),
    ).resolves.toBeNull();

    await expectRejectsDecodeInvariantMutation(
      artifactText,
      (body) => loadSkillsClassification({ fetchImpl: skillsFetch(body) }),
      (result) => result === null,
    );
  });
});

/**
 * META BOM PARITY (review finding). The artifact half had a BOM pin; the META
 * half had none, so replacing `readMetaJson` with the BOM-stripping
 * `res.json()` predecessor left every loader test green. Build-side decoding
 * keeps U+FEFF and `JSON.parse` refuses it, so the runtime must refuse it too —
 * otherwise the two ends accept different artifacts.
 *
 * Each case serves a BOM-prefixed META whose CONTENT is otherwise valid, so
 * nothing but the decode can reject it.
 */
describe('INTEG-META-BOM: a BOM-prefixed meta is refused by every loader', () => {
  const bomOf = (text: string) => bytesResponse(withBom(text));

  it('stars', async () => {
    const starsText = JSON.stringify(makeStarsFile([makeRepo({ node_id: 'R_1' })]));
    const metaText = JSON.stringify({
      schema_version: '1.0',
      dataset_generated_at: '2026-06-18T00:00:00Z',
      stars_sha256: sha256OfBytes(utf8(starsText)),
      repo_count: 1,
    });
    const fetchImpl = (async (url: string | URL) =>
      String(url).includes('dataset-meta.json')
        ? bomOf(metaText)
        : bytesResponse(utf8(starsText))) as typeof fetch;
    await expect(loadStars({ fetchImpl })).rejects.toBeInstanceOf(DataLoadError);
  });

  it('annotations', async () => {
    const annText = JSON.stringify({
      schema_version: '1.0',
      taxonomy_version: '1',
      annotations: [],
    });
    const metaText = JSON.stringify({
      schema_version: '1.0',
      annotations_sha256: sha256OfBytes(utf8(annText)),
      annotation_count: 0,
      taxonomy_version: '1',
      dataset_sha256: '0'.repeat(64),
      generated_at: '2026-06-20T00:00:00Z',
    });
    const fetchImpl = (async (url: string | URL) =>
      String(url).includes('ai-annotations-meta.json')
        ? bomOf(metaText)
        : bytesResponse(utf8(annText))) as typeof fetch;
    await expect(loadAnnotations({ fetchImpl })).resolves.toBeNull();
  });

  it('discovery', async () => {
    const text = JSON.stringify(discoveryFile('A test repo'));
    const metaText = JSON.stringify({
      schema_version: 1,
      generated_at: '2026-01-15T00:00:00.000Z',
      dataset_sha: sha256OfBytes(utf8(text)),
      candidate_count: 1,
      source_count: 1,
      generator_version: '0.1.0',
    });
    const fetchImpl = (async (url: string | URL) =>
      String(url).includes('discovery-candidates-meta.json')
        ? bomOf(metaText)
        : bytesResponse(utf8(text))) as typeof fetch;
    await expect(loadDiscovery({ fetchImpl })).resolves.toBeNull();
  });

  it('skills classification', async () => {
    const artifactText = serializeSkillsClassification(skillsInput());
    const metaText = serializeSkillsClassificationMeta({
      schema_version: '1.0',
      taxonomy_version: 'skills-1',
      classification_sha256: sha256OfBytes(utf8(artifactText)),
      source_sha256: 'b'.repeat(64),
      aliases_sha256: null,
      prior_classification_sha256: null,
      generated_against_stars_sha256: 'c'.repeat(64),
      generated_at: '2026-08-14T00:00:00Z',
      category_count: 1,
      source_entry_count: 1,
      resolved_entry_count: 1,
      present_repo_count: 1,
      absent_repo_count: 0,
      unresolved_entry_count: 0,
      canonical_repo_count: 700,
      unclassified_repo_count: 699,
    });
    const fetchImpl = (async (url: string | URL) =>
      String(url).includes('skills-classification-meta.json')
        ? bomOf(metaText)
        : bytesResponse(utf8(artifactText))) as typeof fetch;
    await expect(loadSkillsClassification({ fetchImpl })).resolves.toBeNull();
  });
});
