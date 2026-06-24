import { describe, expect, it } from 'vitest';
import { makeRepo } from '../../test-utils';
import { sortRepos } from './sorting';

describe('sortRepos (SORT-1 / SORT-2 / SORT-3)', () => {
  it('SORT-1: asc/desc with a deterministic node_id tiebreak', () => {
    const repos = [
      makeRepo({ node_id: 'R_b', stargazer_count: 10 }),
      makeRepo({ node_id: 'R_a', stargazer_count: 10 }),
      makeRepo({ node_id: 'R_c', stargazer_count: 5 }),
    ];
    // desc: 10s first (tie → node_id ASC), then 5
    expect(sortRepos(repos, 'stargazer_count', 'desc').map((r) => r.node_id)).toEqual([
      'R_a',
      'R_b',
      'R_c',
    ]);
    // asc: 5 first, then the 10s (tie → node_id ASC)
    expect(sortRepos(repos, 'stargazer_count', 'asc').map((r) => r.node_id)).toEqual([
      'R_c',
      'R_a',
      'R_b',
    ]);
  });

  it('SORT-2: null/unknown values sort last regardless of direction', () => {
    const repos = [
      makeRepo({ node_id: 'R_known', stargazer_count: 5 }),
      makeRepo({ node_id: 'R_unknown', stargazer_count: null }),
    ];
    expect(sortRepos(repos, 'stargazer_count', 'asc').map((r) => r.node_id)).toEqual([
      'R_known',
      'R_unknown',
    ]);
    expect(sortRepos(repos, 'stargazer_count', 'desc').map((r) => r.node_id)).toEqual([
      'R_known',
      'R_unknown',
    ]);
  });

  it('SORT-3: returns a new array without mutating input order or objects', () => {
    const a = makeRepo({ node_id: 'R_a', stargazer_count: 5 });
    const b = makeRepo({ node_id: 'R_b', stargazer_count: 10 });
    const input = [a, b];
    const snapshot = [...input];

    const sorted = sortRepos(input, 'stargazer_count', 'desc');

    expect(sorted).not.toBe(input); // a fresh array is returned
    expect(sorted.map((r) => r.node_id)).toEqual(['R_b', 'R_a']); // and it is actually sorted
    expect(input).toEqual(snapshot); // input order is untouched...
    expect(input[0]).toBe(a); // ...and the original element references did not move
    expect(input[1]).toBe(b);
  });
});
