import { describe, expect, it } from 'vitest';
import { RepoReleaseSchema } from '../src/models';

// Zod 3 -> Zod 4 parity oracle for UNCHANGED external-input schemas. Expected values were
// captured by running these exact inputs under zod@3.25.76 (the pre-migration contract):
// accept/reject, the stored output for accepted inputs (no trimming or rewriting), and the
// set of issue paths for rejected inputs. Issue codes and messages are Zod's own naming and
// are deliberately not asserted. Inputs whose outcome Zod 4 changed on purpose (safe-integer
// `.int()`, the early size-bound rejection of GHSA-mrhx-c7xc-m3w5) are disclosed in the PR
// instead of being pinned here.
describe('RepoReleaseSchema parity with zod@3.25.76 (notifier.RepoReleaseSchema.url)', () => {
  it('https-plain: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://github.com/octo/one',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://github.com/octo/one',
    });
  });

  it('https-path-query-fragment: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/p/a%20b?q=1#frag',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/p/a%20b?q=1#frag',
    });
  });

  it('http-scheme: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'http://x.example/',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'http://x.example/',
    });
  });

  it('upper-scheme: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'HTTPS://GITHUB.COM/octo/one',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'HTTPS://GITHUB.COM/octo/one',
    });
  });

  it('javascript-scheme: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'javascript:alert(1)',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'javascript:alert(1)',
    });
  });

  it('data-scheme: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'data:text/html,hi',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'data:text/html,hi',
    });
  });

  it('leading-space: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: ' https://x.example/',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: ' https://x.example/',
    });
  });

  it('trailing-space: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/ ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/ ',
    });
  });

  it('leading-nbsp: rejected at the same paths as Zod 3', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: ' https://x.example/',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('trailing-bom: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/﻿',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/﻿',
    });
  });

  it('leading-ideographic-space: rejected at the same paths as Zod 3', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: '　https://x.example/',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('inner-space: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/a b',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/a b',
    });
  });

  it('ipv6-host: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://[::1]/',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://[::1]/',
    });
  });

  it('no-host: rejected at the same paths as Zod 3', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('empty: rejected at the same paths as Zod 3', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: '',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('relative: rejected at the same paths as Zod 3', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: '/octo/one',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].sort();
    expect(paths).toEqual(['url']);
  });

  it('userinfo: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://user:pw@x.example/',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://user:pw@x.example/',
    });
  });

  it('unicode-host: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://bücher.example/',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://bücher.example/',
    });
  });

  it('percent-bad: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/%zz',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/%zz',
    });
  });

  it('newline: accepted with the Zod 3 output', () => {
    const result = RepoReleaseSchema.safeParse({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/\n',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tag_name: 'v1',
      published_at: null,
      url: 'https://x.example/\n',
    });
  });
});
