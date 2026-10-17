# StarLedger brand tokens

StarLedger is an **adapted member of the owner's Portfolio product family**.
Portfolio (`portfolio.secc.dev`) is the reference brand; StarLedger inherits its
language and adapts it to a data-dense GitHub-stars dashboard. See
`docs/adr/ADR-005-portfolio-visual-alignment.md` for the decision and its
boundaries, and P7 §9/§14 for the superseded M3 identity.

**Authoritative source:** `apps/dashboard/src/styles.css` (`:root` + the
`@media (prefers-color-scheme: dark)` block). This document mirrors those
values as of the WS4-SL change; the stylesheet wins on any disagreement, and
`features/identity/brand-tokens.test.ts` recomputes the contrast gates below
from the live token values on every test run.

No shared npm package, no runtime dependency on Portfolio, no cross-repo CSS
fetch. The fonts are the only shared asset, and they are vendored (copied), not
imported.

## Palette

StarLedger keeps **light and dark** (`prefers-color-scheme`); Portfolio is
dark-only. Dark mode carries Portfolio's green-black surfaces verbatim; light
mode is an adaptation (Portfolio has no light palette) that keeps the emerald
hue but darkens the accent so link text clears 4.5:1 on white.

| Token               | Light                  | Dark                     | Role                                                        |
| ------------------- | ---------------------- | ------------------------ | ----------------------------------------------------------- |
| `--bg`              | `#ffffff`              | `#080b0a`                | page background                                             |
| `--surface`         | `#f6faf8`              | `#111815`                | cards, sidebar, panels                                      |
| `--chip-bg`         | `#ebf2ee`              | `#16201c`                | chips, tags, raised pills (Portfolio surface-2)             |
| `--fg`              | `#1f2328`              | `#e8efeb`                | primary text                                                |
| `--muted`           | `#51605a`              | `#9aa8a2`                | secondary text                                              |
| `--accent`          | `#0f7355`              | `#35e0a1`                | **interactive** emerald (see rule below)                    |
| `--accent-muted`    | `#157856`              | `#27a97c`                | **passive** green — `>_` mark + badge text (≥4.5:1 as text) |
| `--accent-contrast` | `#ffffff`              | `#04120c`                | text/icon on a filled-accent control                        |
| `--focus`           | `#0f7355`              | `#35e0a1`                | keyboard focus ring (= accent)                              |
| `--border`          | `rgba(20,110,75,0.32)` | `rgba(170,205,190,0.22)` | green-alpha borders                                         |
| `--caution`         | `#9a6700`              | `#d29922`                | **preserved** functional status (amber)                     |

## Emerald interaction semantic

Bright `--accent` is reserved for things the visitor **acts on or has
selected**: links, hover/focus affordances, active/selected state, filled
buttons, and the focus ring. Everything passive — the `>_` brand mark,
AI/skill/discovery provenance rules and badges, primary skill-category badges,
the "Candidate" status badge — uses `--accent-muted`. Do not promote a passive
element to the bright accent because it feels important.

## Preserved functional / status colours (never recolour to emerald)

StarLedger's only semantic colours, all kept exactly:

- `--caution` (amber) — degraded/unavailable layers, "Partial data" badges.
- Promoted-success green — `#1a7f37` (light) / `#3fb950` (dark), hard-coded on
  `.badge-discovery-promoted`.
- Neutral `--muted` "Dismissed" badge — deliberately quieter than
  Candidate/Promoted; status carried by text, colour only reinforces.
- `.unknown` (italic + muted) "information unavailable" vs `.none` "confirmed
  absent" — distinct states, never conflated.
- Modal scrims `rgb(0 0 0 / 0.45)`.

There is **no** categorical / per-language / per-topic / chart-category palette
to preserve (the single Insights bar is one accent hue, magnitude by width),
and no error/red colour exists.

## Technical typography (JetBrains Mono)

System sans stays the body/UI font. JetBrains Mono (self-hosted, **SIL
OFL-1.1**) is used **only** for technical, system-facing roles — repository
identifiers, metrics and counts, the dataset-status line, and tags. Prose
(descriptions, tagline), headings, the wordmark and control labels stay sans.
The app is **not** monospaced.

