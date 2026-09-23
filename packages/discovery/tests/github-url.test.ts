import { describe, expect, it } from 'vitest';
import { normalizeGithubUrl } from '../src/github-url';

describe('normalizeGithubUrl', () => {
  it('normalizes https URLs', () => {
    expect(normalizeGithubUrl('https://github.com/Owner/Repo')).toBe('owner/repo');
  });

  it('normalizes www URLs', () => {
    expect(normalizeGithubUrl('https://www.github.com/Owner/Repo')).toBe('owner/repo');
  });

  it('normalizes http URLs', () => {
    expect(normalizeGithubUrl('http://github.com/Owner/Repo')).toBe('owner/repo');
  });

  it('strips trailing .git', () => {
    expect(normalizeGithubUrl('https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('strips subpaths (tree, blob, issues, pull)', () => {
    expect(normalizeGithubUrl('https://github.com/owner/repo/tree/main')).toBe('owner/repo');
    expect(normalizeGithubUrl('https://github.com/owner/repo/blob/main/file.ts')).toBe(
      'owner/repo',
    );
    expect(normalizeGithubUrl('https://github.com/owner/repo/issues/42')).toBe('owner/repo');
    expect(normalizeGithubUrl('https://github.com/owner/repo/pull/7')).toBe('owner/repo');
  });

  it('strips query strings and fragments', () => {
    expect(normalizeGithubUrl('https://github.com/owner/repo?tab=readme')).toBe('owner/repo');
    expect(normalizeGithubUrl('https://github.com/owner/repo#installation')).toBe('owner/repo');
  });

  it('strips trailing slashes', () => {
    expect(normalizeGithubUrl('https://github.com/owner/repo/')).toBe('owner/repo');
  });

  it('normalizes SSH URLs', () => {
    expect(normalizeGithubUrl('git@github.com:Owner/Repo.git')).toBe('owner/repo');
    expect(normalizeGithubUrl('ssh://git@github.com/Owner/Repo')).toBe('owner/repo');
  });

  it('normalizes bare github.com paths', () => {
    expect(normalizeGithubUrl('github.com/owner/repo')).toBe('owner/repo');
  });

  it('rejects reserved owners', () => {
    expect(normalizeGithubUrl('https://github.com/topics/typescript')).toBeNull();
    expect(normalizeGithubUrl('https://github.com/marketplace/actions')).toBeNull();
    expect(normalizeGithubUrl('https://github.com/settings/tokens')).toBeNull();
  });

  it('rejects non-GitHub URLs', () => {
    expect(normalizeGithubUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(normalizeGithubUrl('https://example.com')).toBeNull();
  });

  it('rejects user-only paths', () => {
    expect(normalizeGithubUrl('https://github.com/owner')).toBeNull();
  });

  it('handles whitespace', () => {
    expect(normalizeGithubUrl('  https://github.com/owner/repo  ')).toBe('owner/repo');
  });
});
