import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StarsFileSchema } from '@starred/schema';
import type { DecisionMap } from './config';
import { normalizeGithubUrl } from './github-url';
import type { ManualEntry } from './config';
import type { CandidateResolver, ResolvedCandidate } from './resolve';
import {
  DISCOVERY_SCHEMA_VERSION,
  DISCOVERY_VERSION,
  type DiscoveryCandidate,
  type DiscoveryCandidatesFile,
  DiscoveryCandidatesFileSchema,
  type DiscoveryCandidatesMeta,
  DiscoveryCandidatesMetaSchema,
  type DiscoverySource,
} from './schemas';

export interface PipelineInput {
  manualEntries: ManualEntry[];
  starsPath: string;
  decisions: DecisionMap;
  resolver: CandidateResolver;
  previousCandidatesPath?: string;
  now?: Date;
}

export interface PipelineError {
  url: string;
  message: string;
}

export interface PipelineResult {
  candidates: DiscoveryCandidatesFile;
  meta: DiscoveryCandidatesMeta;
  errors: PipelineError[];
  changed: boolean;
}

function loadStarredNodeIds(starsPath: string): Set<string> {
  // Cold start (no dataset yet) legitimately has nothing to dedupe against. But
  // a stars.json that is present-but-unreadable/invalid must FAIL CLOSED, not
  // fall open to an empty set: an empty set silently disables the
  // already-starred dedupe, so a candidate you already starred could be
  // re-surfaced (and, once wired into discovery, re-processed) (B2).
  let text: string;
  try {
    text = readFileSync(starsPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw new Error(
      `cannot read stars dataset at ${starsPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `stars dataset at ${starsPath} is present but not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const parsed = StarsFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `stars dataset at ${starsPath} is present but fails schema validation; refusing to dedupe fail-open`,
    );
  }
  return new Set(parsed.data.repos.map((r) => r.node_id));
}

interface NormalizedManualEntry {
  ownerRepo: string;
  url: string;
  note?: string;
}

function normalizeManualEntries(entries: ManualEntry[]): {
  normalized: NormalizedManualEntry[];
  errors: PipelineError[];
} {
  const normalized: NormalizedManualEntry[] = [];
  const errors: PipelineError[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const ownerRepo = normalizeGithubUrl(entry.url);
    if (!ownerRepo) {
      errors.push({ url: entry.url, message: 'cannot normalize to GitHub owner/repo' });
      continue;
    }
    if (seen.has(ownerRepo)) continue;
    seen.add(ownerRepo);
    normalized.push({
      ownerRepo,
      url: `https://github.com/${ownerRepo}`,
      note: entry.note,
    });
  }

  return { normalized, errors };
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface PreviousArtifact {
  candidates: Map<string, DiscoveryCandidate>;
  datasetSha: string;
  generatedAt: string;
}

function loadPreviousArtifact(candidatesPath: string): PreviousArtifact | null {
  try {
    const candidatesText = readFileSync(candidatesPath, 'utf8');
    const parsed = DiscoveryCandidatesFileSchema.safeParse(JSON.parse(candidatesText));
    if (!parsed.success) return null;
    const metaPath = candidatesPath.replace(
      'discovery-candidates.json',
      'discovery-candidates-meta.json',
    );
    const metaText = readFileSync(metaPath, 'utf8');
    const metaParsed = DiscoveryCandidatesMetaSchema.safeParse(JSON.parse(metaText));
    // Change-detection FALLBACK, not an integrity check (and never presented
    // as one): with the previous meta unreadable, hash the previous artifact's
    // DECODED text purely to decide "rewrite or skip". Deliberately left on
    // text semantics (round-9 classification): a decode-alike byte corruption
    // can at worst suppress a rewrite, and the byte-strict stager/loader still
    // refuse the corrupt file downstream — nothing is accepted through this
    // value.
    const datasetSha = metaParsed.success ? metaParsed.data.dataset_sha : sha256Hex(candidatesText);
    const generatedAt = metaParsed.success ? metaParsed.data.generated_at : '';
    const candidates = new Map<string, DiscoveryCandidate>();
    for (const c of parsed.data.candidates) candidates.set(c.node_id, c);
    return { candidates, datasetSha, generatedAt };
  } catch {
    return null;
  }
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const errors: PipelineError[] = [];

  const previous = input.previousCandidatesPath
    ? loadPreviousArtifact(input.previousCandidatesPath)
    : null;

  const { normalized, errors: normErrors } = normalizeManualEntries(input.manualEntries);
  errors.push(...normErrors);

  const starredNodeIds = loadStarredNodeIds(input.starsPath);

  const resolvedByNodeId = new Map<
    string,
    { resolved: ResolvedCandidate; sources: DiscoverySource[] }
  >();

  for (const entry of normalized) {
    const [owner, repo] = entry.ownerRepo.split('/');
    if (!owner || !repo) continue;

    let resolved: ResolvedCandidate | null;
    try {
      resolved = await input.resolver.resolve(owner, repo);
    } catch (err) {
      errors.push({
        url: entry.url,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!resolved) continue;

    if (starredNodeIds.has(resolved.node_id)) continue;

    const prev = previous?.candidates.get(resolved.node_id);
    const prevSource = prev?.sources.find(
      (s) => s.kind === 'manual' && s.source_id === entry.ownerRepo,
    );
    const source: DiscoverySource = {
      kind: 'manual',
      source_id: entry.ownerRepo,
      source_url: entry.url,
      observed_at: prevSource?.observed_at ?? nowIso,
      ...(entry.note ? { raw_ref: entry.note } : {}),
    };

    const existing = resolvedByNodeId.get(resolved.node_id);
    if (existing) {
      existing.sources.push(source);
    } else {
      resolvedByNodeId.set(resolved.node_id, { resolved, sources: [source] });
    }
  }

  const candidates: DiscoveryCandidate[] = [];
  for (const { resolved, sources } of resolvedByNodeId.values()) {
    const fullName = resolved.full_name.toLowerCase();
    let status: DiscoveryCandidate['status'] = 'candidate';
    let decisionReason: string | undefined;

    if (input.decisions.dismissed.has(fullName)) {
      status = 'dismissed';
      decisionReason = input.decisions.dismissed.get(fullName);
    } else if (input.decisions.promoted.has(fullName)) {
      status = 'promoted';
      decisionReason = input.decisions.promoted.get(fullName);
    }

    const prev = previous?.candidates.get(resolved.node_id);

    candidates.push({
      node_id: resolved.node_id,
      owner: resolved.owner,
      name: resolved.name,
      full_name: resolved.full_name,
      html_url: resolved.html_url,
      description: resolved.description,
      homepage_url: resolved.homepage_url,
      primary_language: resolved.primary_language,
      stargazer_count: resolved.stargazer_count,
      archived: resolved.archived,
      disabled: resolved.disabled,
      fork: resolved.fork,
      pushed_at: resolved.pushed_at,
      discovered_at: prev?.discovered_at ?? nowIso,
      first_seen_source: prev?.first_seen_source ?? sources[0]!,
      sources,
      status,
      ...(decisionReason !== undefined ? { decision_reason: decisionReason } : {}),
    });
  }

  candidates.sort((a, b) => a.node_id.localeCompare(b.node_id));

  const sourceCount = new Set(candidates.flatMap((c) => c.sources.map((s) => s.source_id))).size;

  const candidatesFile: DiscoveryCandidatesFile = {
    schema_version: DISCOVERY_SCHEMA_VERSION,
    candidates,
  };

  const candidatesJson = JSON.stringify(candidatesFile, null, 2) + '\n';
  const datasetSha = sha256Hex(candidatesJson);
  const changed = previous === null || datasetSha !== previous.datasetSha;

  const meta: DiscoveryCandidatesMeta = {
    schema_version: DISCOVERY_SCHEMA_VERSION,
    generated_at: changed ? nowIso : previous!.generatedAt || nowIso,
    dataset_sha: datasetSha,
    candidate_count: candidates.length,
    source_count: sourceCount,
    generator_version: DISCOVERY_VERSION,
  };

  return { candidates: candidatesFile, meta, errors, changed };
}

export function serializeCandidates(file: DiscoveryCandidatesFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

export function serializeMeta(meta: DiscoveryCandidatesMeta): string {
  return JSON.stringify(meta, null, 2) + '\n';
}
