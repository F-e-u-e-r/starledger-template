# P6 — Discovery Sources (automated candidate intake)

## Status

| Sub-phase | What                                                         | Status        |
| --------- | ------------------------------------------------------------ | ------------- |
| P6.0      | Spec / ADR (this document + `docs/adr/ADR-004-*.md`)         | this document |
| P6.1      | `web` source kind + watcher config schema + fixture source   | planned       |
| P6.2      | Hardened feed fetch (timeout, redirect/IP policy, size caps) | planned       |
| P6.3      | XXE-safe parse + GitHub-URL extraction + quarantine          | planned       |
| P6.4      | Aggregate + wire into the (additively hardened) resolve core | planned       |
| P6.5      | Privilege-staged `workflow_dispatch` workflow (PR-gated)     | planned       |
| P6.6      | Hosted validation                                            | planned       |

**This document is design-only.** No P6 code ships with it. Implementation (P6.1+)
does not begin until this spec and `ADR-004` are reviewed together with the
trust-boundary review in **#34**, per the owner's instruction. The controls below are
written as **enforceable contracts** (a competent PR C implementer can build to them),
not aspirations.

## Goal

P5 built the Discovery **Inbox** — a trusted, deterministic place to hold candidate
repositories for review. But the inbox is fed by exactly one source: a manual
`config/discovery-inbox.yaml`. P6 adds the first **automated source** that feeds
that same inbox, so candidates arrive without hand-editing YAML — while preserving
every P5 invariant: deterministic output, repo-owned, PR-gated, **fail-soft in the
dashboard but fail-closed on config and corrupt canonical data**, no central key
custody, human-review-first.

P6 answers: _"what repos are showing up in the sources I follow that I haven't
starred yet?"_ — without an always-on server, a central backend, or letting any
automated source touch my GitHub account.

## Relationship to P5 (reused core + authorized additive extensions)

The P5 pipeline already does the trusted, hard part. From `packages/discovery`:

- **Resolution** — `resolve.ts` turns an `owner/repo` into a hydrated
  `DiscoveryCandidate` via the GitHub API (repo-owned `STAR_SYNC_TOKEN`, read-only).
- **Dedupe** — by `node_id`, both intra-run and against `stars.json` (already-starred
  repos are excluded); fail-closed if `stars.json` is present-but-corrupt.
- **Decisions** — human-owned `config/discovery-decisions.yaml` (`dismissed`/`promoted`),
  never generated.
- **Serialization** — deterministic sort by `node_id`, 2-space JSON + trailing newline,
  `dataset_sha` over the exact bytes; previous-artifact timestamp reuse so an unchanged
  set produces zero byte churn.
- **`verify`** — schema + sha + count integrity gate.
- **Workflow** — `workflow_dispatch`, opens a `discovery/inbox-<ts>` PR, never pushes `main`.

**A P6 source never runs those stages.** A source is a _producer of
`DiscoverySource`-tagged `owner/repo` references_ handed to the trusted core; it never
resolves repos, writes artifacts, dedupes against stars, or opens the PR.

**P6 does add authorized _additive_ extensions to the shared `packages/discovery` core**,
used by BOTH the manual and web orchestrators (so "the resolver is unchanged" is not a
loophole an implementer can hide behind):

- resolver **per-request timeout + concurrency limit + per-run resolve budget** (C5) — the
  P5 resolver has none today;
- the explicit **`private === false` gate** (C7);
- **`sources[]` merge/canonical-order** (Provenance stability);
- the **aggregation / retention input model** (Aggregation).

"Unchanged" therefore means the resolve/dedupe/decisions/serialize/`verify` **semantics** and
the PR-gated, never-push-`main` posture — **not** "zero new trusted code." These extensions
live in the trusted core, never in a source.

## Relationship to the notifier (P2)

The P2 notifier already polls YouTube / awesome-stars and turns hits into one-shot Telegram
messages; it has its own `SourceKindSchema` (`youtube`, `awesome_stars`) and does **not** feed
discovery today. P6 sources are a **different consumer** of (potentially overlapping) upstreams:
the notifier produces _notifications_, P6 produces _discovery candidates_ for review. P6.1 ships a
standalone Web/RSS adapter rather than coupling to the notifier. The `notifier` value reserved in
the discovery `SourceKindSchema` is a placeholder for a future bridge (notifier hits → discovery
candidates) and is out of P6 scope.

## Source roadmap and ordering (rationale)

P6 ships **one** source first. Ordering is deliberate and load-bearing:

1. **Web/RSS watcher (P6, this spec).** Chosen first because it is the easiest to make
   deterministic (a feed is a static document — a local fixture file gives byte-stable
   tests with no network), needs the lowest permission/token footprint (public feeds
   need no secret to fetch), and has the smallest trust surface.
