import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeferredError } from '@starred/github-client';
import type { CanonicalRepo } from '@starred/schema';
import { describe, expect, it } from 'vitest';
import { checkEmptyGuard } from '../src/publish';
import { serializeStars } from '../src/serialize';
import { makeRepo } from './helpers';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'stars-empty-'));
}

function writeStars(dir: string, repos: CanonicalRepo[]): void {
  writeFileSync(join(dir, 'stars.json'), serializeStars(repos));
}

function guard(dir: string, exportedCount: number, allowEmpty = false): void {
  checkEmptyGuard({ outDir: dir, starsFileName: 'stars.json', exportedCount, allowEmpty });
}

describe('empty guard / allow_empty (EMPTY-1..5)', () => {
  it('EMPTY-1: first run + empty + allow_empty=false → allowed', () => {
    expect(() => guard(tmp(), 0)).not.toThrow();
  });

  it('EMPTY-2: previous empty + current empty → allowed (unchanged)', () => {
    const dir = tmp();
    writeStars(dir, []);
    expect(() => guard(dir, 0)).not.toThrow();
  });

  it('EMPTY-3: previous non-empty + current empty + allow_empty=false → deferred', () => {
    const dir = tmp();
    writeStars(dir, [makeRepo({ node_id: 'R_1' })]);
    expect(() => guard(dir, 0)).toThrow(DeferredError);
  });

  it('EMPTY-4: previous non-empty + current empty + allow_empty=true → allowed', () => {
    const dir = tmp();
    writeStars(dir, [makeRepo({ node_id: 'R_1' })]);
    expect(() => guard(dir, 0, true)).not.toThrow();
  });

  it('EMPTY-5: previous stars.json invalid → deferred (untrusted prerequisite)', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'stars.json'), '{"bad":true}');
    expect(() => guard(dir, 0)).toThrow(DeferredError);
  });

  it('non-empty current is always allowed', () => {
    const dir = tmp();
    writeStars(dir, [makeRepo({ node_id: 'R_1' })]);
    expect(() => guard(dir, 5)).not.toThrow();
  });
});
