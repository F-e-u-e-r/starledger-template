import {
  type DiscoveryCandidate,
  DiscoveryCandidatesFileSchema,
  DiscoveryCandidatesMetaSchema,
} from '@starred/discovery/contracts';
import { readBytesVerified, readMetaJson } from './integrity';

export interface LoadedDiscovery {
  candidates: DiscoveryCandidate[];
  generatedAt: string;
  candidateCount: number;
  sourceCount: number;
}

export interface DiscoveryLoadOptions {
  base?: string;
  fetchImpl?: typeof fetch;
}

export async function loadDiscovery(
  opts: DiscoveryLoadOptions = {},
): Promise<LoadedDiscovery | null> {
  const base = opts.base ?? '/';
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const metaRes = await doFetch(`${base}discovery-candidates-meta.json`, { cache: 'no-cache' });
    if (!metaRes.ok) return null;
    const metaParsed = DiscoveryCandidatesMetaSchema.safeParse(await readMetaJson(metaRes));
    if (!metaParsed.success) return null;
    const meta = metaParsed.data;

    const candidatesRes = await doFetch(`${base}discovery-candidates.json?sha=${meta.dataset_sha}`);
    if (!candidatesRes.ok) return null;
    // Integrity over the RECEIVED BYTES, decoding only after the digest matches
    // (review finding F6). Mandatory — the former `verifyBytes` opt-out is gone,
    // so no caller can disable it. Failure semantics are unchanged: fail-soft.
    const candidatesText = await readBytesVerified(candidatesRes, meta.dataset_sha);
    if (candidatesText === null) return null;

    let json: unknown;
    try {
      json = JSON.parse(candidatesText);
    } catch {
      return null;
    }
    const candidatesParsed = DiscoveryCandidatesFileSchema.safeParse(json);
    if (!candidatesParsed.success) return null;

    if (candidatesParsed.data.candidates.length !== meta.candidate_count) return null;

    return {
      candidates: candidatesParsed.data.candidates,
      generatedAt: meta.generated_at,
      candidateCount: meta.candidate_count,
      sourceCount: meta.source_count,
    };
  } catch {
    return null;
  }
}