2. **YouTube watcher (future phase).** Middle complexity: API quota, channel identity,
   and Shorts/live/duplicate-video rules must be defined before it is deterministic.
3. **Telegram watcher (future phase, last).** Highest complexity and trust surface:
   bot-token custody, private-group identity, message edit/delete semantics, and privacy
   edges. A credential-bearing source requires an `ADR-004` amendment (repo-owned, not
   central, custody) before design — see the ADR. Deferred until the Web/RSS pattern has
   proven the untrusted-source → trusted-core contract in production.

The `command-bot` shape (Telegram commands that _act_) remains a hard non-goal (below).

## Non-goals (unchanged from P5; restated because P6 makes them tempting)

- Auto-star, auto-dismiss, or AI deciding what to star.
- A source writing `discovery-candidates.json` / `-meta.json` or `discovery-decisions.yaml`
  directly.
- A source pushing to `main`, merging its own PR, or updating a state branch directly.
- **Any P6 operational state branch / persisted cursor.** P6 is **stateless**: the previous
  published artifact is the only cross-run memory. A per-feed cursor/etag state branch would
  add a write-capable stage and contradict the line above; it needs a separate ADR + #34
  review if ever wanted.
- An always-on server, central backend, shared service key, or central OAuth app.
- Following arbitrary links found inside feed content, or fetching item pages (SSRF surface).
- A Telegram command bot, NotebookLM ingestion, or a browser extension.

## Trust model (integrates #34)

A discovery source ingests **untrusted external content**. The security posture treats
every byte a source reads as hostile and confines it behind the same boundary #34
defends ("no central key custody / template safety model").

**The boundary.** Untrusted source → (fetch + parse + extract + normalize, **no secrets,
no side effects**) → **trusted resolver** (read-only token) → **verify + serialize** →
**PR** → **human review** → merge. Nothing an untrusted source emits reaches `main` or the
dashboard except a `DiscoveryCandidate` that (a) resolved to a real **public** repo via the
owner's read-only token, (b) is not already starred, and (c) a human approved in a PR.

### C1 — Capability boundary is enforced by separate jobs, not by assertion

The claim "a source never has write/resolve/PR power" must be **structurally true**. Capability
by stage:

| Stage           | Has                                                                                   | Must NOT have                                        |
| --------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **fetch/parse** | egress only to the pinned feed hosts (enforced in fetch code, C2 — not by the runner) | any GitHub token, any repo-write/PR token, git creds |
| **resolve**     | the read-only `STAR_SYNC_TOKEN`                                                       | repo-write / PR token                                |
| **publish**     | repo-write + PR capability — used **only after** `verify` passes                      | the raw untrusted feed bytes                         |

These are **three separate GitHub Actions jobs** — not steps in one job. Steps share a
workspace, a process tree, `$GITHUB_ENV`/`$GITHUB_PATH`, and the job's secrets, so they are not
a boundary. Concretely:

- The **fetch/parse job** runs with `persist-credentials: false`, an empty `permissions:` block,
  and **no secrets** in its environment. Its only output is a **fixed-name, size-bounded,
  strict-schema data artifact** carrying **untrusted source/provenance _assertions_** — normalized
  `owner/repo` refs + _claimed_ provenance, never raw feed bytes — handed to the next job through
  the Actions artifact store. Nothing in it is authoritative; it is a hint the resolve job must
  re-derive (below).
- The **resolve job** starts from a **clean checkout of the trusted workflow SHA**, holds only
  the read-only `STAR_SYNC_TOKEN`, and does **not** install or run the watcher/parser package or
  its lifecycle scripts. It **independently re-validates** the intermediate artifact — schema,
  every C4 ceiling, that each ref re-normalizes through `normalizeGithubUrl`, and that each
  source's `source_id`/`source_url` match the trusted checked-out feed config — and it is the
  **only** stage that mints/reuses `observed_at` and produces the provenance that may enter the
  canonical artifact. The producer's claimed provenance is an untrusted hint, never authoritative.
- The **publish job** consumes only the verified artifact pair plus a **sanitized summary built
  from bounded, enumerated quarantine reason codes** (never attacker-controlled exception text),
  and only it holds `contents: write` + `pull-requests: write`.

Network confinement is an **application-level** control (C2), not something the stock runner
enforces. The job split removes the _credentials_ a compromised parser could otherwise reach;
the resolve job's re-validation removes its ability to smuggle unnormalized refs or over-cap
volumes past the trusted stage.

### C2 — No arbitrary egress (SSRF containment, redirects + rebinding + userinfo)

