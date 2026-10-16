import { useEffect } from 'react';

// A module-level reference count so multiple simultaneously-open modals — the
// filter drawer and the Context export panel — share ONE body scroll lock: the
// body is locked while ANY of them is open and restored only when the LAST one
// closes. A per-modal save-and-restore is NOT reentrant: a nested modal captures
// the OUTER modal's already-locked value as its "previous" and re-locks the body
// on close, leaving the page permanently unscrollable when both close together
// (pre-commit review r3, Grok). The original overflow is captured once, when the
// first lock engages, and restored once, when the last releases.
let lockCount = 0;
let savedOverflow = '';

/** Lock `document.body` scroll while `active`, reference-counted across callers. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, [active]);
}
