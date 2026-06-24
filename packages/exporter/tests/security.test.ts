import { redactSecrets } from '@starred/github-client';
import { CanonicalRepoSchema } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { makeRepo } from './helpers';

describe('secret redaction (SEC-1, SEC-2)', () => {
  it('SEC-1: a known token in an error message is redacted', () => {
    const token = `github_pat_${'A'.repeat(40)}`;
    const out = redactSecrets(`request to https://x?token=${token} failed`, [token]);
    expect(out).not.toContain(token);
    expect(out).toContain('***');
  });

  it('SEC-1: a ghp_ token is redacted by pattern even without the value', () => {
    const ghp = `ghp_${'B'.repeat(36)}`;
    expect(redactSecrets(`oops ${ghp}`)).not.toContain(ghp);
  });

  it('SEC-2: an Authorization header value is redacted', () => {
    const out = redactSecrets(`authorization: token ghp_${'C'.repeat(36)}`);
    expect(out).not.toMatch(/ghp_/);
    expect(out.toLowerCase()).toContain('authorization');
  });

  it('leaves non-secret text untouched', () => {
    expect(redactSecrets('a normal message with a 64-hex sha ' + 'a'.repeat(64))).toContain(
      'a'.repeat(64),
    );
  });
});

describe('output carries no internal fields', () => {
  it('CanonicalRepo schema rejects an is_private field (strict)', () => {
    const withPrivate = { ...makeRepo(), is_private: true };
    expect(CanonicalRepoSchema.safeParse(withPrivate).success).toBe(false);
  });
});
