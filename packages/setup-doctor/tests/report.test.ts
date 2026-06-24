import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../src/report';
import {
  EXIT_INCOMPLETE,
  EXIT_INVALID,
  EXIT_READY,
  dedupeById,
  exitCodeFor,
  summarize,
} from '../src/report';

function r(id: string, status: CheckResult['status']): CheckResult {
  return { id, title: id, status, detail: '' };
}

describe('exitCodeFor', () => {
  it('is ready when all pass/warn', () => {
    expect(exitCodeFor([r('a', 'pass'), r('b', 'warn')])).toBe(EXIT_READY);
  });

  it('is incomplete when an incomplete is present', () => {
    expect(exitCodeFor([r('a', 'pass'), r('b', 'incomplete')])).toBe(EXIT_INCOMPLETE);
  });

  it('invalid outranks incomplete', () => {
    expect(exitCodeFor([r('a', 'incomplete'), r('b', 'invalid')])).toBe(EXIT_INVALID);
  });
});

describe('summarize / dedupeById', () => {
  it('counts each status', () => {
    expect(summarize([r('a', 'pass'), r('b', 'pass'), r('c', 'invalid')])).toBe(
      'pass 2 · warn 0 · incomplete 0 · invalid 1',
    );
  });

  it('keeps the first result per id', () => {
    const out = dedupeById([r('a', 'pass'), r('a', 'invalid'), r('b', 'pass')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
    expect(out[0]?.status).toBe('pass');
  });
});
