// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FilterDrawer } from './FilterDrawer';

afterEach(cleanup);

/** A minimal opener + drawer, mirroring how RepositoryView wires the toggle. */
function Harness() {
  const [open, setOpen] = useState(true);
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={toggleRef} onClick={() => setOpen(true)}>
        Open filters
      </button>
      <FilterDrawer open={open} onClose={() => setOpen(false)} returnFocusRef={toggleRef}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </FilterDrawer>
    </>
  );
}

const dialog = () => screen.getByRole('dialog', { name: 'Filters' });
const opener = () => screen.getByRole('button', { name: 'Open filters' });

describe('FilterDrawer (A11Y-5)', () => {
  it('moves focus into the dialog when opened', () => {
    render(<Harness />);
    expect(document.activeElement).toBe(dialog());
  });

  it('closes on Escape and restores focus to the opener', () => {
    render(<Harness />);
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('closes on a backdrop click but not on a click inside the panel', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(screen.getByRole('dialog')).toBeTruthy(); // panel click is ignored

    const backdrop = dialog().parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab and Shift+Tab within the dialog', () => {
    render(<Harness />);
    const close = screen.getByRole('button', { name: 'Close filters' }); // first focusable
    const last = screen.getByRole('button', { name: 'Last' }); // last focusable

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close); // wraps forward to the first

    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last); // wraps backward to the last
  });

  it('locks body scroll while open and restores it on close', () => {
    render(<Harness />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });
});
