import { TAXONOMY_VERSION } from '@starred/ai-schema';
import { describe, expect, it } from 'vitest';
import {
  repoMetadataSha256,
  sourceFingerprint,
  type SourceFingerprintInput,
} from '../src/fingerprint';
import { repo } from './helpers';

const base: SourceFingerprintInput = {
  nodeId: 'R_a',
  sourceKind: 'readme',
  readmePath: 'README.md',
  readmeOid: 'oid-1',
  repoMetadataSha256: 'a'.repeat(64),
  taxonomyVersion: TAXONOMY_VERSION,
  promptVersion: 'classify-v1',
  executionProfileVersion: 'agent-v1',
  executorKind: 'claude-routine',
};

describe('source fingerprint', () => {
  it('FP-1: identical inputs produce an identical fingerprint', () => {
    expect(sourceFingerprint(base)).toBe(sourceFingerprint({ ...base }));
    expect(sourceFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('FP-2: a README OID change invalidates the fingerprint', () => {
    expect(sourceFingerprint({ ...base, readmeOid: 'oid-2' })).not.toBe(sourceFingerprint(base));
  });

  it('FP-3: a classification-relevant metadata change invalidates; popularity does not', () => {
    const r = repo('a', { description: 'first', stargazer_count: 100 });
    const changedDescription = repo('a', { description: 'second', stargazer_count: 100 });
    const changedStars = repo('a', { description: 'first', stargazer_count: 999_999 });

    expect(repoMetadataSha256(changedDescription)).not.toBe(repoMetadataSha256(r));
    expect(repoMetadataSha256(changedStars)).toBe(repoMetadataSha256(r));

    const fp = (metadataSha: string): string =>
      sourceFingerprint({ ...base, repoMetadataSha256: metadataSha });
    expect(fp(repoMetadataSha256(changedDescription))).not.toBe(fp(repoMetadataSha256(r)));
    expect(fp(repoMetadataSha256(changedStars))).toBe(fp(repoMetadataSha256(r)));
  });

  it('FP-4: a taxonomy/prompt/profile/executor change invalidates the fingerprint', () => {
    expect(sourceFingerprint({ ...base, taxonomyVersion: '2' })).not.toBe(sourceFingerprint(base));
    expect(sourceFingerprint({ ...base, promptVersion: 'classify-v2' })).not.toBe(
      sourceFingerprint(base),
    );
    expect(sourceFingerprint({ ...base, executionProfileVersion: 'agent-v2' })).not.toBe(
      sourceFingerprint(base),
    );
    expect(sourceFingerprint({ ...base, executorKind: 'codex-automation' })).not.toBe(
      sourceFingerprint(base),
    );
  });

  it('a metadata-only source differs from a README source', () => {
    expect(
      sourceFingerprint({ ...base, sourceKind: 'metadata', readmePath: null, readmeOid: null }),
    ).not.toBe(sourceFingerprint(base));
  });
});
