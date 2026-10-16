import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { DerivedRepo } from '../../data/derive-fields';
import { useBodyScrollLock } from '../../components/use-body-scroll-lock';
import type { ViewState } from '../repositories/select';
import { buildContextExport, toJson, toMarkdown } from './export';

type ExportFormat = 'markdown' | 'json';
type CopyState = 'idle' | 'copied' | 'error';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

/**
 * Module-level clipboard write queue, so serialization spans panel unmount /
 * remount (r4). A pending `writeText` started by one panel instance outlives it;
 * a component-local chain would let that stale write land AFTER a remounted
 * panel's newer write, leaving the clipboard holding a payload the new panel's
 * status does not claim. Routing EVERY write through one module-level chain orders
 * them globally, so the clipboard always ends with the most-recently-requested
 * payload. The returned promise resolves/rejects for THIS write; the chain tail is
 * kept fulfilled (`.catch`) so a failed write never stalls later ones.
 */
let clipboardWriteChain: Promise<void> = Promise.resolve();
function enqueueClipboardWrite(text: string): Promise<void> {
  const run = clipboardWriteChain.then(async () => {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
  });
  clipboardWriteChain = run.catch(() => {});
  return run;
}

/**
 * M4.4 Context Builder (P7 §19) — the portable-export surface as a modal panel
 * opened FROM the Starred view, so filtering and exporting live in one place (no
 * tab round-trip). It consumes the EXACT `results` array and effective `view`
 * that RepositoryView already produced BEFORE pagination, so the exported set is
 * the Browse filtered+ordered set by construction (one filter-semantics source,
 * no recomputation, no second clock). The panel only formats and copies.
 *
 * Human-directed handoff: no network, no model, no MCP, no key. The export is a
 * pure, deterministic function of (results, view, aiReady, provenance) with no
 * `copiedAt`. Copy feedback is bound to the previewed payload: "Copied" is shown
 * only after the clipboard write for the CURRENT text resolves.
 *
 * Accessibility mirrors the filter drawer's proven modal pattern: focus moves in
 * on open, Tab/Shift+Tab are trapped, Escape and a backdrop click close, body
 * scroll is locked, and focus returns to the opener on close.
 */
export function ContextExportPanel({
  results,
  view,
  aiReady,
  starsSha256,
  datasetGeneratedAt,
  open,
  onClose,
  returnFocusRef,
}: {
  /** The full filtered + ordered set from RepositoryView, BEFORE pagination. */
  results: readonly DerivedRepo[];
  /** The effective ViewState that produced `results` (drives the selection summary). */
  view: ViewState;
  aiReady: boolean;
  starsSha256?: string;
  datasetGeneratedAt?: string;
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Reference-counted lock shared with the filter drawer so two open modals do
  // not leak the body scroll lock when they close together (r3).
  useBodyScrollLock(open);

  // Open↔closed transition only (onClose is caller-stabilized): move focus in,
  // trap Tab, close on Escape, restore focus on close.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.focus();

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
      (returnFocusRef?.current ?? previouslyFocused)?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  const model = useMemo(
    () =>
      buildContextExport({
        repos: results,
        view,
        aiReady,
        source: {
          starsSha256: starsSha256 ?? null,
          datasetGeneratedAt: datasetGeneratedAt ?? null,
        },
      }),
    [results, view, aiReady, starsSha256, datasetGeneratedAt],
  );

  const [format, setFormat] = useState<ExportFormat>('markdown');
  const text = useMemo(
    () => (format === 'json' ? toJson(model) : toMarkdown(model)),
    [format, model],
  );

  // Copy feedback is bound to the payload that produced it: `copyResult` records
  // the written payload with its outcome; the displayed `copyState` is derived
  // during render and shown ONLY while that payload is still previewed, so a
  // payload change (format toggle) hides a prior result synchronously. The
  // monotonic `copyAttempt` lets only the latest attempt IN THIS INSTANCE publish.
  //
  // The clipboard WRITES themselves are ordered by the module-level
  // `enqueueClipboardWrite` queue (above), which spans panel unmount/remount — so
  // the clipboard's final content always matches the most-recently-requested
  // payload, and the shown status cannot claim a payload the clipboard does not
  // hold (r3/r4). Ordering the side effect, not only the React state update, is
  // what closes the class.
  const copyAttempt = useRef(0);
  const [copyResult, setCopyResult] = useState<{
    payload: string;
    status: Exclude<CopyState, 'idle'>;
  } | null>(null);
  const onCopy = useCallback(() => {
    const attempt = (copyAttempt.current += 1);
    const payload = text;
    enqueueClipboardWrite(payload).then(
      () => {
        if (copyAttempt.current === attempt) setCopyResult({ payload, status: 'copied' });
      },
      () => {
        if (copyAttempt.current === attempt) setCopyResult({ payload, status: 'error' });
      },
    );
  }, [text]);
  const copyState: CopyState =
    copyResult && copyResult.payload === text ? copyResult.status : 'idle';

  const titleId = useId();
  const previewId = useId();
  const count = model.repositories.length;

  if (!open) return null;

  return (
    <div
      className="context-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="context-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="drawer-head">
          <h2 id={titleId}>Copy context</h2>
          <button type="button" onClick={onClose} aria-label="Close copy context">
            ×
          </button>
        </div>

        <p className="context-intro">
          The whole current filtered set as portable context to paste into an AI agent — nothing is
          sent anywhere.
        </p>

        <div className="context-controls">
          <fieldset className="context-format">
            <legend>Format</legend>
            <label>
              <input
                type="radio"
                name="context-format"
                checked={format === 'markdown'}
                onChange={() => setFormat('markdown')}
              />
              Markdown
            </label>
            <label>
              <input
                type="radio"
                name="context-format"
                checked={format === 'json'}
                onChange={() => setFormat('json')}
              />
              JSON
            </label>
          </fieldset>

          <p className="context-size" role="status">
            {count} {count === 1 ? 'repository' : 'repositories'} · {text.length}{' '}
            {text.length === 1 ? 'character' : 'characters'}
          </p>

          <button type="button" className="context-copy" onClick={onCopy}>
            Copy as {format === 'json' ? 'JSON' : 'Markdown'}
          </button>
          <span className="context-copy-status" role="status" aria-live="polite">
            {copyState === 'copied'
              ? 'Copied to clipboard.'
              : copyState === 'error'
                ? 'Copy failed — select the text below and copy it manually.'
                : ''}
          </span>
        </div>

        <label className="visually-hidden" htmlFor={previewId}>
          Export preview ({format === 'json' ? 'JSON' : 'Markdown'})
        </label>
        <textarea
          id={previewId}
          className="context-preview"
          readOnly
          value={text}
          spellCheck={false}
          wrap="off"
        />
      </div>
    </div>
  );
}
