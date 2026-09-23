import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serializeSkillsClassification,
  serializeSkillsClassificationMeta,
} from '@starred/skills-schema/contracts';
import { describe, expect, it } from 'vitest';
import { makeRepo, makeStarsFile } from '../test-utils';
import { loadAnnotations } from './load-annotations';
import { loadDiscovery } from './load-discovery';
import { loadSkillsClassification } from './load-skills-classification';
import { loadStars } from './load-stars';

/**
 * INTEGRITY IS MANDATORY — A SURFACE CONTRACT, EXPRESSED AS AN ALLOWLIST.
 *
 * The byte-level tests prove the digest is computed over received bytes. They
 * cannot prove the OTHER half: that no caller may switch the check off. Every
 * one of them uses default options, so a reintroduced opt-out passes them all —
 * demonstrated in review by adding one and watching the whole loader suite stay
 * green.
 *
 * A blacklist of suspicious names does not fix that: review defeated a
 * three-name blacklist twice, with `verifyIntegrity` and with `allowUnverified`.
 * Any name works, so the contract has to be stated the other way round — these
 * are the ONLY options a loader may accept. A new option is then a deliberate
 * edit to this list, which is exactly where someone should have to argue for it.
 */

const DATA_DIR = dirname(fileURLToPath(import.meta.url));

const LOADER_OPTIONS = [
  ['load-stars.ts', 'LoadOptions'],
  ['load-annotations.ts', 'AnnotationLoadOptions'],
  ['load-discovery.ts', 'DiscoveryLoadOptions'],
  ['load-skills-classification.ts', 'SkillsClassificationLoadOptions'],
] as const;

/** The complete set of options any loader may expose. Integrity is not optional. */
const ALLOWED_OPTIONS = new Set(['base', 'fetchImpl']);

