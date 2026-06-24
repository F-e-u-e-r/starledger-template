export interface RateLimit {
  cost: number;
  remaining: number;
  reset_at: string;
}

export interface RawRateLimit {
  cost: number;
  remaining: number;
  resetAt: string;
}

export function toRateLimit(raw: RawRateLimit): RateLimit {
  return { cost: raw.cost, remaining: raw.remaining, reset_at: raw.resetAt };
}
