/**
 * `@starred/insights` — the deterministic Insights core, shared by the dashboard
 * (M4.3a) and, later, a read-only MCP server (M4.3b.2). Every value here is a pure
 * function of the CURRENT loaded snapshot: there is no longitudinal store, so
 * nothing may claim a trend, growth, or shift over time; a per-period count is
 * "of the repos currently held, when they were starred", not a historical add-rate.
 *
 * The package owns a NARROW input contract (`InsightRepo`) — only the fields the
 * four computations read — NOT the dashboard's full `DerivedRepo`. The dashboard's
 * `DerivedRepo` structurally satisfies `InsightRepo`; the browse pipeline
 * (search / filter / sort / release-state) stays in the app and is never dragged
 * into this package. That keeps the dependency direction one-way: both real
 * consumers depend on this package; this package depends on neither.
 */

/** What was computed and how — rendered/returned beside every insight. */
export interface Provenance {
  method: string;
  sourceFields: string[];
  formula: string;
}

/** How much of the dataset an insight reflects. `layer` names the data source; a
 *  generated layer (`ai`/`skills`) carries its generation provenance so a consumer
 *  sees coverage and staleness, never a bare percentage. */
export interface Coverage {
  n: number;
  of: number;
  layer: 'canonical' | 'ai' | 'skills';
  generatedAt?: string;
  /** For the skills layer: the stars snapshot the classification was generated
   *  against. When it differs from the live snapshot the coverage is provenance-
   *  stale (an older, curated subset), which the consumer must disclose. */
  generatedAgainstStarsSha256?: string;
  stale?: boolean;
}

/**
 * The narrow per-repo input the four computations read — and NOTHING else. The
 * dashboard's `DerivedRepo` (and any future MCP snapshot row) structurally
 * satisfies this without importing it.
 *
 * `monthsSincePush` / `isStale` are PRE-DERIVED by the shared staleness primitive
 * (`deriveStaleness`, explicit `asOf`) so ST has a single formula across consumers;
 * this package does not re-derive them here.
 */
export interface InsightRepo {
  /** UTC ISO instant the repo was starred (SA buckets by its UTC month). */
  readonly starred_at: string;
  /** Optional AI layer — PC reads `ai.category`; `null` when unannotated. */
  readonly ai: { readonly category: string } | null;
  /** Optional skills classification — CC counts a live join by presence only, so
   *  this is intentionally opaque (`null` when unclassified). */
  readonly skills: unknown;
  /** Months since last push; `null` when the push date is unknown/absent. */
  readonly monthsSincePush: number | null;
  /** True only when the push date is known and older than `STALE_MONTHS`. */
  readonly isStale: boolean;
}

/** The generation provenance CC needs from the aggregate classification (not a
 *  per-repo field). The dashboard's `LoadedSkillsClassification` satisfies it. */
export interface InsightSkillsSummary {
  readonly generatedAt: string;
  readonly generatedAgainstStarsSha256: string;
  readonly coverage: { readonly unresolved: number };
}

export interface CategoryRow {
  category: string;
  count: number;
}

/** PC — primary-category distribution over the AI-enrichment layer. */
export interface CategoryDistribution {
  provenance: Provenance;
  coverage: Coverage;
  rows: CategoryRow[];
}

export interface MonthBucket {
  /** UTC calendar month, `YYYY-MM`. */
  month: string;
  count: number;
}

/** SA — starring activity by UTC month over currently-held stars. */
export interface StarringActivity {
  provenance: Provenance;
  coverage: Coverage;
  /** Null only when no repo carries a usable `starred_at`. */
  window: { field: 'starred_at'; from: string; to: string } | null;
  /** Contiguous, zero-filled from the first to the last month with a star. */
  buckets: MonthBucket[];
}

/** ST — stale ("forgotten") stars: upstream not pushed within the threshold. */
export interface StaleStars {
  provenance: Provenance;
  coverage: Coverage;
  staleCount: number;
  /** Repos whose push date is unknown/absent — NEVER counted as stale. */
  unknownPushCount: number;
  thresholdMonths: number;
}

/** CC — how many currently-held stars fall in the curated skills classification. */
export interface ClassificationCoverage {
  provenance: Provenance;
  coverage: Coverage;
  /** Live join: current stars carrying a classification record. */
  matched: number;
  /** Source entries the generator could not resolve to a live repo (meta). */
  unresolved: number;
  /** The classification is a curated ECOSYSTEM SUBSET — "unmatched" is outside
   *  that subset, not a coverage failure. Always true; the wording depends on it. */
  curatedSubset: true;
  /** The classification was generated against an older stars snapshot. */
  stale: boolean;
}