function optionNames(source: string, interfaceName: string): string[] {
  // Exactly ONE declaration, and no intersection/extends: TypeScript MERGES
  // repeated interface declarations, so a second `interface LoadOptions {
  // skipIntegrity?: boolean }` elsewhere in the file would add a bypass this
  // parser never sees (review finding). Same for `extends`/`&`, which can pull
  // options in from another type.
  const declarations = [...source.matchAll(new RegExp(`interface\\s+${interfaceName}\\b`, 'g'))];
  if (declarations.length !== 1) {
    throw new Error(
      `${interfaceName} is declared ${declarations.length} times — merged declarations can hide an option`,
    );
  }
  const header = new RegExp(`interface\\s+${interfaceName}\\s+extends\\b`).test(source);
  if (header)
    throw new Error(`${interfaceName} extends another type — options must be declared inline`);
  const start = source.indexOf(`interface ${interfaceName} {`);
  if (start < 0) throw new Error(`${interfaceName} not found — rename it here too`);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n}', open);
  if (end < 0) throw new Error(`${interfaceName} body not terminated as expected`);
  const body = source
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // An INDEX SIGNATURE ([key: string]: …) makes the whole surface
  // undeclarable — reject it outright, like extends/merge (round-11 finding).
  if (/^\s*(?:readonly\s+)?\[\s*[A-Za-z_$][\w$]*\s*:\s*/m.test(body)) {
    throw new Error(
      `${interfaceName} declares an index signature — the surface must be enumerable`,
    );
  }
  // A COMPUTED NON-LITERAL key (`[allowUnverified]?:` over a unique symbol)
  // is legal TypeScript and names an option no string comparison can see —
  // reject it outright (round-11 finding, sol: a symbol-keyed option drove a
  // working text()-instead-of-bytes bypass past both static pins).
  if (/^\s*(?:readonly\s+)?\[\s*[A-Za-z_$][\w$.]*\s*\]/m.test(body)) {
    throw new Error(
      `${interfaceName} declares a computed option name — option names must be string literals`,
    );
  }
  // Quoted names (`'allowUnverified'?:`), modifier-prefixed names
  // (`readonly allowUnverified?:`), and computed literal keys
  // (`['allowUnverified']?:`) are LEGAL TypeScript and were invisible to a
  // bare-identifier matcher (round-9/10/11 findings) — an invisible
  // declaration never reached the allowlist comparison. Extract every form,
  // so any such declaration lands in the comparison and fails.
  return [
    ...body.matchAll(
      /^\s*(?:readonly\s+)?(?:\[\s*(['"])(.+?)\1\s*\]|(['"])(.+?)\3|([A-Za-z_$][\w$]*))\s*\??\s*[:(]/gm,
    ),
  ].map((m) => (m[2] ?? m[4] ?? m[5])!);
}

/**
 * Strip comments before matching. Otherwise these contracts assert on PROSE —
 * the loaders' own comments explain that the opt-out was removed, and matching
 * those would make the contract unsatisfiable while proving nothing about the
 * API.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The options TYPE is only half the surface. A bypass can also arrive at the
 * PARAMETER — `loadStars(opts: LoadOptions & { bypassIntegrity?: boolean })` —
 * which leaves the interface untouched and every byte test green (reproduced in
 * review). So the exported entry point must name the bare options type.
 */
function parameterType(source: string, fn: string): string {
  // Capture the WHOLE parameter list, not just the first type: a second
  // positional parameter (`loadStars(opts: LoadOptions = {}, allowUnverified =
  // false)`) is another surface a bypass can ride on, invisible if we stop at
  // the first `=` or `,` (round-13 finding, sol). Assert single arity.
  const m = new RegExp(`export async function ${fn}\\s*\\(([^)]*)\\)`).exec(source);
  if (m?.[1] === undefined) throw new Error(`${fn}: could not read its parameter list`);
  // A trailing comma after a single parameter is legal formatting; strip it
  // before checking arity. The option types here are bare identifiers (no
  // generics), so any REMAINING comma means a genuine second parameter.
  const params = m[1].trim().replace(/,\s*$/, '');
  if (params.includes(','))
    throw new Error(`${fn} declares more than one parameter — a second is an un-vetted surface`);
  const typed = /^\s*opts\s*:\s*([^=]+?)\s*(?:=|$)/.exec(params);
  if (!typed?.[1]) throw new Error(`${fn}: could not read its options parameter type`);
  return typed[1].trim();
}

const LOADER_ENTRIES = [
  ['load-stars.ts', 'loadStars', 'LoadOptions'],
  ['load-annotations.ts', 'loadAnnotations', 'AnnotationLoadOptions'],
  ['load-discovery.ts', 'loadDiscovery', 'DiscoveryLoadOptions'],
  ['load-skills-classification.ts', 'loadSkillsClassification', 'SkillsClassificationLoadOptions'],
] as const;

describe('INTEG-SURFACE: the entry points take the bare options type', () => {
  it.each(LOADER_ENTRIES)('%s › %s(opts: %s) — no intersection', (file, fn, type) => {
    const declared = parameterType(code(readFileSync(join(DATA_DIR, file), 'utf8')), fn);
    expect(declared, `${fn} must take ${type} exactly, with no intersection`).toBe(type);
  });

  it('CONTROL: an intersection parameter is detected', () => {
    const sample = 'export async function loadStars(opts: LoadOptions & Unsafe = {}) {}';
    expect(parameterType(sample, 'loadStars')).not.toBe('LoadOptions');
  });

  it('CONTROL: a SECOND parameter is rejected (round 13, sol)', () => {
    const sample =
      'export async function loadStars(opts: LoadOptions = {}, allowUnverified = false) {}';
    expect(() => parameterType(sample, 'loadStars')).toThrow(/more than one parameter/);
  });
});

describe('INTEG-SURFACE: loader options are an allowlist, so no opt-out can appear', () => {
  it.each(LOADER_OPTIONS)('%s › %s declares only allowed options', (file, name) => {
    const declared = optionNames(readFileSync(join(DATA_DIR, file), 'utf8'), name);
    // Guard the guard: a parser returning [] would make this pass vacuously.
    expect(declared.length, `${name} should declare at least one option`).toBeGreaterThan(0);
    for (const option of declared) {
      expect(ALLOWED_OPTIONS.has(option), `${name}.${option} is not an allowed loader option`).toBe(
        true,
      );
    }
  });

  it('CONTROL: a MERGED second declaration is rejected, not silently ignored', () => {
    const merged = [
      'export interface LoadOptions { base?: string; }',
      'interface LoadOptions { skipIntegrity?: boolean }',
      '',
    ].join('\n');
    expect(() => optionNames(merged, 'LoadOptions')).toThrow(/declared 2 times/);
  });

  it('CONTROL: the extractor sees a newly added option', () => {
    // Without this, a broken extractor would silently approve anything.
    const sample = [
      'export interface LoadOptions {',
      '  /** doc */',
      '  base?: string;',
      '  allowUnverified?: boolean; // a bypass under any name',
      '}',
      '',
    ].join('\n');
    expect(optionNames(sample, 'LoadOptions')).toEqual(['base', 'allowUnverified']);
    expect(ALLOWED_OPTIONS.has('allowUnverified')).toBe(false);
  });

  it('CONTROL: quoted and readonly-modified declarations are extracted too', () => {
    // Round-9/10 findings: both forms are legal TypeScript and were invisible
    // to a bare-identifier matcher — an invisible declaration never reached
    // the allowlist comparison at all.
    const sample = [
      'export interface LoadOptions {',
      '  base?: string;',
      "  'allowUnverified'?: boolean;",
      '  readonly skipIntegrity?: boolean;',
      '}',
      '',
    ].join('\n');
    expect(optionNames(sample, 'LoadOptions')).toEqual([
      'base',
      'allowUnverified',
      'skipIntegrity',
    ]);
  });

  it('CONTROL: computed literal keys are extracted; index signatures are rejected (round 11)', () => {
    const computed = [
      'export interface LoadOptions {',
      '  base?: string;',
      "  ['allowUnverified']?: boolean;",
      '}',
      '',
    ].join('\n');
    expect(optionNames(computed, 'LoadOptions')).toEqual(['base', 'allowUnverified']);

    const indexed = [
      'export interface LoadOptions {',
      '  base?: string;',
      '  [key: string]: unknown;',
      '}',
      '',
    ].join('\n');
    expect(() => optionNames(indexed, 'LoadOptions')).toThrow(/index signature/);
  });

  it('CONTROL: a computed (symbol-keyed) option name is rejected (round 11, sol)', () => {
    const symbolKeyed = [
      'export interface LoadOptions {',
      '  base?: string;',
      '  [allowUnverified]?: boolean;',
      '}',
      '',
    ].join('\n');
    expect(() => optionNames(symbolKeyed, 'LoadOptions')).toThrow(/computed option name/);
  });

  it('CONTROL: a method-form option is extracted and fails the allowlist (round 13, luna@max)', () => {
    const methodForm = [
      'export interface LoadOptions {',
      '  base?: string;',
      '  allowUnverified?(): boolean;',
      '}',
      '',
    ].join('\n');
    // The method-form option is SEEN (extracted), so it lands in the allowlist
    // comparison and fails — it is not silently invisible.
    expect(optionNames(methodForm, 'LoadOptions')).toEqual(['base', 'allowUnverified']);
  });
});

/**
 * BEHAVIORAL half of the no-bypass contract (round-9 luna@max; hardened in
 * round 10 after sol and luna@ultra DEFEATED the first version). The allowlist
 * above pins the DECLARED surface, but a body-level bypass — `(opts as
 * any).skipIntegrity`, or a property merged in from ANOTHER file — never
 * appears in the interface text this file parses. The first behavioral pin
 * proxied a THROW on undeclared `get` during a SUCCESSFUL load only, and fell
 * two ways: a bypass consulted exclusively on the integrity-FAILURE branch was
 * never read on the success path, and probes via `in`/`Object.hasOwn` never
 * hit the `get` trap at all.
 *
 * So: a RECORDING proxy (get + has + ownKeys + getOwnPropertyDescriptor), run
 * through BOTH the fully-successful load AND the integrity-failure load, with
 * the recorded out-of-allowlist probes asserted EMPTY after each. A bypass
 * consulted under any name, via any probe form, on either path, lands in the
 * record — whatever the load's outcome.
 */
describe('INTEG-NO-BYPASS-BEHAVIORAL: no loader probes an undeclared option on any path', () => {
  function recordingOptions<T extends object>(opts: T, probes: string[]): T {
    // EVERY symbol is a probe (round-12 finding, sol: exempting well-known
    // symbols let a body-only `opts[Symbol.iterator]` select a bypass). A
    // clean load touches NO symbol on opts — verified — so the well-known
    // exemption was unnecessary as well as unsafe; record them all.
    const note = (property: PropertyKey) => {
      if (typeof property === 'string' && !ALLOWED_OPTIONS.has(property)) probes.push(property);
      if (typeof property === 'symbol') probes.push(`(symbol ${String(property)})`);
    };
    return new Proxy(opts, {
      get(target, property, receiver) {
        note(property);
        return Reflect.get(target, property, receiver);
      },
      has(target, property) {
        note(property);
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        // Enumeration (`{...opts}`, Object.keys) reads the WHOLE surface — a
        // bypass check built on it must fail here, so it is recorded as such.
        probes.push('(ownKeys)');
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        note(property);
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        // A prototype walk (Object.getPrototypeOf(opts)?.skipIntegrity) is a
        // probe of the options surface too (round-11 finding).
        probes.push('(prototype)');
        return Reflect.getPrototypeOf(target);
      },
    });
  }

  const utf8 = (text: string) => new TextEncoder().encode(text);
  const sha256OfBytes = (bytes: Uint8Array) =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const serve = (metaName: string, metaText: string, body: string): typeof fetch =>
    (async (url: string | URL) =>
      String(url).includes(metaName)
        ? new Response(metaText, { status: 200 })
        : new Response(body, { status: 200 })) as typeof fetch;

  /** Meta advertising a digest the served body does NOT hash to — the
   * integrity-failure branch, where a bypass would be consulted. */
  const corrupt = (body: string) => `${body} CORRUPTED`;

  interface Case {
    name: string;
    run: (fetchImpl: typeof fetch, probes: string[]) => Promise<void>;
    metaName: string;
    metaText: string;
    body: string;
  }

  const starsText = JSON.stringify(makeStarsFile([makeRepo({ node_id: 'R_1' })]));
  const starsMeta = JSON.stringify({
    schema_version: '1.0',
    dataset_generated_at: '2026-06-18T00:00:00Z',
    stars_sha256: sha256OfBytes(utf8(starsText)),
    repo_count: 1,
  });

  const annText = JSON.stringify({ schema_version: '1.0', taxonomy_version: '1', annotations: [] });
  const annMeta = JSON.stringify({
    schema_version: '1.0',
    annotations_sha256: sha256OfBytes(utf8(annText)),
    annotation_count: 0,
    taxonomy_version: '1',
    dataset_sha256: '0'.repeat(64),
    generated_at: '2026-06-20T00:00:00Z',
  });

  const discoverySource = {
    kind: 'manual',
    source_id: 'owner/repo',
    source_url: 'https://github.com/owner/repo',
    observed_at: '2026-01-15T00:00:00.000Z',
  };
  const discoveryText = JSON.stringify({
    schema_version: 1,
    candidates: [
      {
        node_id: 'R_1',
        owner: 'owner',
        name: 'repo',
        full_name: 'owner/repo',
        html_url: 'https://github.com/owner/repo',
        description: 'A test repo',
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
  });
  const discoveryMeta = JSON.stringify({
    schema_version: 1,
    generated_at: '2026-01-15T00:00:00.000Z',
    dataset_sha: sha256OfBytes(utf8(discoveryText)),
    candidate_count: 1,
    source_count: 1,
    generator_version: '0.1.0',
  });

  const skillsText = serializeSkillsClassification({
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
        node_id: 'R_kgDOproxy001',
        resolution: 'resolved',
        primary_category_id: 'verification-qa',
        secondary_category_ids: [],
        summary: 'Proxy fixture entry.',
      },
    ],
  });
  const skillsMeta = serializeSkillsClassificationMeta({
    schema_version: '1.0',
    taxonomy_version: 'skills-1',
    classification_sha256: sha256OfBytes(utf8(skillsText)),
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

  const CASES: Case[] = [
    {
      name: 'stars',
      metaName: 'dataset-meta.json',
      metaText: starsMeta,
      body: starsText,
      run: async (fetchImpl, probes) => {
        await expect(loadStars(recordingOptions({ fetchImpl }, probes))).resolves.toBeTruthy();
      },
    },
    {
      name: 'annotations',
      metaName: 'ai-annotations-meta.json',
      metaText: annMeta,
      body: annText,
      run: async (fetchImpl, probes) => {
        await expect(
          loadAnnotations(recordingOptions({ fetchImpl }, probes)),
        ).resolves.not.toBeNull();
      },
    },
    {
      name: 'discovery',
      metaName: 'discovery-candidates-meta.json',
      metaText: discoveryMeta,
      body: discoveryText,
      run: async (fetchImpl, probes) => {
        await expect(
          loadDiscovery(recordingOptions({ fetchImpl }, probes)),
        ).resolves.not.toBeNull();
      },
    },
    {
      name: 'skills classification',
      metaName: 'skills-classification-meta.json',
      metaText: skillsMeta,
      body: skillsText,
      run: async (fetchImpl, probes) => {
        await expect(
          loadSkillsClassification(recordingOptions({ fetchImpl }, probes)),
        ).resolves.not.toBeNull();
      },
    },
  ];

  it.each(CASES)('$name: a successful load probes no undeclared option', async (c) => {
    const probes: string[] = [];
    await c.run(serve(c.metaName, c.metaText, c.body), probes);
    expect(probes).toEqual([]);
  });

  it.each(CASES)('$name: an integrity-FAILURE load probes no undeclared option', async (c) => {
    // The digest in meta does not match the served body: the loader must take
    // its failure branch — and that branch is exactly where a conditional
    // bypass would be consulted (round-10 defeat of the success-only pin).
    const probes: string[] = [];
    const fetchImpl = serve(c.metaName, c.metaText, corrupt(c.body));
    if (c.name === 'stars') {
      await expect(loadStars(recordingOptions({ fetchImpl }, probes))).rejects.toThrow();
    } else if (c.name === 'annotations') {
      await expect(loadAnnotations(recordingOptions({ fetchImpl }, probes))).resolves.toBeNull();
    } else if (c.name === 'discovery') {
      await expect(loadDiscovery(recordingOptions({ fetchImpl }, probes))).resolves.toBeNull();
    } else {
      await expect(
        loadSkillsClassification(recordingOptions({ fetchImpl }, probes)),
      ).resolves.toBeNull();
    }
    expect(probes).toEqual([]);
  });
});
