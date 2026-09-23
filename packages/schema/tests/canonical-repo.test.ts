import { describe, expect, it } from 'vitest';
import { HttpsUrlSchema, StableReleaseSchema } from '../src/canonical-repo';

describe('S1: HttpsUrlSchema pins the URL scheme to https', () => {
  it('accepts an https URL', () => {
    expect(HttpsUrlSchema.safeParse('https://github.com/owner/repo').success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)', // scheme is case-insensitive; new URL lowercases it
    'data:text/html,<script>alert(1)</script>',
    'http://github.com/owner/repo', // http is downgraded/insecure — rejected too
    'ftp://example.com/x',
    'not a url',
    '',
  ])('rejects a non-https URL: %s', (value) => {
    expect(HttpsUrlSchema.safeParse(value).success).toBe(false);
  });

  it('gates the URL fields that flow into <a href> (release + repo url)', () => {
    const base = { tag_name: 'v1', published_at: null };
    expect(
      StableReleaseSchema.safeParse({ ...base, url: 'https://github.com/o/r/releases/v1' }).success,
    ).toBe(true);
    expect(StableReleaseSchema.safeParse({ ...base, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });
});
