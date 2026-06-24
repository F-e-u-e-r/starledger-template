import { describe, expect, it } from 'vitest';
import { extractGithubCandidates, normalizeGithubUrl } from '../src/github-url';

describe('normalizeGithubUrl — normalization matrix', () => {
  const accepted: [string, string][] = [
    ['https://github.com/acme/widget', 'acme/widget'],
    ['http://github.com/acme/widget', 'acme/widget'],
    ['https://www.github.com/acme/widget', 'acme/widget'],
    ['github.com/acme/widget', 'acme/widget'],
    ['https://github.com/acme/widget/', 'acme/widget'],
    ['https://github.com/acme/widget.git', 'acme/widget'],
    ['https://github.com/acme/widget/tree/main/src', 'acme/widget'],
    ['https://github.com/acme/widget/blob/main/README.md', 'acme/widget'],
    ['https://github.com/acme/widget/issues/12', 'acme/widget'],
    ['https://github.com/acme/widget?tab=readme', 'acme/widget'],
    ['https://github.com/acme/widget#install', 'acme/widget'],
    ['git@github.com:acme/widget.git', 'acme/widget'],
    ['ssh://git@github.com/acme/widget.git', 'acme/widget'],
    ['https://github.com/Acme/Widget', 'acme/widget'], // case-folded
    ['https://github.com/acme/dot.name.js', 'acme/dot.name.js'],
  ];
  it.each(accepted)('accepts %s → %s', (input, expected) => {
    expect(normalizeGithubUrl(input)).toBe(expected);
  });

  const rejected: string[] = [
    'https://github.com/acme', // user/org page, not a repo
    'https://github.com/topics/typescript', // reserved route
    'https://github.com/marketplace/actions/x',
    'https://github.com/settings/profile',
    'https://github.com/sponsors/acme',
    'https://github.com/orgs/acme/people',
    'https://github.com/users/acme',
    'https://github.com/features/actions',
    'https://github.com/collections/foo',
    'https://gitlab.com/acme/widget', // wrong host
    'https://example.com/acme/widget',
    'not a url at all',
  ];
  it.each(rejected)('rejects %s', (input) => {
    expect(normalizeGithubUrl(input)).toBeNull();
  });
});

describe('extractGithubCandidates', () => {
  it('extracts and de-duplicates from free text / markdown', () => {
    const text = `
      Check out [widget](https://github.com/acme/widget) and
      https://github.com/acme/widget/tree/main (same repo), plus
      git@github.com:other/lib.git. Ignore https://github.com/topics/x and
      the profile https://github.com/acme. Trailing punctuation:
      https://github.com/third/proj.
    `;
    const got = extractGithubCandidates(text).map((c) => c.owner_repo);
    expect(got).toContain('acme/widget');
    expect(got).toContain('other/lib');
    expect(got).toContain('third/proj');
    expect(got).not.toContain('topics/x');
    // de-duplicated: acme/widget appears once despite two mentions
    expect(got.filter((g) => g === 'acme/widget')).toHaveLength(1);
  });

  it('returns an empty set for text with no repositories', () => {
    expect(extractGithubCandidates('just some text, no links')).toEqual([]);
    expect(extractGithubCandidates('')).toEqual([]);
  });

  it('emits a canonical https URL per candidate', () => {
    const [c] = extractGithubCandidates('see https://github.com/Acme/Widget.git for more');
    expect(c).toEqual({ owner_repo: 'acme/widget', url: 'https://github.com/acme/widget' });
  });
});
