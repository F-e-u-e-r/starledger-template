import { lstatSync, readFileSync } from 'node:fs';

/**
 * Gate-4 file reading for inputs that may LEGITIMATELY be absent (aliases,
 * prior): true absence (ENOENT with no path entry at all) → null; everything
 * else — unreadable target, dangling symlink, a stat layer that itself fails —
 * is FATAL. An operational failure must never silently become "no input".
 *
 * The io seam exists because "readFileSync says ENOENT, then lstatSync fails
 * with non-ENOENT" cannot be constructed deterministically on a real
 * filesystem; the regression pin injects it (R4 assurance finding).
 */
export interface ReadOptionalIo {
  readFileSync(path: string, encoding: 'utf8'): string;
  lstatSync(path: string): unknown;
}

const REAL_IO: ReadOptionalIo = {
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  lstatSync: (path) => lstatSync(path),
};

export function readOptional(
  path: string,
  label: string,
  io: ReadOptionalIo = REAL_IO,
): string | null {
  try {
    return io.readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // A dangling symlink also reads as ENOENT, but the path EXISTS — that is
      // "present but unreadable", which must be fatal, not a silent fallback.
      try {
        io.lstatSync(path);
      } catch (lstatError) {
        if ((lstatError as NodeJS.ErrnoException).code === 'ENOENT') {
          return null; // truly absent
        }
        throw new Error(
          `${label}: cannot even stat the path (${(lstatError as Error).message}) — refusing to continue`,
        );
      }
      throw new Error(
        `${label}: path exists (dangling symlink?) but its target is unreadable — refusing to continue`,
      );
    }
    throw new Error(`${label}: unreadable (${(error as Error).message}) — refusing to continue`);
  }
}
