// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBodyScrollLock } from './use-body-scroll-lock';

function Locker({ active }: { active: boolean }) {
  useBodyScrollLock(active);
  return null;
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('useBodyScrollLock (reference-counted body scroll lock)', () => {
  it('LOCK-1: locks while active and restores the original value when the last releases', () => {
    document.body.style.overflow = '';
    const view = render(createElement(Locker, { active: true }));
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('LOCK-2: a nested lock keeps the body locked until BOTH release (closing the inner first)', () => {
    document.body.style.overflow = '';
    const outer = render(createElement(Locker, { active: true }));
    const inner = render(createElement(Locker, { active: true }));
    expect(document.body.style.overflow).toBe('hidden');
    inner.unmount(); // outer (drawer) still open
    expect(document.body.style.overflow).toBe('hidden');
    outer.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('LOCK-3: two modals closing together restore the body — not leave it locked (the r3 leak)', () => {
    document.body.style.overflow = '';
    const view = render(
      createElement(
        Fragment,
        null,
        createElement(Locker, { active: true }),
        createElement(Locker, { active: true }),
      ),
    );
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount(); // both cleanups run in one commit
    expect(document.body.style.overflow).toBe('');
  });

  it('LOCK-4: an inactive lock is a no-op', () => {
    document.body.style.overflow = '';
    const view = render(createElement(Locker, { active: false }));
    expect(document.body.style.overflow).toBe('');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