- Fetch **only** the exact feed URLs pinned in owner-controlled config; **never** follow links
  found inside feed items and never fetch item pages.
- **Config-parse rejections (fail-closed):** non-`https` URLs, URLs with **userinfo**
  (`https://user:pass@host/…` — a credential-bearing feed URL would violate C1's "no secrets"
  and could serialize into `source_url`), and syntactically private/loopback **IP-literal**
  hosts.
- **Redirects: disabled** (`redirect: 'error'` / max-redirects 0). If a later revision must
  allow them, it MUST re-validate scheme + connected IP on **every** hop.
- **Validate the connected IP, not just a pre-flight DNS lookup** (defeats DNS rebinding): block
  every non-globally-routable range — RFC1918, CGNAT `100.64.0.0/10`, loopback, link-local
  (incl. `169.254.0.0/16`), unique-local IPv6, and IPv4-mapped/compat IPv6 forms (prefer a
  maintained public-IP predicate over a hand-rolled list). A disallowed **connected peer** at
  runtime is a per-feed **quarantine** (it may be transient rebinding), not a config error.
- **No egress proxy** for feed fetch — a proxy would make the connect-time check validate the
  proxy socket, not the origin; if a deployment needs one it must enforce the same
  origin-address policy.
- Extraction is only `github.com/<owner>/<repo>` references, run through the existing
  `normalizeGithubUrl` (rejects non-GitHub hosts, reserved owners, malformed paths).

### C3 — XML/feed parse is non-networked and entity-safe

RSS/Atom is XML; the parser is an untrusted-input surface of its own:

- **External entities, external DTDs, XInclude, and any parser-initiated network/file I/O
  are disabled** (closes XXE → local-file / internal-HTTP egress).
- **Entity expansion is bounded** (no billion-laughs); expansion is capped _before_ it can
  exceed the byte budget. Structural nesting/depth is bounded too.
- Byte caps apply to **decompressed** bytes (a gzip bomb is caught during streamed decode,
  not after). The parser dependency (or a hand-rolled parser) MUST have these off by
  construction; the choice is constrained by this contract, not left open.

### C4 — Bounded input; the overflow direction is decided here

Every untrusted dimension has a **hard maximum** (not merely a default): feed count, per-feed
**compressed (wire) and decompressed** bytes, HTTP response-header size, per-feed item count,
XML nesting depth, extracted URLs per item, total candidates per run, `sources[]` entries per
candidate, and every string length (`raw_ref`, `source_id`, feed URL / `source_url`). Exceeding a
**per-feed** bound quarantines that feed (§Quarantine).

The **admission / overflow rule is decided here**, not deferred:

1. **Retained still-`candidate` repos are admitted first and are never displaced by overflow.**
2. New refs then fill the remaining capacity in a **deterministic pre-resolve total order** (by
   normalized `owner/repo`).
3. If the **retained set alone** exceeds the global candidate ceiling, the run **fails closed** —
   a ceiling that small is a misconfiguration, not a licence to silently evict pending
   candidates.

The same deterministic pre-resolve order governs the C5 resolve budget, so _which_ refs are
resolved is never fetch-order-dependent. Any cap that binds (candidate cap, `sources[]`, items)
is **surfaced in the PR summary** — never a silent truncation.

Overflow direction per ceiling (the _direction_ is decided here; numeric values deferred to PR C):

| Ceiling                                                 | Over-limit direction                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| non-`https` / userinfo / private-IP-literal feed URL    | config **fail-closed**                                                                                                        |
| feed count                                              | config **fail-closed**                                                                                                        |
| per-feed wire/decompressed bytes, item count, XML depth | **per-feed quarantine**                                                                                                       |
| extracted URLs per item                                 | deterministic truncate + fixed reason code                                                                                    |
| `source_id` string length                               | **config fail-closed** (never truncate — it is identity)                                                                      |
| feed URL / `source_url` string length                   | **config fail-closed** (never truncate — identity/provenance)                                                                 |
| `raw_ref` string length                                 | **per-item quarantine/reject** (never truncate — it is provenance)                                                            |
| `sources[]` per candidate                               | first-seen sources first (incl. legacy `future-web`); new in canonical order; **retained-source overflow fails closed** (AC1) |
| total candidates per run                                | retained-first deterministic admit-and-surface; **retained-alone-over-ceiling fails closed**                                  |
| intermediate cross-job artifact size                    | **fail-closed** (reject the artifact)                                                                                         |