- `--font-mono: 'JetBrains Mono Variable', 'JetBrains Mono Fallback',
ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- Files: `apps/dashboard/public/fonts/jetbrains-mono-latin-wght-normal.woff2`,
  `…-latin-ext-wght-normal.woff2`, and the licence
  `JetBrainsMono-OFL.txt` — all served verbatim at `/<repo>/fonts/…`, so the
  licence travels with the fonts (OFL §2).
- `@font-face` lives in the external stylesheet; a metric-matched
  `JetBrains Mono Fallback` face + `font-display: swap` keep layout shift at
  zero, so no `<link rel=preload>` is needed.
- The URLs are root-absolute (`url('/fonts/…')`) so Vite rewrites them with the
  deployment base at build time, giving the runtime URL `<base>fonts/…`.
  `vite.config.ts` derives `base` from `GITHUB_REPOSITORY` — `/<repo>/` under
  GitHub Actions, `/` otherwise — so it resolves to `/starledger/fonts/…` for
  this repo's own Pages deploy, `/<fork-repo>/fonts/…` for a template fork, and
  `/fonts/…` at a domain root; `/starledger/` is not a universal path. An
  external font CDN would be blocked by the deploy CSP (`font-src 'self'`) and is
  never used.

## Borders, geometry, elevation (preserved)

- **Borders:** a single green-alpha `--border`, at a contrast at least equal to
  the prior neutral border (dark 1.58:1 vs 1.55:1; light 1.63:1 vs 1.45:1) so
  dense-card scannability is not reduced. (Portfolio's two-token subtle/strong
  system is consolidated to one for the denser UI.)
- **Radii preserved:** 6px controls, 8px containers, 999px pills, 3px on the
  `>_` mark. Not flattened — the geometry is StarLedger's own.
- **Elevation preserved:** StarLedger's restrained `rgb(... / 0.09–0.12)`
  card/toolbar shadows are unchanged.

## Focus & contrast requirements

- Normal text ≥ 4.5:1; non-text interaction/focus indicators ≥ 3:1.
- Keyboard focus is one global rule: `:focus-visible { outline: 2px solid
var(--focus); outline-offset: 2px }`. The 2px offset shows the surface behind
  the control, so the ring stays visible even on a **filled-emerald** button —
  the white-ring-on-emerald failure mode is avoided by never using white: filled
  controls take `--accent-contrast` (dark `#04120c` in dark mode, 11.2:1).
- Every pairing above is recomputed from the token values and asserted in
  `features/identity/brand-tokens.test.ts` (proven able to fail).

## `>_ StarLedger` identity & `← Portfolio` link

- The `>_` prompt glyph (`.brand-mark`, `--accent-muted`, mono, bordered box) +
  the `StarLedger` wordmark. Decorative mark (`aria-hidden`); the `<h1>` is the
  only accessible name. The favicon is the emerald `>_` on a dark tile.
- `← Portfolio` → `https://portfolio.secc.dev/` is **opt-in** via the build-time
  `VITE_PORTFOLIO_URL` variable (from the `PORTFOLIO_URL` Actions repo variable)
  so no portfolio URL ships in shipped `apps/**` source and the link never renders on
  template-derived forks. Neutral (muted), promoted
  to emerald on hover/focus.

## starledger-template parity

StarLedger is the **source of truth** for this visual contract.
`starledger-template` receives applicable changes through the canonical,
one-way regeneration process — `pnpm template:build --out <dir> --verify`, where
`<dir>` is a sibling destination outside the source checkout (add `--force` to
rewrite a non-empty one) — landed as a
`sync/starledger-<sha>` regeneration PR, never a hand-ported subset. The
template is **not** a runtime or shared-package dependency, so parity is
**release-cycle based**: the two repos stay independently versioned and each is
canonical for its own artifact, and any later change to this source requires a
later regeneration to reach the template.

`starledger-template` was regenerated from StarLedger through the canonical
builder for the beta.4 release, so the two are in parity as of that cycle.
These tokens stay template-buildable by construction — the font assets and the
OFL licence are inside the builder allowlist, nothing is hardcoded to a single
deployment base (see the font-path note above), and the Portfolio link is
opt-in — so a regeneration carries them without hand-porting.
