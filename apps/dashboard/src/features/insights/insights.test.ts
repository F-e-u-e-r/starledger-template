import { describe, expect, it } from 'vitest';
import { deriveAll, STALE_MONTHS } from '../../data/derive-fields';
import {
  makeAnnotation,
  makeAnnotations,
  makeRepo,
  makeSkillsClassification,
  makeSkillsRecord,
} from '../../test-utils';
import {
  computeCategoryDistribution,
  computeClassificationCoverage,
  computeStaleStars,
  computeStarringActivity,
} from '@starred/insights';

const NOW = new Date('2026-06-19T00:00:00Z');

describe('M4.3a insights — PC (primary-category distribution)', () => {
  it('PC-1: groups annotated repos by AI category, sorted by count desc then name asc; excludes unannotated', () => {
    const repos = [
      makeRepo({ node_id: 'R_1' }),
      makeRepo({ node_id: 'R_2' }),
      makeRepo({ node_id: 'R_3' }),
      makeRepo({ node_id: 'R_4' }), // unannotated — excluded
    ];
    const annotations = makeAnnotations({
      R_1: makeAnnotation({ category: 'ai-ml' }),
      R_2: makeAnnotation({ category: 'developer-tools' }),
      R_3: makeAnnotation({ category: 'developer-tools' }),
    });
    const derived = deriveAll(repos, NOW, annotations.byNodeId);
    const pc = computeCategoryDistribution(derived);
    // developer-tools (2) before ai-ml (1); coverage counts only annotated repos.
    expect(pc.rows).toEqual([
      { category: 'developer-tools', count: 2 },
      { category: 'ai-ml', count: 1 },
    ]);
    expect(pc.coverage).toEqual({ n: 3, of: 4, layer: 'ai' });
    expect(pc.provenance.sourceFields).toEqual(['ai.category']);
  });

  it('PC-2: equal counts break ties by category name ascending', () => {
    const repos = [makeRepo({ node_id: 'R_1' }), makeRepo({ node_id: 'R_2' })];
    const annotations = makeAnnotations({
      R_1: makeAnnotation({ category: 'zeta' }),
      R_2: makeAnnotation({ category: 'alpha' }),
    });
    const pc = computeCategoryDistribution(deriveAll(repos, NOW, annotations.byNodeId));
    expect(pc.rows.map((r) => r.category)).toEqual(['alpha', 'zeta']);
  });

  it('PC-3: no annotations ⇒ empty rows, coverage n=0', () => {
    const pc = computeCategoryDistribution(deriveAll([makeRepo({ node_id: 'R_1' })], NOW));
    expect(pc.rows).toEqual([]);
    expect(pc.coverage).toEqual({ n: 0, of: 1, layer: 'ai' });
  });

  it('PC-4: coverage carries the AI generation timestamp when provided (generated-layer provenance)', () => {
    const annotations = makeAnnotations({ R_1: makeAnnotation() });
    const pc = computeCategoryDistribution(
      deriveAll([makeRepo({ node_id: 'R_1' })], NOW, annotations.byNodeId),
      annotations.generatedAt,
    );
    expect(pc.coverage.generatedAt).toBe(annotations.generatedAt);
  });
});

