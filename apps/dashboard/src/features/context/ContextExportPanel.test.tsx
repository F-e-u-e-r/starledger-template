// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalRepo } from '@starred/schema';
import { App } from '../../app/App';
import type { LoadedAnnotations } from '../../data/load-annotations';
import { DEFAULT_DASHBOARD_STATE, type DashboardState } from '../../state/dashboard-state';
import { makeAnnotation, makeAnnotations, makeDataset, makeRepo } from '../../test-utils';
import { dashboardToView, prepareRepositories, selectFromPrepared } from '../repositories/select';
import { ContextExportPanel } from './ContextExportPanel';

const NOW = new Date('2026-06-19T00:00:00Z');

afterEach(cleanup);

function st(overrides: Partial<DashboardState> = {}): DashboardState {
  return { ...DEFAULT_DASHBOARD_STATE, ...overrides };
}

/** Reproduce RepositoryView's recipe so the panel gets the exact `results`/`view`
 *  it would in the app — the panel never recomputes the pipeline itself. */
function pipeline(
  repos: CanonicalRepo[],
  state: DashboardState,
  opts: { annotations?: LoadedAnnotations | null; annotationReady?: boolean } = {},
) {
  const aiReady = opts.annotationReady === true && opts.annotations != null;
  const prepared = prepareRepositories(
    repos,
    NOW,
    opts.annotations?.byNodeId,
    undefined,
    undefined,
  );
  const view = dashboardToView(state, aiReady, false);
  return { results: selectFromPrepared(prepared, view), view, aiReady };
}

function renderPanel(
  repos: CanonicalRepo[],
  state: DashboardState,
  opts: {
    annotations?: LoadedAnnotations | null;
    annotationReady?: boolean;
    onClose?: () => void;
  } = {},
) {
  const { results, view, aiReady } = pipeline(repos, state, opts);
  return render(
    <ContextExportPanel
      open
      onClose={opts.onClose ?? (() => {})}
      results={results}
      view={view}
      aiReady={aiReady}
      starsSha256={'a'.repeat(64)}
      datasetGeneratedAt="2026-06-18T00:00:00Z"
    />,
  );
}

function exportedJson(): {
  repositories: { nameWithOwner: string }[];
  selection: { count: number };
} {
  fireEvent.click(screen.getByLabelText('JSON'));
  const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
  return JSON.parse(ta.value);
}