**Cap-consistency invariant.** The maximum legal output of the upstream field / `sources[]` / candidate caps must be compatible with the expanded cross-job-artifact cap, the resolve budget, and the total-run wall-clock. Where they are not, the **outer** cap (artifact size / budget / wall-clock) is the earlier **fail-closed** ceiling with a fixed reason code — never a silent truncation. An implementer must not assume every per-field maximum can hold simultaneously.

### C5 — Resolver amplification is bounded, with defined failure outcomes

Normalizing a reference does **not** make it trusted; a hostile feed can emit thousands of
valid-looking references and drive the resolver (no per-request timeout today) into quota
exhaustion or a hang. The resolve stage therefore gets, as an authorized additive extension of
the shared core:

- a **per-request deadline**, a **concurrency limit**, and a **per-run resolve budget** counting
  **logical repositories** (not HTTP attempts), applied in the C4 deterministic order;
- **transient failure is fail-closed for the run, never silent deletion.** A timeout, 5xx,
  429-after-retry-exhaustion, network error, or budget/total-run-budget exhaustion means the run
  has **incomplete trusted resolution** → it **aborts publication** (opens no PR) rather than
  treating an unresolved retained repo as "absent" and dropping it. Only an **authoritative**
  result — `private`/`disabled`/404-deleted — removes a candidate, and that is the sole exception
  to the retention rule "a candidate leaves only by a human decision or by being starred."

### C6 — `raw_ref` is bounded and inert, not merely "display-only"

