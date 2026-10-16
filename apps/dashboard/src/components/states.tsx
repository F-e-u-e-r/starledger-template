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

/**
 * Grouped-empty state E-G (P7 §15.7, M4.1): the result set is non-empty but
 * none of it carries a Skills classification, so the grouped presentation has
 * nothing to render. Distinct from {@link NoResults} (`results.length === 0`),
 * which is unchanged regardless of `group`. "Show as list" always recovers the
 * flat list (`group=none`); "Clear filters" renders only when the caller passes
 * `onClearFilters` — i.e. only while filters or a query are active — and, by
 * D4, clearing keeps `group`, so the cleared state re-renders grouped over the
 * full classified set.
 */
export function NoClassifiedResults({
  excludedCount,
  onShowAsList,
  onClearFilters,
}: {
  excludedCount: number;
  onShowAsList: () => void;
  onClearFilters?: () => void;
}) {
  const one = excludedCount === 1;
  return (
    <div className="no-results">
      <h3>No classified repositories in this result set</h3>
      <p>
        {excludedCount} matching {one ? 'repository' : 'repositories'} {one ? 'has' : 'have'} no
        Skills classification, so grouped view has nothing to show.
      </p>
      <button type="button" onClick={onShowAsList}>
        Show as list
      </button>
      {onClearFilters ? (
        <button type="button" onClick={onClearFilters}>
          Clear filters
        </button>
      ) : null}
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