describe('M4.3a insights — SA (starring activity by UTC month)', () => {
  it('SA-1: buckets by UTC month, zero-filled contiguously, with the window', () => {
    const repos = [
      makeRepo({ node_id: 'R_1', starred_at: '2026-01-10T12:00:00Z' }),
      makeRepo({ node_id: 'R_2', starred_at: '2026-01-20T12:00:00Z' }),
      // February intentionally empty (must appear as a zero bucket)
      makeRepo({ node_id: 'R_3', starred_at: '2026-03-05T12:00:00Z' }),
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW));
    expect(sa.buckets).toEqual([
      { month: '2026-01', count: 2 },
      { month: '2026-02', count: 0 },
      { month: '2026-03', count: 1 },
    ]);
    expect(sa.window).toEqual({ field: 'starred_at', from: '2026-01', to: '2026-03' });
    expect(sa.coverage).toEqual({ n: 3, of: 3, layer: 'canonical' });
  });

  it('SA-2: UTC month boundary — end-of-month Z stays, start-of-next-month Z rolls over', () => {
    const repos = [
      makeRepo({ node_id: 'R_1', starred_at: '2026-03-31T23:59:59Z' }), // → 2026-03
      makeRepo({ node_id: 'R_2', starred_at: '2026-04-01T00:00:00Z' }), // → 2026-04
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW));
    expect(sa.buckets).toEqual([
      { month: '2026-03', count: 1 },
      { month: '2026-04', count: 1 },
    ]);
  });

  it('SA-3: zero-fill crosses a year boundary (Dec → Jan)', () => {
    const repos = [
      makeRepo({ node_id: 'R_1', starred_at: '2025-12-15T00:00:00Z' }),
      makeRepo({ node_id: 'R_2', starred_at: '2026-02-15T00:00:00Z' }),
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW));
    expect(sa.buckets.map((b) => b.month)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('SA-4: repos without a usable UTC starred_at are excluded; empty ⇒ null window', () => {
    const repos = [
      makeRepo({ node_id: 'R_1', starred_at: '' }),
      makeRepo({ node_id: 'R_2', starred_at: 'not-a-date' }),
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW));
    expect(sa.buckets).toEqual([]);
    expect(sa.window).toBeNull();
    expect(sa.coverage.n).toBe(0);
  });

  it('SA-5: an invalid-MONTH timestamp is EXCLUDED — the zero-fill terminates (no infinite loop)', () => {
    // `2026-13` passes a shape-only prefix check but is an invalid month; `nextMonth`
    // from `2026-12` can never reach it, so bucketing it would loop forever. It must
    // be excluded. (This test itself hangs if the regression returns.)
    const repos = [
      makeRepo({ node_id: 'R_1', starred_at: '2026-11-10T00:00:00Z' }),
      makeRepo({ node_id: 'R_bad', starred_at: '2026-13-01T00:00:00Z' }), // invalid UTC month
      makeRepo({ node_id: 'R_2', starred_at: '2026-12-10T00:00:00Z' }),
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW));
    expect(sa.buckets).toEqual([
      { month: '2026-11', count: 1 },
      { month: '2026-12', count: 1 },
    ]);
    expect(sa.coverage.n).toBe(2); // the invalid instant is excluded, never bucketed
  });

  it('SA-6: an impossible date the Date constructor NORMALIZES (Feb 30 → Mar 2) is EXCLUDED, not misbucketed', () => {
    const repos = [
      makeRepo({ node_id: 'R_mar', starred_at: '2026-03-15T00:00:00Z' }),
      makeRepo({ node_id: 'R_feb30', starred_at: '2026-02-30T00:00:00Z' }), // → Mar 2 on V8; excluded
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW));
    // only the genuine March repo — the normalized Feb-30 is NOT counted in March
    expect(sa.buckets).toEqual([{ month: '2026-03', count: 1 }]);
    expect(sa.coverage.n).toBe(1);
  });

  it('SA-7: an extended (non-4-digit) year is EXCLUDED — the zero-fill cannot spin', () => {
    const repos = [
      makeRepo({ node_id: 'R_1', starred_at: '2026-05-01T00:00:00Z' }),
      makeRepo({ node_id: 'R_big', starred_at: '10000-01-01T00:00:00Z' }), // 5-digit year
      makeRepo({ node_id: 'R_2', starred_at: '2026-06-01T00:00:00Z' }),
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW)); // must terminate
    expect(sa.buckets).toEqual([
      { month: '2026-05', count: 1 },
      { month: '2026-06', count: 1 },
    ]);
    expect(sa.coverage.n).toBe(2); // the extended-year instant excluded
  });

  it('SA-8: a timezone-LESS or offset instant is EXCLUDED — only a `Z` UTC instant is deterministic', () => {
    const repos = [
      makeRepo({ node_id: 'R_z', starred_at: '2026-07-10T00:00:00Z' }),
      makeRepo({ node_id: 'R_local', starred_at: '2026-07-10T00:00:00' }), // no Z ⇒ local zone ⇒ excluded
      makeRepo({ node_id: 'R_offset', starred_at: '2026-07-10T00:00:00+02:00' }), // offset ⇒ excluded
    ];
    const sa = computeStarringActivity(deriveAll(repos, NOW));
    // deterministic regardless of the runtime timezone: only the `Z` instant counts
    expect(sa.buckets).toEqual([{ month: '2026-07', count: 1 }]);
    expect(sa.coverage.n).toBe(1);
  });
});

