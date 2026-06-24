import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

/**
 * The mobile/narrow filter drawer as a real modal dialog (A11Y-5). While open it
 * moves focus inside, traps Tab/Shift+Tab, closes on Escape or a backdrop click,
 * locks body scroll and — on close — restores focus to the control that opened it
 * (`returnFocusRef`, falling back to whatever was focused at open). The dialog
 * markup matches the desktop filter contract; only the chrome differs.
 */
export function FilterDrawer({
  open,
  onClose,
  returnFocusRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Effect runs only on the open↔closed transition: `onClose` is stabilized by
  // the caller, so interacting with a control inside the drawer never re-runs it
  // and never steals focus back to the dialog.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      (returnFocusRef?.current ?? previouslyFocused)?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="filter-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="drawer-head">
          <h2>Filters</h2>
          <button type="button" onClick={onClose} aria-label="Close filters">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
