/**
 * Redact secret-like values from text before it is logged, written to
 * run-meta, or surfaced in an error. GitHub tokens have been prefixed since
 * 2021 (ghp_/gho_/ghu_/ghs_/ghr_, github_pat_), so pattern matching is
 * reliable; explicitly supplied secrets (including short Telegram chat IDs)
 * are always redacted too.
 */
const TOKEN_PATTERNS: RegExp[] = [/gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g];

export function redactSecrets(input: string, extra: readonly (string | undefined)[] = []): string {
  let out = input;
  for (const secret of extra) {
    if (secret) out = out.split(secret).join('***');
  }
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '***');
  // Redact an Authorization header value regardless of token shape.
  out = out.replace(/(authorization\s*[:=]\s*"?)(?:token|bearer)\s+\S+/gi, '$1***');
  return out;
}