`raw_ref` (a feed item's link/guid) is attacker-controlled and can carry HTML, dangerous URL
schemes, Markdown, control characters, or bulk content. Therefore:

- It is **length-capped** and **control-characters-stripped** at extraction, stored as plain
  text.
- Downstream rendering is **contextually escaped**: never emitted as raw HTML; in logs and PR
  text, control characters are neutralized; if ever made clickable, only through an explicit
  `https`/`http` scheme allowlist. **Human review is not an XSS mitigation** — the escaping is
  the mitigation. The same rule binds any quarantine/error string that crosses into the publish
  job (see C1's enumerated reason codes).
- **GitHub write templates are trusted-only.** A PR title / body / comment, and any commit message
  the publish job writes, are composed **only** of trusted static templates, normalized
  `owner/repo`, trusted-side-derived provenance, fixed enumerated reason codes, and bounded numeric
  fields. They **never** include or quote a feed title, description, HTML, free text, a
  producer-supplied message, or any other raw feed bytes — the GitHub write action must not become
  an amplifier for untrusted feed text. (The dashboard may still display sourced info; this rule
  governs the `main`-facing write surface.)

### C7 — Public-only resolution is an explicit, tested gate

Before serialization, each resolved candidate MUST satisfy `private === false` and not be
`disabled` (the GitHub repository `disabled` flag) — an explicit gate with its own test, not an
assumption about resolver internals. A reference that resolves to a private/inaccessible repo is
dropped, never serialized, so a token that happens to have private visibility cannot leak
private repo metadata into the public artifact or PR.

### C8 — Injection is inert; output is deterministic and auditable

Extracted text is data — never executed or interpolated into a command. The trusted
serializer makes the artifact byte-deterministic and hash-verified; `verify` gates it and the PR
diff is the human audit surface. Honest caveat (as in P5): `verify` catches accidental/hand
edits, not a self-consistent forgery — **the PR review remains the real trust gate**, so P6 must
never auto-merge a watcher PR.

## Data model

### `web` source kind (decision, not deferred)

Add a real `web` member to `SourceKindSchema` (`packages/discovery/src/schemas.ts`). The
migration is **decided in `ADR-004`** (additive; `future-web` becomes a deprecated,
never-emitted enum member kept valid so existing artifacts still parse; no
`DISCOVERY_SCHEMA_VERSION` bump). The sweep covers every call site plus the generated
`schemas/discovery-candidates.schema.json`. `DiscoverySource` is otherwise unchanged:

```ts
type DiscoverySource = {
  kind: 'web'; // new; 'future-web' is deprecated (never emitted, still valid to read)
  source_id: string; // stable per-feed id, "web:<feed-id>" from config
  source_url?: string; // the feed URL (https, no userinfo, from config)
  observed_at: string; // FIRST-seen time for this (kind, source_id, repo); reused across runs
  raw_ref?: string; // first-seen item link/guid; bounded + sanitized (C6)
};
```

`DiscoveryCandidate` is unchanged; a web-sourced candidate differs only in `sources[].kind`. A
**legacy `future-web` source retained from a prior artifact is carried forward verbatim** (not
translated to `web`, not dropped), preserving its first-seen provenance; only newly produced
sources use `web`.

### Provenance stability (makes AC9 real)

The zero-churn guarantee requires provenance fields to be **stable across runs**, not minted
each run:

- **`observed_at` is first-seen and reused.** On each run, for a `(kind, source_id, repo)`
  already present in the previous artifact, `observed_at` is carried over verbatim; only a
  genuinely new pairing mints a fresh timestamp. (This mirrors P5's existing per-source
  `observed_at` reuse.)
- **`sources[]` has a canonical order and dedup.** Within a candidate, `sources[]` is sorted
  deterministically (by `kind`, then `source_id`) and de-duplicated by `(kind, source_id)`;
  multiple feed items from one feed pointing at the same repo collapse to one source whose
  `raw_ref` is the **first-seen** item ref by a defined precedence (guid if present, else
  link). Order is therefore independent of feed-fetch completion order.

Result: re-observing the same repos produces byte-identical artifacts, so the human PR gate is
not spammed with churn. (As in P5, "unchanged" is about provenance stability; genuinely mutable
GitHub metadata that P5 already re-serializes is out of scope for this guarantee.)

### Watcher input config (new, owner-owned)

A new repo-owned config, separate from `discovery-inbox.yaml` (which stays manual-only):

```
config/discovery-web.yaml            # active, owner-owned, committed so the workflow can read it
config/discovery-web.example.yaml    # ships in template, feeds: []
```

```yaml
feeds:
  - id: hn-frontpage # stable source_id suffix; must be unique
    url: https://hnrss.org/frontpage # https only, no userinfo; owner-chosen
    max_items: 50 # per-feed item cap (≤ the hard ceiling, C4)
```

Parsed with a `.strict()` zod schema (unknown keys throw — fail-closed, matching
`DiscoveryInboxConfigSchema`). `feeds` defaults to `[]` (absent config ⇒ nothing to do,
exit 0). Per-feed knobs are clamped to the hard ceilings in C4.

**Feed identity is stable (decided).** A feed `id` is permanent and is the sole basis of
`source_id`. The same `id` must **not** change its `url`; changing a feed's origin requires a
**new `id`**. An `id` whose `url` differs from what a prior artifact recorded for that `source_id`
**fails closed** at config re-validation — so provenance can never silently re-point a source to a
different origin.

## Watcher pipeline (P6 stages, feeding the trusted core)

```
config/discovery-web.yaml                                          [fetch/parse JOB — no secrets]
  → parse + validate (fail-closed: https-only, no userinfo, no private IP-literal)
  → for each feed (per-feed fail-soft):
       fetch (https, no-redirect, connect-time IP check, no proxy,  [P6.2]
              timeout, backoff, wire+decompressed byte caps)
       parse RSS/Atom (XXE-safe, entity/depth-bounded, item cap)    [P6.3]
       extract github.com repo URLs; normalizeGithubUrl (REUSED)    [P6.3]
       tag each with a DiscoverySource{ kind:'web', ... }
  → emit a fixed-name, size-bounded, strict-schema intermediate artifact (normalized refs + provenance)
                                                                     [resolve JOB — read-only token, clean checkout]
  → re-validate intermediate (schema + C4 ceilings + re-normalize)
  → AGGREGATE: manual entries + new-web refs + retained prior-web candidates (see Aggregation)
  → resolve (deadline/budget, C5) → public-only gate (C7) → node_id dedupe vs stars.json
       → apply decisions → deterministic serialize + sha → verify
                                                                     [publish JOB — write AFTER verify]
  → if the verified artifact differs from main: open/update the single discovery PR (never push main)
  → if no diff (e.g. only quarantines): open no PR; write a durable check/run summary
```

The fetch/parse column and the aggregate/re-validate step are new; resolve → dedupe → decisions
→ serialize → `verify` are the trusted core (P5 semantics + the C5/C7 additive extensions).

## Aggregation, retention, and concurrency

Untrusted feeds are **ephemeral** — a repo surfaced today may age out of the feed tomorrow,
before the owner reviews it. A naive "regenerate from the current feed" run would silently
delete not-yet-reviewed candidates. P6 defines the union explicitly, and binds it to **every**
writer of the artifact:

- **Validated prior artifact is canonical input.** Before use, the previous
  `discovery-candidates.json` + `-meta.json` pair is loaded through the same
  schema + `dataset_sha` + count validation as `verify`; a corrupt pair, a missing half, or
  invalid provenance **aborts the run** (never silently treated as empty). Both files absent is
  allowed only as first-run bootstrap.
- **Every artifact writer aggregates — including the manual workflow.** Any job that writes
  `discovery-candidates*` composes: (a) the **current** manual entries from `discovery-inbox.yaml`,
  re-emitted every run (manual config stays authoritative for its own entries), (b) newly extracted
  web references this run (empty for a manual-only run), and (c) **retained prior candidates that
  carry a `web` or legacy `future-web` source and are still `status: candidate`** — web sources are
  ephemeral, so these are sticky. The existing `discovery-inbox.yml` manual workflow is
  **redefined** to apply this same union (re-emit manual config + retain web candidates + zero
  new-web), so a manual run can no longer regenerate-from-config and drop web candidates. The set is
  unioned by `node_id`; `sources[]` merges per the stability rules.
- **Retention scope (single source of truth).** A **web-sourced** candidate leaves the inbox only
  by a human decision (`discovery-decisions.yaml`), by becoming starred (excluded via `stars.json`
  dedupe), or by C5's authoritative private/disabled/deleted resolution — never merely because it
  dropped out of a feed. A **manual-only** candidate additionally leaves when the owner removes its
  entry from `discovery-inbox.yaml` (manual config is authoritative for its own entries). The
  pipeline diagram, AC8, and ADR decision 8 all state this same web-only retention rule.
- **A quarantined feed does not drop its prior candidates** — its previously-contributed,
  still-`candidate` repos are retained from the validated last-known-good artifact.
- **Concurrency + stale-PR safety.** All writers share one Actions `concurrency` group
  (`cancel-in-progress: false`). Because that serializes execution but not human merge order,
  publication is guarded by the **base `main` commit SHA** — not just the artifact hash; the full
  commit identifies every trusted input (the artifact, `stars.json`, decisions, config): a run
  records the base SHA it built on and aborts (forcing a fresh resolve) if `main` moved. There is
  **at most one open discovery PR**; while it is open, a second writer run must not silently drop
  its still-pending candidates — the safe design is to either treat the open PR's validated pair as
  additional retained input or refuse further writer runs until it merges/closes (exact mechanism
  in Known refinements → PR C). The redefined manual writer obeys the same guard.
- **Incomplete-source visibility.** Quarantines and any bound that fired are recorded and
  **surfaced in the PR body / check summary** (not only CLI logs). When a run produces no artifact
  diff (e.g. only quarantines), it opens no PR but still writes a **durable check/run summary**, so
  incomplete-source status is never invisible.

## Fetch resilience (P6.2 — the gap P5's resolver does not cover)

Feed fetching pulls arbitrary public HTTP and must be strict:

- **Per-request timeout** via `AbortSignal` (default e.g. 10 s, config-overridable, clamped to a
  hard max). A hung feed never hangs the run.
- **Bounded retry with backoff** on transient failures (network error, 5xx, 429). Require the
  _semantics_ — bounded attempts + a capped total wait (`maxAttempts`/`maxTotalWaitMs`-style).
  Reuse the repo's `RetryCoordinator` backoff/total-wait engine **if** it cleanly accepts a
  generic-HTTP error classifier (its built-in classifier is GitHub-API-specific); otherwise
  implement the same bounded semantics standalone. Non-transient (4xx except 429) → no retry,
  quarantine.
- **Wire + decompressed size caps** enforced during streamed read (byte counters on both the
  wire and decode sides, not after buffering).
- **Total-run wall-clock budget** across all feeds and all resolves, so N slow feeds/resolves
  cannot make a scheduled run run forever.

## Quarantine and failure taxonomy

| Condition                                              | Fail direction                 | Recorded as                         |
| ------------------------------------------------------ | ------------------------------ | ----------------------------------- |
| Malformed `discovery-web.yaml` / unknown keys          | **closed** (abort)             | CLI error, non-zero exit            |
| Feed URL non-`https` / userinfo / private IP-literal   | **closed** at config parse     | CLI error, non-zero exit            |
| Corrupt/half/invalid previous artifact                 | **closed** (abort)             | CLI error, non-zero exit            |
| Feed host resolves to a private IP at **connect** time | soft, per-feed (quarantine)    | quarantine reason code + PR/summary |
| Feed unreachable / times out / 5xx after retries       | soft, per-feed                 | quarantine reason code + PR/summary |
| Feed body exceeds wire/decompressed cap                | soft, per-feed                 | quarantine reason code + PR/summary |
| Feed not valid / not entity-safe RSS/Atom              | soft, per-feed                 | quarantine reason code + PR/summary |
| Candidate cap / `sources[]` / item cap binds (C4)      | deterministic admit + record   | surfaced in PR/summary              |
| Retained set alone exceeds global ceiling (C4)         | **closed** (abort)             | CLI error, non-zero exit            |
| Transient resolver failure / budget exhausted (C5)     | **closed** — abort publication | check/run summary, no PR            |
| Item link not a normalizable GitHub repo URL           | soft, per-item (drop)          | (expected; not an error)            |
| Resolved repo is `private`/`disabled` (C7)             | drop before serialize          | not serialized                      |

Quarantine is **surfaced, not silent**: a per-feed summary reaches the PR body / durable check
summary, and a healthy run still produces an artifact from healthy feeds + retained candidates. A
run where **every** configured feed quarantined exits non-zero (a fully-broken config must not
look like a green no-op).

## Workflow (P6.5)

A new `discovery-web.yml`, modeled on `discovery-inbox.yml`, but **three privilege-staged jobs**
(C1), each with an explicit `permissions:` block:

- `workflow_dispatch` first (a `schedule` may be added only after hosted validation, and even
  then it only ever opens a PR).
- **fetch/parse job** — `permissions: {}`, `persist-credentials: false`, no `STAR_SYNC_TOKEN` or
  PR token; runs the watcher fetch/parse/extract and uploads the strict-schema intermediate
  artifact (normalized refs + provenance). No repo data resolved yet.
- **resolve job** — clean checkout of the workflow SHA; `permissions: contents: read`; has only
  the read-only `STAR_SYNC_TOKEN`; downloads + re-validates the intermediate, aggregates
  (manual + new-web + retained, on the validated prior artifact), resolves → public-only gate →
  dedupe → decisions → serialize → `verify`. Does not run the watcher/parser package.
- **publish job** — `permissions: contents: write, pull-requests: write`; consumes only the
  verified artifact pair + the sanitized (enumerated-reason-code) summary; base-SHA guarded;
  creates or updates the single `discovery/inbox` PR with the quarantine summary in its body, or
  writes a durable check summary when there is no diff. **Never pushes `main`.** The human merges.

The existing manual `discovery-inbox.yml` is **updated** to apply the same aggregation/retention
and base-SHA guard (it need not be privilege-staged — it ingests no untrusted feed — but it must
not regenerate-from-config and drop retained web candidates).

## Template safety (#34)

For `starledger-template`, P6 ships:

- `config/discovery-web.example.yaml` with `feeds: []` (no real feeds, no personal data).
- `discovery-web.yml` as `workflow_dispatch`-only, no schedule.
- **No new feed secret.** Public feeds need no credential to fetch; end-to-end resolution still
  uses the user's own read-only `STAR_SYNC_TOKEN`, as in P5. Feed URLs live in a committed config
  and are copied verbatim into `source_url`, so they are **committed and therefore treated as
  public** — userinfo is rejected (C2), and the owner must not embed a secret (e.g. a query-string
  token) in a feed URL,
  exactly as they would not commit one anywhere else. No central endpoint is introduced.
- The watcher is an explicit opt-in, exactly like the notifier and AI layers.

## Acceptance criteria (for P6.1–P6.6, to be met by PR C onward — not by this spec)

1. `web` is added to `SourceKindSchema`; `future-web` is deprecated (never emitted, still valid
   to read) and old artifacts still validate; a retained legacy `future-web` source is carried
   forward verbatim; the sweep covers call sites + the generated JSON schema.
2. Feeds are declared in an owner-owned, `.strict()`-validated `config/discovery-web.yaml`
   (https-only, no userinfo, no private IP-literal hosts — fail-closed).
3. Feed fetching enforces no-redirect, **connect-time private-IP rejection**, no proxy, a
   per-request timeout, bounded retry, and wire+decompressed size caps.
4. Parsing is **XXE-safe** (no external entities/DTD/XInclude/parser I/O), entity- and
   depth-bounded; only `github.com` repo URLs are extracted; no in-item link is ever followed.
5. The workflow is **three separate jobs**: fetch/parse (`permissions: {}`, no secrets) →
   resolve (read-only token, clean checkout, re-validates the intermediate, does not run the
   parser package) → publish (write only, after `verify`); the cross-job handoff is a
   size-bounded strict-schema artifact and reason codes are bounded enumerations.
6. Every untrusted dimension has a hard ceiling; the C4 admission rule (retained-first, never
   displaced; new refs in deterministic pre-resolve order; retained-overflow fails closed) is
   implemented and any bound that fires is surfaced, never silent.
7. Resolution is bounded (deadline/concurrency/budget in the C4 order); a **transient** failure
   aborts publication rather than dropping retained candidates; a `private === false`/not-disabled
   gate drops private/disabled repos before serialization; already-starred repos are excluded by
   `node_id`.
8. **Every** artifact writer (web AND the redefined manual workflow) aggregates re-emitted manual
   config + new-web + retained prior **web** candidates over a schema/sha/count-**validated** prior
   artifact; a web candidate leaves only by decision / star / authoritative-resolve, a manual-only
   candidate also by manual-config removal; a quarantined feed keeps its prior web candidates;
   publication is **base-commit-SHA** guarded, there is at most one open discovery PR, and a second
   writer run must not silently drop the open PR's pending candidates; incomplete-source status is
   surfaced in the PR or a durable check summary.
9. Provenance is stable: `observed_at` is first-seen-and-reused and `sources[]` is canonically
   ordered/deduped, so an unchanged run produces **zero artifact churn** (byte-identical); a
   fixture feed source makes the watcher testable offline.
10. `raw_ref` (and any string crossing into the publish job) is length-bounded and
    control-stripped at ingestion and contextually escaped in all rendering (never raw HTML).
11. The workflow is `workflow_dispatch`, PR-gated, and never pushes `main`; P6 is stateless (no
    state branch/cursor); the template ships examples only — no real feeds, no personal data, no
    new secret, no central custody.
12. GitHub write templates (PR title / body / comment, commit messages) are composed only of
    trusted static text, normalized `owner/repo`, trusted-derived provenance, fixed reason codes,
    and bounded numbers — never raw feed title / description / HTML / free-text / producer messages.

## Open questions / decisions deferred to implementation (PR C)

- RSS/Atom parser choice — a small, well-audited, dependency-light parser that can satisfy the
  C3 entity-safe contract, vs. a hand-rolled parser. (The _safety contract_ is fixed by C3; only
  the dependency is open.)
- The concrete numeric values for each C4 ceiling, the C5 resolve budget / per-request timeout /
  concurrency defaults, and the fetch timeout default.
- Whether the single-open-PR policy is "update the existing PR branch" or "close-and-reopen"; both
  satisfy the base-SHA guard (C4/§Aggregation fix the safety property, not this mechanism).

## Security refinements to resolve in PR C (from cross-model review, rounds 1–3)

Concrete, safety-relevant contracts this design surfaced but leaves for PR C to implement and test.
Surfaced by cross-model review (rounds 1–3): grok-4.5 converged, and the GPT-5.6-sol implementation
findings below were **explicitly deferred to PR C by the owner** — deferred, not dismissed. PR C
**MUST** satisfy each; the ADR stays **Proposed** and P6.1 implementation must not begin before the
#34 review confirms them:

1. **Cross-job artifact extraction is itself hardened.** The intermediate artifact is bound to the
   exact producing job's artifact id/digest (not just a fixed name); extracted into an isolated
   non-checkout directory under compressed + expanded size limits; only the expected regular file(s)
   are accepted (reject symlinks, path traversal, extra entries, special files); validated before any
   token-bearing step; its contents are never executed; and the publish job re-runs `verify` on the
   pair after downloading it. (A fetch-job size assertion is not a boundary when the producer is
   assumed compromised.)
2. **The resolve job re-derives provenance, not just shape.** Beyond schema + caps + re-normalization,
   the trusted resolve job binds `kind === 'web'`, checks `source_id` / `source_url` exactly match the
   trusted checked-out feed config (a feed-URL change under an existing id **fails closed** —
   feed identity is stable, see config), mints/reuses `observed_at` itself, and independently enforces the
   C6 `raw_ref` rules — so a compromised producer cannot forge attribution or slip an attacker-chosen
   link past the human audit surface. Honest limit: revalidation binds identity, not extraction truth —
   feed membership stays an untrusted producer assertion unless the feed is retained and reparsed.
3. **Every C4 cap has an explicit, consistent direction.** Reconcile "per-feed bound → quarantine the
   feed" with "item cap → deterministic admit-up-to-cap + record"; give the `sources[]` cap an
   admission rule (retained/first-seen sources — including a legacy `future-web` entry — admitted
   first, new sources in canonical order, retained-source overflow fails closed so AC1 holds); and
   state the direction for the feed-count, URLs-per-item, string, and intermediate-artifact ceilings.
4. **Pending-PR state machine.** Choose and test one: (a) treat an open discovery PR's validated pair
   as additional retained input with compare-and-swap on both the base `main` SHA and the PR-head SHA;
   or (b) refuse further artifact-writing runs while a discovery PR is open. Either way, a PR whose base
   `main` advanced before a human merges is rebuilt by a fresh resolve run (the publish job cannot
   recompute — C1 denies it resolver capability), and an all-quarantined run still emits a
   `$GITHUB_STEP_SUMMARY` even when publish is skipped.
5. **Pin resolve/publish to the protected branch.** The resolve and publish jobs check out the
   default/protected branch SHA, not an arbitrary `workflow_dispatch` ref (the GHA ref-selection
   footgun); the quarantine reason-code set is a fixed enumeration in code.