describe('M4.4 ContextExportPanel', () => {
  it('CEP-1: renders the modal, format toggle, size line and preview', () => {
    renderPanel([makeRepo({ node_id: 'R_1', name_with_owner: 'acme/one' })], st());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Copy context' })).toBeTruthy();
    expect(screen.getByLabelText('Markdown')).toBeTruthy();
    expect(screen.getByLabelText('JSON')).toBeTruthy();
    expect(screen.getByText(/1 repository · \d+ characters/)).toBeTruthy();
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toContain('# StarLedger repository context');
    expect(ta.value).toContain('- [acme/one](');
  });

  it('CEP-2: open=false renders nothing', () => {
    const { results, view, aiReady } = pipeline([makeRepo({ node_id: 'R_1' })], st());
    render(
      <ContextExportPanel
        open={false}
        onClose={() => {}}
        results={results}
        view={view}
        aiReady={aiReady}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('CEP-ESC-1: Escape closes the panel', () => {
    const onClose = vi.fn();
    renderPanel([makeRepo({ node_id: 'R_1' })], st(), { onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('CEP-AI-1 (#5): exports AI category/tags when ready; omits them (repo still exported) when not', () => {
    const repos = [makeRepo({ node_id: 'R_1', name_with_owner: 'acme/one' })];
    const annotations = makeAnnotations({
      R_1: makeAnnotation({ category: 'ai-ml', tags: ['agents'] }),
    });

    cleanup();
    renderPanel(repos, st(), { annotations, annotationReady: true });
    let json = exportedJson();
    expect(json.repositories[0]).toMatchObject({ category: 'ai-ml', tags: ['agents'] });

    cleanup();
    renderPanel(repos, st(), { annotations, annotationReady: false });
    json = exportedJson();
    expect(json.repositories).toHaveLength(1);
    expect(json.repositories[0]).toMatchObject({ category: null, tags: [] });
  });

  it('CEP-COPY-1 (#12): reports "Copied" only after the clipboard write resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel([makeRepo({ node_id: 'R_1', name_with_owner: 'acme/one' })], st());
    fireEvent.click(screen.getByRole('button', { name: /Copy as Markdown/ }));
    await waitFor(() => expect(screen.getByText('Copied to clipboard.')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('# StarLedger repository context'),
    );
  });

  it('CEP-COPY-2 (#12): a rejected write surfaces failure, never a false success', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel([makeRepo({ node_id: 'R_1' })], st());
    fireEvent.click(screen.getByRole('button', { name: /Copy as Markdown/ }));
    await waitFor(() => expect(screen.getByText(/Copy failed/)).toBeTruthy());
    expect(screen.queryByText('Copied to clipboard.')).toBeNull();
  });

  it('CEP-COPY-3 (#12): an unavailable clipboard API surfaces failure without throwing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderPanel([makeRepo({ node_id: 'R_1' })], st());
    fireEvent.click(screen.getByRole('button', { name: /Copy as Markdown/ }));
    await waitFor(() => expect(screen.getByText(/Copy failed/)).toBeTruthy());
  });

  it('CEP-COPY-4 (#12): overlapping copies are serialized so the clipboard ends with the latest payload, matching the status', async () => {
    // The clipboard side effect — not just the React feedback — must be ordered,
    // or a slow earlier write could land AFTER a newer one and leave the clipboard
    // holding a payload the status does not claim (r3). The first (Markdown) write
    // stays pending; the second (JSON) must not run until the first settles.
    const order: string[] = [];
    let resolveMd: () => void = () => {};
    const kind = (t: string) => (t.includes('"schemaVersion"') ? 'json' : 'md');
    const writeText = vi
      .fn()
      .mockImplementationOnce(
        (t: string) =>
          new Promise<void>((res) => {
            order.push(`start:${kind(t)}`);
            resolveMd = () => {
              order.push('done:md');
              res();
            };
          }),
      )
      .mockImplementationOnce((t: string) => {
        order.push(`write:${kind(t)}`);
        return Promise.resolve();
      });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel([makeRepo({ node_id: 'R_1', name_with_owner: 'acme/one' })], st());

    fireEvent.click(screen.getByRole('button', { name: /Copy as Markdown/ })); // md: pending
    fireEvent.click(screen.getByLabelText('JSON'));
    fireEvent.click(screen.getByRole('button', { name: /Copy as JSON/ })); // queued behind md

    // The JSON write is serialized behind the still-pending Markdown write.
    await waitFor(() => expect(order).toEqual(['start:md']));

    // Completing Markdown lets the queued JSON write run LAST — clipboard ends JSON.
    await act(async () => {
      resolveMd();
      await Promise.resolve();
    });
    await waitFor(() => expect(order).toEqual(['start:md', 'done:md', 'write:json']));
    await screen.findByText('Copied to clipboard.');
    // The status (JSON copied) agrees with what the clipboard now holds (JSON).
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain(
      '"schemaVersion": 1',
    );
  });

  it('CEP-COPY-5 (#12): feedback is bound to the previewed payload — a format switch hides a stale "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel([makeRepo({ node_id: 'R_1', name_with_owner: 'acme/one' })], st());
    fireEvent.click(screen.getByRole('button', { name: /Copy as Markdown/ }));
    await screen.findByText('Copied to clipboard.');
    fireEvent.click(screen.getByLabelText('JSON'));
    expect(screen.queryByText('Copied to clipboard.')).toBeNull();
    fireEvent.click(screen.getByLabelText('Markdown'));
    expect(screen.getByText('Copied to clipboard.')).toBeTruthy();
  });

  it('CEP-COPY-6 (#12, r4): clipboard writes serialize ACROSS panel unmount/remount (module-level queue)', async () => {
    const order: string[] = [];
    let resolveA: () => void = () => {};
    const writeText = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            order.push('A:start');
            resolveA = () => {
              order.push('A:done');
              res();
            };
          }),
      )
      .mockImplementationOnce(() => {
        order.push('B:write');
        return Promise.resolve();
      });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    // Instance 1: start a copy whose write stays pending, then unmount the panel.
    const first = renderPanel([makeRepo({ node_id: 'R_1', name_with_owner: 'acme/one' })], st());
    fireEvent.click(screen.getByRole('button', { name: /Copy as Markdown/ }));
    await waitFor(() => expect(order).toEqual(['A:start']));
    first.unmount();

    // Instance 2: its copy must queue BEHIND the still-pending write from the
    // unmounted instance — not race ahead and let the stale write land last.
    renderPanel([makeRepo({ node_id: 'R_2', name_with_owner: 'acme/two' })], st());
    fireEvent.click(screen.getByRole('button', { name: /Copy as Markdown/ }));
    await Promise.resolve();
    expect(order).toEqual(['A:start']); // B has NOT started — serialized behind A

    await act(async () => {
      resolveA();
      await Promise.resolve();
    });
    await waitFor(() => expect(order).toEqual(['A:start', 'A:done', 'B:write']));
  });

  it('CEP-NET-1 (#14): the panel itself issues no network/model/MCP request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPanel([makeRepo({ node_id: 'R_1', name_with_owner: 'acme/one' })], st());
    fireEvent.click(screen.getByLabelText('JSON'));
    fireEvent.click(screen.getByLabelText('Markdown'));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('M4.4 Context Builder — Starred integration', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  async function renderStarred(repos: CanonicalRepo[]) {
    render(<App loader={async () => makeDataset(repos)} />);
    await waitFor(() => expect(screen.getByText(/repositories/)).toBeTruthy());
  }

  it('CTX-STARRED-1 (#1,#2,#13): the Copy-context button exports the whole Browse filtered set (not a page) in Starred', async () => {
    // 50 matching repos — more than the 48-row Browse page — plus 2 that the
    // query filters out.
    const repos = [
      ...Array.from({ length: 50 }, (_, i) =>
        makeRepo({
          node_id: `R_${i}`,
          name_with_owner: `acme/cli-${String(i).padStart(2, '0')}`,
          description: 'cli tool',
        }),
      ),
      makeRepo({ node_id: 'X_1', name_with_owner: 'acme/other', description: 'unrelated' }),
      makeRepo({ node_id: 'X_2', name_with_owner: 'acme/misc', description: 'unrelated' }),
    ];
    window.history.replaceState(null, '', '/?q=cli');
    await renderStarred(repos);

    // Browse reports 50 for the query.
    expect(screen.getByText(/50 results for "cli"/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy context' }));
    const dialog = await screen.findByRole('dialog');
    // The panel exports the WHOLE filtered set (50), not the 48-row page.
    expect(within(dialog).getByText(/50 repositories · \d+ characters/)).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText('JSON'));
    const json = JSON.parse((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value);
    expect(json.selection.count).toBe(50);
    expect(json.repositories).toHaveLength(50);
    expect(
      json.repositories.every((r: { nameWithOwner: string }) =>
        r.nameWithOwner.startsWith('acme/cli-'),
      ),
    ).toBe(true);

    // The filter state is untouched by opening/closing the panel (no view switch).
    expect(new URLSearchParams(window.location.search).get('q')).toBe('cli');
  });

  it('CTX-STARRED-2 (#1): the exported IDs equal the independently-computed Browse filtered+ordered set', async () => {
    const repos = [
      makeRepo({ node_id: 'R_1', name_with_owner: 'acme/alpha', primary_language: 'Rust' }),
      makeRepo({ node_id: 'R_2', name_with_owner: 'acme/beta', primary_language: 'Go' }),
      makeRepo({ node_id: 'R_3', name_with_owner: 'zeta/gamma', primary_language: 'Rust' }),
    ];
    window.history.replaceState(null, '', '/?language=Rust&sort=name_with_owner&direction=asc');
    await renderStarred(repos);
    fireEvent.click(screen.getByRole('button', { name: 'Copy context' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('JSON'));
    const json = JSON.parse((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value);
    const oracle = pipeline(
      repos,
      st({ languages: ['Rust'], sort: 'name_with_owner', direction: 'asc' }),
    ).results.map((r) => r.name_with_owner);
    expect(json.repositories.map((r: { nameWithOwner: string }) => r.nameWithOwner)).toEqual(
      oracle,
    );
    expect(oracle).toEqual(['acme/alpha', 'zeta/gamma']);
  });
});
