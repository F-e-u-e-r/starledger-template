/**
 * The single deterministic staleness formula, shared by every consumer so ST can
 * never grow a second definition (M4.3a pinned "exact reuse `isStale` /
 * `STALE_MONTHS = 12`" as an acceptance invariant). The time input is EXPLICIT
 * (`asOf`) — no wall clock is read here: the dashboard passes its render `now`, and
 * a future MCP server passes the single `asOf` it pins once at startup.
 */

/** A push older than this many months (and known) is "stale". */
export const STALE_MONTHS = 12;

/** Average month length in ms — 30.44 days, the M4.3a constant, carried over unchanged. */
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

export interface Staleness {
  /** Months since the push instant, or `null` when the push date is unknown/absent. */
  monthsSincePush: number | null;
  /** True only when the push date is known and older than `STALE_MONTHS`. */
  isStale: boolean;
}

/**
 * Derive staleness from a push instant against an explicit `asOf`.
 *
 * `pushedAt` is the EFFECTIVE push timestamp (ISO), or `null` when it is unknown or
 * absent — the caller resolves "unavailable / absent" to `null`, and an unknown
 * push date is NEVER stale (unknown ≠ old). The arithmetic is identical to the
 * M4.3a dashboard derivation; only the clock became an explicit argument.
 */
export function deriveStaleness(pushedAt: string | null, asOf: Date): Staleness {
  const monthsSincePush =
    pushedAt !== null ? (asOf.getTime() - new Date(pushedAt).getTime()) / MS_PER_MONTH : null;
  return {
    monthsSincePush,
    isStale: monthsSincePush !== null && monthsSincePush > STALE_MONTHS,
  };
}
