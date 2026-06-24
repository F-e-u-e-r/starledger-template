import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RawStarEdge } from '@starred/github-client';
import { describe, expect, it } from 'vitest';
import { normalizeEdge } from '../src/normalize';

function loadEdge(name: string): RawStarEdge {
  const path = resolve(import.meta.dirname, 'fixtures/releases', name);
  return JSON.parse(readFileSync(path, 'utf8')) as RawStarEdge;
}

describe('release selection (REL-1..3)', () => {
  it('REL-1: stable R then later prereleases → latest_stable=R, latest_any=prerelease', () => {
    // Fixture encodes: GitHub marks v2.1.0 as latestRelease; newest-created is a
    // prerelease v2.2.0-rc1. We delegate "latest stable" to GitHub (ADR), so the
    // output must remain R regardless of the newer prereleases.
    const repo = normalizeEdge(loadEdge('rel1-stable-with-prereleases.json'));
    expect(repo.latest_stable_release?.tag_name).toBe('v2.1.0');
    expect(repo.latest_any_release?.tag_name).toBe('v2.2.0-rc1');
    expect(repo.latest_any_release?.is_prerelease).toBe(true);
  });

  it('REL-2: only prereleases → no stable release, latest_any is the prerelease', () => {
    const repo = normalizeEdge(loadEdge('rel2-only-prereleases.json'));
    expect(repo.latest_stable_release).toBeNull();
    expect(repo.latest_any_release?.tag_name).toBe('v0.1.0-beta.3');
    expect(repo.latest_any_release?.is_prerelease).toBe(true);
  });

  it('REL-3: no releases → both null', () => {
    const repo = normalizeEdge(loadEdge('rel3-no-releases.json'));
    expect(repo.latest_stable_release).toBeNull();
    expect(repo.latest_any_release).toBeNull();
  });
});
