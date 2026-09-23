# ADR-004: Discovery sources are untrusted producers behind the trusted resolver (P6)

- Status: Proposed (design-only; pending the #34 trust-boundary review before P6.1 implementation)
- Date: 2026-07-20
- Milestone: P6 — discovery sources

## Context

P5 shipped the Discovery Inbox: a trusted, deterministic pipeline
(`packages/discovery`) that turns owner-supplied `owner/repo` references into
reviewed candidate artifacts via GitHub resolution, `node_id` dedupe against
`stars.json`, human decisions, deterministic serialization + `dataset_sha`, a
`verify` gate, and a `workflow_dispatch` PR that never pushes `main`. Its only
input source today is a hand-edited `config/discovery-inbox.yaml`
(`kind: 'manual'`). `SourceKindSchema` reserves `future-telegram | future-youtube |
future-web` but no code emits them.

P6 adds the first _automated_ source — a Web/RSS watcher — that ingests
**untrusted external content** (feed documents authored by third parties).
Introducing automated ingestion into a system whose whole safety story is "no
central custody, human-review-first" (#34) forces an explicit decision about where
the trust boundary sits — otherwise a later contributor will "helpfully" let a
watcher resolve repos, write artifacts, or open its own PR, and quietly dissolve
the boundary.

## Threat covered

Untrusted feed content reaching `main` or the dashboard as if it were
owner-curated data: via a source that resolves / writes / dedupes / publishes on
its own; via SSRF (a watcher following arbitrary links from feed items); via
unbounded or malicious payloads; or via injection text being executed rather than
treated as inert data.

## Decision

1. **A discovery source is a _producer of provenance-tagged `owner/repo`
   references_, nothing more.** It fetches its configured inputs, extracts
   `github.com/<owner>/<repo>` references (through the existing
   `normalizeGithubUrl`), and tags each with a `DiscoverySource`. It does **not**
   call the GitHub resolver, dedupe against `stars.json`, write
   `discovery-candidates*.json` / `discovery-decisions.yaml`, or open the PR. Those
   stay the trusted core's job. This is enforced **structurally** by **three separate
   GitHub Actions jobs** (not steps — steps share a workspace and secrets): fetch/parse
   with `permissions: {}`, `persist-credentials: false`, and no secrets, emitting only a
   size-bounded strict-schema intermediate artifact; resolve with only the read-only
   `STAR_SYNC_TOKEN`, from a clean checkout, **independently re-validating** that
   intermediate (schema + caps + re-normalization) and not running the parser package;
   publish with repo-write only after `verify`, consuming only the verified pair + bounded
   enumerated reason codes. A compromised parser or dependency reaches no token and cannot
   smuggle unnormalized refs past the caps. Convention alone is not the boundary.
2. **The boundary:** untrusted source → extract/normalize (no side effects) →
   trusted resolver → PR → human review → merge. Nothing a source emits reaches
   `main` / the dashboard except a `DiscoveryCandidate` that resolved to a real
   public repo via the owner's read-only token, is not already starred, and a
   human approved in a PR.
3. **No new secret, no central custody.** Public feeds are fetched with no
   credential; repo resolution reuses the existing repo-owned read-only
   `STAR_SYNC_TOKEN`. (#34 invariants preserved.)
4. **No arbitrary egress.** A watcher fetches only the exact `https` feed URLs
   pinned in owner-controlled config, with **redirects disabled** and the
   **connected IP** — not just a pre-flight DNS lookup — validated against all
   non-globally-routable ranges (defeats DNS rebinding); it never follows links
   found inside items. Feed XML is parsed with external entities/DTD/XInclude and
   parser network/file I/O **disabled** (no XXE) and entity expansion bounded.
5. **Bounded input, fail-soft per feed, fail-closed on config.** Every untrusted
   dimension has a hard ceiling (feed count, wire + decoded bytes, items, depth,
   extracted URLs, candidates, string lengths). Config-parse fail-closed rejects
   non-`https` URLs, **userinfo** in a URL, and private IP-literal hosts; a
   bad/oversized/slow feed, or a host that resolves private **at connect time**, is
   quarantined per-feed (surfaced, not silent) without aborting the run. Overflow is
   decided: retained still-`candidate` repos are admitted first and never displaced; new
   refs fill remaining capacity in a deterministic pre-resolve order; if the retained set
   alone exceeds the ceiling the run fails closed — never silent truncation.
6. **Source ordering is Web/RSS → YouTube → Telegram**, by ascending trust surface
   and descending ease of deterministic fixtures. Web/RSS first: a feed is a static
   document (byte-stable local fixtures, no secret to fetch, smallest attack
   surface). Telegram last (bot-token custody, private-group identity,
   edit/delete/privacy). The Telegram _command-bot_ shape stays a hard non-goal.
7. **Schema migration is additive, and decided here (not deferred).** Add `web` to
   `SourceKindSchema`; keep `future-web` as a **deprecated, never-emitted** member so
   existing artifacts still validate; **no `DISCOVERY_SCHEMA_VERSION` bump**.
   `future-web` becomes invalid only in a future major schema-version change, if ever.
   The sweep covers every call site plus the generated JSON schema.
8. **Automated sources retain candidates; a run aggregates, it does not replace.**
   Feeds are ephemeral, so an artifact-generating run unions manual entries + newly
   extracted web references + retained still-`candidate` web repos from the previous
   artifact. A **web-sourced** candidate leaves the inbox only by a human decision, by being
   starred, or by an authoritative private/disabled/deleted resolution — never because it aged
   out of a feed; a **manual-only** candidate additionally leaves when its entry is removed from
   `discovery-inbox.yaml`. A quarantined feed keeps its prior web candidates.
   Provenance is stable (`observed_at` first-seen-and-reused; `sources[]` canonically
   ordered and deduped) so an unchanged run is byte-identical and does not spam the PR
   gate. Resolved candidates pass an explicit `private === false` gate before serialization.
   The previous artifact is **schema/sha/count-validated** before it is trusted as input (a
   corrupt or half pair aborts). **Every** artifact writer — including the redefined manual
   `discovery-inbox.yml` — applies this union, so a manual run cannot regenerate-from-config
   and drop web candidates; a retained legacy `future-web` source is carried forward verbatim.
   The retention rule's only system exception is an **authoritative** resolver result
   (private/disabled/deleted); a **transient** resolver failure aborts publication rather than
   dropping a retained candidate. Publication is base-SHA guarded with a single open PR.

## What this does NOT change

- No change to the P5 resolve/dedupe/decisions/serialize/`verify` **semantics** or the
  PR-gated, never-push-`main` posture. P6 _does_ add **authorized additive extensions** to
  the shared core (resolver timeout/concurrency/budget, the `private === false` gate,
  `sources[]` merge/order, the aggregation input model), a new `discovery-web.yml`, and an
  update to the manual workflow so it aggregates too — these extend the trusted core; a
  source never runs any of it. "Unchanged" is about semantics, not "zero new trusted code."
- No auto-star, no AI star decisions, no direct-to-`main` writes, no always-on
  server, no central backend/key.
- `DiscoveryCandidate` shape is unchanged; only a candidate's `sources[].kind`
  gains `'web'`.

## Residual risks / update procedure

- **`verify` is not forgery-proof** — like P5, it hashes the artifact against its
  own meta, catching accidental/hand edits but not a self-consistent forged pair.
  The PR review remains the real trust gate; automated ingestion raises the value
  of that review, so P6 must not weaken it (no auto-merge of watcher PRs).
- **Feed output is non-deterministic across time** (feeds change); determinism is
  _per-run given the fetched bytes_, and cross-run no-churn relies on the retention +
  provenance-stability rules in decision 8 (first-seen `observed_at`, canonical
  `sources[]`). A fixture feed source is required so the watcher is testable offline
  and byte-stable.
- **Adding a later source:** the Web/RSS decisions here are the template, but a
  **credential-bearing** source (a Telegram bot token, an authenticated API) is NOT
  covered by decision 3 ("no new secret") and requires an **ADR-004 amendment**
  establishing repo-owned — never central — custody for that credential, plus a fresh
  #34 review, before design. Only another non-credentialed public source inherits
  decisions 1–8 unchanged.
- **P6 is stateless.** The only cross-run memory is the previous published artifact; any
  persisted per-feed cursor/etag or operational-state branch is a separate write-capable
  stage that contradicts the non-goals and would need its own ADR amendment + #34 review.