describe('M4.3a insights — ST (stale / forgotten stars) reuses existing staleness', () => {
  it('ST-1: counts DerivedRepo.isStale exactly; unknown push is excluded and reported', () => {
    const repos = [
      makeRepo({ node_id: 'R_old', pushed_at: '2025-01-01T00:00:00Z' }), // ~17.6 mo → stale
      makeRepo({ node_id: 'R_fresh', pushed_at: '2026-05-01T00:00:00Z' }), // ~1.6 mo → not
      makeRepo({ node_id: 'R_unknown', pushed_at: null }), // unknown → not stale, counted apart
    ];
    const st = computeStaleStars(deriveAll(repos, NOW));
    expect(st.staleCount).toBe(1);
    expect(st.unknownPushCount).toBe(1);
    expect(st.thresholdMonths).toBe(STALE_MONTHS);
    expect(st.coverage).toEqual({ n: 2, of: 3, layer: 'canonical' });
  });

  it('ST-2: exactly at the threshold is NOT stale (strictly greater-than, matching isStale)', () => {
    // isStale is monthsSincePush > STALE_MONTHS; use a push just under 12 months.
    const repos = [makeRepo({ node_id: 'R_1', pushed_at: '2025-07-01T00:00:00Z' })]; // ~11.6 mo
    const st = computeStaleStars(deriveAll(repos, NOW));
    expect(st.staleCount).toBe(0);
    // cross-check: derive agrees
    expect(deriveAll(repos, NOW)[0]!.isStale).toBe(false);
  });
});

describe('M4.3a insights — CC (classification coverage)', () => {
  const repos = [
    makeRepo({ node_id: 'R_1' }),
    makeRepo({ node_id: 'R_2' }),
    makeRepo({ node_id: 'R_3' }),
  ];
  const skills = makeSkillsClassification(
    { R_1: makeSkillsRecord(), R_2: makeSkillsRecord() }, // 2 of 3 live-joined
    {
      coverage: { matched: 2, unclassified: 1, unresolved: 3 },
      generatedAt: '2026-08-13T00:00:00Z',
    },
  );

  it('CC-1: matched = live join; provenance carries generatedAt + unresolved; layer=skills', () => {
    const derived = deriveAll(repos, NOW, undefined, skills.byNodeId);
    const cc = computeClassificationCoverage(derived, skills, '0'.repeat(64));
    expect(cc.matched).toBe(2);
    expect(cc.coverage.n).toBe(2);
    expect(cc.coverage.of).toBe(3);
    expect(cc.coverage.layer).toBe('skills');
    expect(cc.coverage.generatedAt).toBe('2026-08-13T00:00:00Z');
    expect(cc.unresolved).toBe(3);
    expect(cc.curatedSubset).toBe(true);
  });

  it('CC-2: stale flag set when generated-against sha differs from the current stars sha', () => {
    const derived = deriveAll(repos, NOW, undefined, skills.byNodeId);
    // makeSkillsClassification default generatedAgainstStarsSha256 = '0'.repeat(64)
    expect(computeClassificationCoverage(derived, skills, '0'.repeat(64)).stale).toBe(false);
    expect(computeClassificationCoverage(derived, skills, 'f'.repeat(64)).stale).toBe(true);
    // unknown current sha ⇒ cannot assert staleness ⇒ not stale
    expect(computeClassificationCoverage(derived, skills, undefined).stale).toBe(false);
  });

  it('CC-3: null skills layer ⇒ matched 0 (caller renders a degraded card)', () => {
    const derived = deriveAll(repos, NOW); // no skills join
    const cc = computeClassificationCoverage(derived, null, '0'.repeat(64));
    expect(cc.matched).toBe(0);
    expect(cc.stale).toBe(false);
    expect(cc.unresolved).toBe(0);
  });
});
