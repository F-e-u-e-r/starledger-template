export interface DegradedDecision {
  degraded: boolean;
  degradedRatio: number;
  withinThreshold: boolean;
}

/**
 * Degraded publication contract.
 *
 *   degraded_ratio = hydration_failed_publishable / enumerated_after_dedup
 *
 * The threshold comparison uses basis points to avoid floating-point ambiguity
 * at the boundary:  failed/total <= maxRatio  ⟺  failed*10000 <= total*bps.
 * private_filtered / removed_mid_run / dropped_unidentifiable are NOT part of
 * this ratio (numerator or denominator).
 */
export function evaluateDegraded(
  failedPublishable: number,
  enumeratedAfterDedup: number,
  maxDegradedRatio: number,
): DegradedDecision {
  const basisPoints = Math.round(maxDegradedRatio * 10000);
  const withinThreshold = failedPublishable * 10000 <= enumeratedAfterDedup * basisPoints;
  const degradedRatio = enumeratedAfterDedup === 0 ? 0 : failedPublishable / enumeratedAfterDedup;
  return { degraded: failedPublishable > 0, degradedRatio, withinThreshold };
}
