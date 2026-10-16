# ADR-005: Portfolio-family visual alignment + `>_` identity (WS4-SL)

- Status: Accepted
- Date: 2026-10-16
- Milestone: WS4-SL — visual alignment with the Portfolio product family

## Context

StarLedger ships as one member of the owner's product family. The sibling
Portfolio site (`portfolio.secc.dev`) has a recognisable, deliberately
restrained brand: a dark near-black / green-black surface family, a single
emerald interactive accent, a `>_` prompt identity, JetBrains Mono for
technical metadata, and a two-token green-alpha border language. StarLedger,
by contrast, inherited GitHub's Primer palette (blue `#0969da` accent,
`#0d1117`/`#161b22` dark surfaces) with a bespoke "Concept-B" ledger mark
(M3, see P7 §9 / §14). The two products did not read as family.

The goal is **family resemblance, not cloning**: inherit Portfolio's brand
language while preserving everything that makes StarLedger its own product —
its information architecture, data density, GitHub-stars semantics,
search/filter/sort behaviour, light **and** dark support, and its
functional/status colour encodings.

The reference brand tokens were verified against the Portfolio source, and
every proposed colour pairing was checked against WCAG 2.x by computation
before implementation (see `docs/brand-tokens.md`).

## Decision

Adopt a conservative Portfolio-family alignment:

- **Emerald accent** replaces GitHub blue — `#35e0a1` (dark) / `#0f7355`
  (light, darkened so link text clears 4.5:1 on white). Green-black surfaces
  in dark (`#080b0a` / `#111815` / `#16201c`, Portfolio's values); subtly
  green-tinted near-white surfaces in light. Green-alpha borders
  (`rgba(170,205,190,α)` dark / `rgba(20,110,75,α)` light) at a contrast at
  least equal to the prior neutral borders.
- **Emerald is semantic, not decorative.** Bright `--accent` is reserved for
  interactive affordances (links, hover/focus, active/selected, filled
  buttons, the focus ring). Passive brand/provenance/category/status markers
  use the new `--accent-muted` token. This also resolves a latent collision:
  the "Candidate" discovery badge (was `--accent`) now sits beside the
  green "Promoted" badge without the two reading as the same colour.
- **JetBrains Mono** (self-hosted, SIL OFL-1.1) for technical roles only —
  repository identifiers, metrics, counts, metadata and tags. Prose,
  headings and control labels stay in the system sans. The app is **not**
  monospaced.
- **`>_ StarLedger` identity** — the Concept-B ledger SVG mark is replaced by
  a decorative `>_` prompt glyph (`.brand-mark`, muted emerald, mono), and
  the favicon is redrawn as the emerald `>_` on a dark tile. This
  **supersedes** the M3 identity contract (P7 §9 "Concept B accepted";
  §14 ruling F-1 "favicon accent is the static `#0969da`"). The
  owner-ratified M3-ID-1/2/3 tests and the favicon-wiring grammar/colour
  tests were rewritten deliberately to the new contract.
- **`← Portfolio` return link** connects the family. It is **opt-in** via the
  build-time `VITE_PORTFOLIO_URL` variable (fed from the `PORTFOLIO_URL`
  Actions repo variable in `pages.yml`), never hardcoded in product source — so
  the rendered return link never appears on template-derived forks and no portfolio
  URL ships in shipped `apps/**` source. (The URL does appear as a reference in
  these `docs/`, which the template copies like its other maintainer references.) The link is neutral (muted, promoted to emerald on hover/focus).

## What this does NOT change

- Information architecture, the Starred / Insights / Discovery view model,
  and the sticky view-tabs contract.
- Search / filter / sort / grouping semantics, URL state, and provenance.
- Data density and the card / table / list geometry (6px/8px radii, pills).
- Light **and** dark adaptivity (`prefers-color-scheme`) — removing a mode
  would be an unargued accessibility regression.
- Functional/status colours: `--caution` (amber), the Promoted-success
  green, the de-emphasised neutral "Dismissed" badge, and the
  unavailable-vs-absent (`.unknown` / `.none`) distinction are preserved.
- The deploy CSP (`font-src 'self'` etc.) — fonts are self-hosted, same-origin.

## Consequences

- The M3 identity (P7 §9 / §14) is historical for the mark and favicon; this
  ADR is the current identity contract. The rewritten tests encode it.
- To show `← Portfolio` on the live owner deployment, the owner must create
  the `PORTFOLIO_URL` repo variable (`= https://portfolio.secc.dev/`). Absent
  the variable the link simply does not render; nothing breaks.
- `starledger-template` lags the parent (it is regenerated manually); a
  `sync/starledger-<sha>` regeneration PR carries these changes to the
  template later. Template parity is RECOMMENDED, not required, and is a
  follow-up — this change is kept template-buildable (`template:build
--verify`) but the template is not mutated here.

## Residual risks

- The light-mode emerald is darker than Portfolio's (which has no light mode);
  the two modes are the same hue family, not the same value.
- Native `<select>` / scrollbar chrome still follow the OS theme (unchanged);
  only checkbox/radio ticks were bound to the accent via `accent-color`.
