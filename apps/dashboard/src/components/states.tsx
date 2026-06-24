import type { DataLoadKind } from '../data/load-stars';

export function Loading() {
  return <p role="status">Loading starred repositories…</p>;
}

export function EmptyState() {
  return (
    <main>
      <h1>Starred repositories</h1>
      <p>No starred repositories yet.</p>
    </main>
  );
}

/**
 * Shown when the dataset is non-empty but nothing matches the current search and
 * filters (RESULT-2). Distinct from {@link EmptyState}, which means the trusted
 * source genuinely contains zero repositories.
 */
export function NoResults({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="no-results">
      <h3>No matching repositories</h3>
      <p>No repositories match the current search and filters.</p>
      <button type="button" onClick={onClearFilters}>
        Clear filters
      </button>
    </div>
  );
}

const ERROR_TITLE: Record<string, string> = {
  integrity: 'Data integrity check failed',
  schema: 'Data failed validation',
  fetch: 'Could not load data',
};

export function ErrorState({ kind, message }: { kind: DataLoadKind | 'unknown'; message: string }) {
  return (
    <main role="alert">
      <h1>{ERROR_TITLE[kind] ?? 'Something went wrong'}</h1>
      <p>{message}</p>
    </main>
  );
}
