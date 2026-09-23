import { useEffect, useRef, useState } from 'react';
import {
  type LoadedSkillsClassification,
  type SkillsClassificationStatus,
  loadSkillsClassification,
} from './load-skills-classification';

export interface SkillsClassificationState {
  status: SkillsClassificationStatus;
  data: LoadedSkillsClassification | null;
}

/**
 * Availability-state hook for the optional skills-classification layer
 * (P7 §4.10). Locked decision 1: `loading` from mount until the loader
 * settles — NEVER mislabeled `unavailable` while in flight; `unavailable`
 * only after a definitive failure (loader resolved `null` or rejected).
 *
 * Since M2.4 (§4.11) the state IS consumed: RepositoryView projects it into
 * the Skills-ecosystem scope, the skill-category facet and card badges.
 * INVARIANT this hook upholds and consumers may rely on: `status === 'ready'`
 * ⟺ `data !== null` (ready always carries data; loading/unavailable never
 * do). RepositoryView still re-checks the conjunction defensively — its
 * activation contract is status `ready` AND data, never either half alone
 * (M24-STS-1/STS-4).
 */
export function useSkillsClassification(
  loader?: () => Promise<LoadedSkillsClassification | null>,
): SkillsClassificationState {
  const [state, setState] = useState<SkillsClassificationState>({
    status: 'loading',
    data: null,
  });

  // The loader is read through a ref, never through the effect's dependency
  // list. Loader IDENTITY is not a reload signal (review finding F3): an
  // inline `useSkillsClassification(() => …)` produces a new function on every
  // render, and keying the effect on it made each settled load re-render, mint
  // a new identity, restart the effect and settle again — an unbounded
  // load↔render cycle (measured: thousands of loader calls in milliseconds).
  // An earlier idempotent `loading` reset only blocked the SYNCHRONOUS variant
  // of that cycle; the asynchronous one ran unchecked.
  //
  // The lifecycle is therefore anchored to MOUNT alone. Production never
  // replaced the loader anyway (App passes an undefined loader outside tests),
  // so nothing observable is lost; a future explicit reload trigger would be a
  // deliberate input, not an accident of referential identity.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    const load =
      loaderRef.current ?? (() => loadSkillsClassification({ base: import.meta.env.BASE_URL }));
    let active = true;
    // Promise.resolve().then(load) routes a SYNCHRONOUS loader throw into the
    // rejection path instead of letting it escape the effect.
    Promise.resolve()
      .then(() => load())
      .then(
        (data) => {
          if (!active) return;
          setState(data ? { status: 'ready', data } : { status: 'unavailable', data: null });
        },
        () => {
          if (active) setState({ status: 'unavailable', data: null });
        },
      );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
