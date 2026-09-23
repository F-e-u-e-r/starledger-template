import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOptional, type ReadOptionalIo } from '../src/read-optional';

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function fakeIo(readCode: string, lstat: 'ok' | string): ReadOptionalIo {
  return {
    readFileSync: () => {
      throw errnoError(readCode);
    },
    lstatSync: () => {
      if (lstat === 'ok') return {};
      throw errnoError(lstat);
    },
  };
}

describe('readOptional — gate-4 absence vs operational failure (real filesystem)', () => {
  it('a truly absent path is null; a directory and a dangling symlink are fatal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starledger-read-optional-'));
    try {
      expect(readOptional(join(dir, 'nope.json'), 'prior')).toBeNull();
      mkdirSync(join(dir, 'as-dir.json'));
      expect(() => readOptional(join(dir, 'as-dir.json'), 'prior')).toThrow('refusing to continue');
      symlinkSync(join(dir, 'gone.json'), join(dir, 'dangling.json'));
      expect(() => readOptional(join(dir, 'dangling.json'), 'prior')).toThrow('dangling symlink');
      writeFileSync(join(dir, 'real.json'), '{}', 'utf8');
      expect(readOptional(join(dir, 'real.json'), 'prior')).toBe('{}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readOptional — injected io (states a real filesystem cannot stage deterministically)', () => {
  it('R4 PIN: read ENOENT + lstat NON-ENOENT is FATAL — a catch-all lstat branch fails this test', () => {
    expect(() => readOptional('/x', 'prior', fakeIo('ENOENT', 'EACCES'))).toThrow(
      'cannot even stat the path',
    );
  });

  it('read ENOENT + lstat ENOENT is true absence (null)', () => {
    expect(readOptional('/x', 'prior', fakeIo('ENOENT', 'ENOENT'))).toBeNull();
  });

  it('read ENOENT + lstat success is the dangling-symlink fatal', () => {
    expect(() => readOptional('/x', 'prior', fakeIo('ENOENT', 'ok'))).toThrow('dangling symlink');
  });

  it('a non-ENOENT read failure is fatal without consulting lstat', () => {
    expect(() => readOptional('/x', 'prior', fakeIo('EACCES', 'ok'))).toThrow('unreadable');
  });
});
