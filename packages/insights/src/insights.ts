import { STALE_MONTHS } from './staleness';
import type {
  CategoryDistribution,
  ClassificationCoverage,
  Coverage,
  InsightRepo,
  InsightSkillsSummary,
  MonthBucket,
  Provenance,
  StaleStars,
  StarringActivity,
} from './types';

/**
 * The four deterministic Insights aggregations (M4.3a), over the narrow
 * `InsightRepo` contract. Each carries a provenance record (what was computed, from
 * which fields, by what formula) and a coverage record (how much of the dataset it
 * reflects, on which optional layer, with generation provenance for a generated
 * layer), so a consumer can always explain a number and never shows an opaque score.
 */

/** PC: group annotated repos by AI category; sort by count desc, then name asc.
 *  `generatedAt` is the AI layer's generation timestamp (a generated layer carries
 *  its generation provenance in `coverage`, like the skills layer). */
export function computeCategoryDistribution(
  repos: readonly InsightRepo[],
  generatedAt?: string,
): CategoryDistribution {
  const counts = new Map<string, number>();
  let annotated = 0;
  for (const repo of repos) {
    if (repo.ai === null) continue;
    annotated += 1;
    counts.set(repo.ai.category, (counts.get(repo.ai.category) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
    );
  return {
    provenance: {
      method: 'Count of your stars in each AI category',
      sourceFields: ['ai.category'],
      formula: 'group annotated repos by ai.category, count each',
    },
    coverage: { n: annotated, of: repos.length, layer: 'ai', generatedAt },
    rows,
  };
}

/** Next UTC month for a `YYYY-MM` key (for contiguous zero-fill). */
function nextMonth(ym: string): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7)); // 1-12
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  return `${String(nextY).padStart(4, '0')}-${String(nextM).padStart(2, '0')}`;
}

/**
 * SA: bucket currently-held stars by the UTC month of `starred_at`, zero-filled
 * contiguously from the first to the last month that has a star. `starred_at` is
 * a UTC ISO instant (trailing `Z`), so the `YYYY-MM` prefix is the UTC month with
 * no local-time skew. Repos without a usable `starred_at` are excluded and the
 * window is null when none remain.
 */
export function computeStarringActivity(repos: readonly InsightRepo[]): StarringActivity {
  const counts = new Map<string, number>();
  let counted = 0;
  for (const repo of repos) {
    const at = repo.starred_at;
    if (typeof at !== 'string') continue;
    // Strictly validate a canonical 4-digit-year UTC instant ENDING IN `Z`, then
    // require the parsed date to ROUND-TRIP to the same UTC Y/M/D. This fails CLOSED
    // on three classes the permissive schema (`starred_at: z.string().min(1)`) would
    // otherwise admit:
    //  - timezone-LESS strings (no `Z`) — they parse in the runtime's LOCAL zone, so
    //    the UTC month (and the round-trip) would be machine-dependent, breaking
    //    determinism; only a `Z` instant is accepted;
    //  - impossible dates the Date constructor silently NORMALIZES (`2026-02-30` →
    //    Mar 2) — excluded rather than misbucketed into the wrong month; and
    //  - non-4-digit (extended / negative) years — `nextMonth` slices exactly four
    //    year digits, so a `10000-01`/`-000001-01` month key the contiguous zero-fill
    //    below can never reach would loop forever. A GitHub `starred_at` is always a
    //    canonical 4-digit-year `Z` instant, so real data is unaffected.
    const m = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.exec(at);
    if (m === null) continue;
    const d = new Date(at);
    if (
      Number.isNaN(d.getTime()) ||
      d.getUTCFullYear() !== Number(m[1]) ||
      d.getUTCMonth() + 1 !== Number(m[2]) ||
      d.getUTCDate() !== Number(m[3])
    ) {
      continue;
    }
    const month = `${m[1]}-${m[2]}`;
    counts.set(month, (counts.get(month) ?? 0) + 1);
    counted += 1;
  }
  const provenance: Provenance = {
    method: 'Count of the repos you currently hold, by the UTC month you starred them',
    sourceFields: ['starred_at'],
    formula: 'group repos by starred_at UTC month (YYYY-MM), count each, zero-fill the span',
  };
  const coverage: Coverage = { n: counted, of: repos.length, layer: 'canonical' };
  if (counts.size === 0) return { provenance, coverage, window: null, buckets: [] };
  const months = [...counts.keys()].sort();
  const from = months[0]!;
  const to = months[months.length - 1]!;
  const buckets: MonthBucket[] = [];
  for (let m = from; ; m = nextMonth(m)) {
    buckets.push({ month: m, count: counts.get(m) ?? 0 });
    if (m === to) break;
  }
  return { provenance, coverage, window: { field: 'starred_at', from, to }, buckets };
}

/**
 * ST: stale ("forgotten") stars — reuses the shared staleness semantics EXACTLY
 * (`isStale`: push date KNOWN and older than `STALE_MONTHS`, pre-derived by
 * `deriveStaleness`). An unknown/absent push date is never stale (unknown ≠ absent)
 * and is reported separately so the count is not silently understated.
 */
export function computeStaleStars(repos: readonly InsightRepo[]): StaleStars {
  let staleCount = 0;
  let unknownPushCount = 0;
  for (const repo of repos) {
    if (repo.isStale) staleCount += 1;
    if (repo.monthsSincePush === null) unknownPushCount += 1;
  }
  return {
    provenance: {
      method: `Stars whose upstream has not pushed in over ${STALE_MONTHS} months`,
      sourceFields: ['pushed_at'],
      formula: `count repos where isStale (pushed_at known and older than ${STALE_MONTHS} months)`,
    },
    coverage: { n: repos.length - unknownPushCount, of: repos.length, layer: 'canonical' },
    staleCount,
    unknownPushCount,
    thresholdMonths: STALE_MONTHS,
  };
}

/**
 * CC: how many currently-held stars fall in the curated skills-ecosystem
 * classification. `matched` is the LIVE join (repos in the current dataset that
 * carry a classification), not the generation-time count — so it reflects the
 * dataset as loaded. The classification is a curated SUBSET generated once against
 * a (possibly older) stars snapshot; when that snapshot differs from the live one
 * the coverage is provenance-stale, which the consumer discloses. `null` skills ⇒ the
 * layer is unavailable (the caller renders/returns a degraded result).
 */
export function computeClassificationCoverage(
  repos: readonly InsightRepo[],
  skills: InsightSkillsSummary | null,
  currentStarsSha256: string | undefined,
): ClassificationCoverage {
  const matched = repos.reduce((n, repo) => (repo.skills !== null ? n + 1 : n), 0);
  const stale =
    skills != null &&
    currentStarsSha256 != null &&
    skills.generatedAgainstStarsSha256 !== currentStarsSha256;
  return {
    provenance: {
      method: 'How many of your current stars are in the curated skills-ecosystem classification',
      sourceFields: ['skills'],
      formula: 'count current repos carrying a classification record (live join)',
    },
    coverage: {
      n: matched,
      of: repos.length,
      layer: 'skills',
      generatedAt: skills?.generatedAt,
      generatedAgainstStarsSha256: skills?.generatedAgainstStarsSha256,
      stale,
    },
    matched,
    unresolved: skills?.coverage.unresolved ?? 0,
    curatedSubset: true,
    stale,
  };
}
