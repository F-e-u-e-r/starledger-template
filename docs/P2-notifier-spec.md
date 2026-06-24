# P2 — Discovery Notifier

`@starred/notifier` watches discovery **sources** (YouTube channels, the
`awesome-stars` list), resolves the GitHub repositories they mention, and
delivers a one-shot Telegram notification per newly-discovered repository. It is
additive: it does **not** modify the P0 exporter or the canonical `stars.json`,
and persists its own state on a dedicated branch.

This document is the contract. It is intentionally invariant-led.

## Boundaries (what P2 is NOT)

No YouTube transcripts as a required dependency · no automatic repository
starring · no inbound Telegram commands · no webhook server · no multi-user · no
private-repository discovery · no exactly-once claims (see _at-least-once_ below)
· no committed secrets · no alternate backend · **no AI in P2** (the
deterministic summary is the contract; an LLM summarizer is deferred to P3 and
`summary.use_llm` is reserved/unsupported until then).

## Package layout

```
packages/notifier/src/
  models.ts        contracts: DiscoveryItem · ResolvedRepository · PendingNotification · DeliveryRecord · key helpers
  config.ts        versioned config (yaml+zod) + env secret readers
  state.ts         NotifierState schema · cold-start · validate · deterministic serialize · retention
  state-store.ts   StateStore interface + Git state-branch persistence (worktree)
  github-url.ts    GitHub URL extraction + normalization + reserved-path rejection (pure)        [P2.1]
  sources/         youtube.ts · awesome-stars.ts · index.ts (per-source isolation)               [P2.1]
  resolve-repo.ts  live GitHub resolution → ResolvedRepository (node-id dedup, rename-safe)       [P2.2]
  summary.ts       SummaryProvider: deterministic summary (the only P2 summarizer; LLM → P3)       [P2.3]
  errors.ts        delivery failure taxonomy: TelegramSendError + classify (retryable/permanent/fatal) [P2.5]
  telegram.ts      HTML-safe, length-budgeted renderer + sender                                   [P2.3]
  run.ts / cli.ts  orchestration + CLI
```

## The state machine (the heart of P2)

A source observes an **item** (a video, or a repo added to the list). One item
may reference **N repositories** (a video description can list several). Each
`(item, repository)` pair is one notification.

### Identity

```
item_key         = source : source_item_id                  (one per observed item)
notification_key = source : source_item_id : repo_node_id    (one per repository in the item)
```

`repo_node_id` is only known **after** GitHub resolution. Therefore the **durable
unit of work is the item, not the notification** — a `PendingNotification`
carries the full `DiscoveryItem` payload and is keyed by `item_key`. The
per-repository `notification_key` is the identity recorded in the delivery log
once a specific repository is sent.

> **Divergence from the P2 sketch (please review).** The sketch showed a pending
> entry already keyed by a full `youtube:VIDEO_ID:R_NODE`. That is the common
> 1-repo case, but it cannot represent the very failure the sketch's fix #2 is
> about: _"RSS finds video → GitHub API fails → lost."_ At that point there is no
> `node_id` yet. So pending is keyed by `item_key` (pre-resolution safe) and the
> `node_id`-bearing key lives on the **delivery** records. This strictly
> generalizes the sketch and handles 1-repo and N-repo items identically.

### Lifecycle invariant

Each referenced repository is delivered **independently**; a pending item leaves
the queue **only** when every repository it implies reached a terminal per-repo
record (or the item had no repository at all):

```
pending ── every referenced repo terminal ──────────────▶ (removed; one `sent`/`permanent_failure` per repo)
        ── item has no resolvable repository ────────────▶ skipped_no_repo    (item-level)
        ── a repo's message is deterministically rejected▶ permanent_failure  (per repo; never retried)
        ── retryable failure (GitHub 5xx, Telegram 5xx) ─▶ stays pending (attempts++, last_error)
        ── credential / destination fault ───────────────▶ run aborts (exit 10); nothing persisted
```

- `sent` and `permanent_failure` are **per repository** → `source:item:node_id`,
  and together form the at-least-once replay guard: a repeated run skips any
  `notification_key` already terminal. A video with repos A and B where A sent
  but B's send hit a `5xx` keeps the item pending; the retry skips A (already
  `sent`) and re-sends only B. If B's message is _deterministically_ rejected (a
  `400` Telegram rejects identically forever), B is recorded `permanent_failure`
  and never retried — the item still leaves the queue once A and B are terminal.
- `skipped_no_repo` is **item-level** → `source:item` (no repository involved).
- Retryable failures **never** drop the item; the payload persists across runs
  even after the item scrolls out of the source's recent window (fix #2).

### Failure taxonomy & exit codes (so `permanent_failure` is reachable)

Every delivery failure is classified (`classifyDeliveryFailure`) so a poison item
or a misconfigured destination can no longer pin the scheduled workflow at a
_permanent_ exit 20:

| Disposition | Trigger                                                                                                                                                                                                              | Effect                                                     | Exit                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| `retryable` | network, Telegram `429`/`5xx`, an unrecognized/unreadable Telegram `400`, GitHub resolve deferred, anything else (the safe default)                                                                                  | item stays pending (`attempts++`, `last_error`)            | 20                            |
| `permanent` | a deterministic per-message fault — an empty render, or a Telegram `400` whose description is in the known message-fault list ("message is too long", "can't parse entities"); an unrecognized `400` stays retryable | per-repo `permanent_failure` recorded; never retried       | 20 **once**, then item leaves |
| `fatal`     | a run-level credential/destination fault — Telegram `401`/`403`/`404` or a `400` destination description ("chat not found", "bot was blocked"); GitHub `401` on resolve                                              | run throws and persists **nothing** (last-known-good kept) | 10                            |

We never auto-discard on attempt count. A pending item that has failed
`retry.attention_after_attempts` times (default 6) is surfaced as `attention`
telemetry but **stays pending** — visible to an operator, never silently dropped.

> **Scope note (please review).** The sketch's "invalid GitHub credential →
> fatal" is honored for resolution (`401` → `AuthError`, exit 10). The _same_ bad
> PAT also reaches GitHub through the awesome-stars **source** poll, which is
> per-source-isolated to exit 20 — so a bad PAT surfaces as exit 10 when there is
> pending work to resolve, or exit 20 when only the source poll runs. This
> asymmetry is accepted: the source path must stay isolated, and a GitHub read
> failure must never drop durable pending work.

### Cold start (fix #3)

Each source carries an explicit `initialized` flag. Cold start is **never**
inferred from an empty seen-set (pruning could empty it later). The first run
baselines the source's current items and emits **nothing**; subsequent runs emit
only genuinely new items.

### At-least-once window (documented, accepted)

```
Telegram send succeeds → process crashes before the state push
  → next run re-sends that one notification once (it is not yet recorded `sent`).
```

This is the accepted boundary. We do not claim exactly-once.

## Contracts

`models.ts` defines, as strict Zod schemas: `DiscoveryItem` (description &
`published_at` nullable; `extraction_text` is what resolution scans),
`ResolvedRepository` (hydrated **current** identity for rename/transfer safety +
the metadata the deterministic summary needs), `PendingNotification` (full item
payload + attempts + last_error), and `DeliveryRecord` (terminal status only).
`NOTIFIER_SCHEMA_VERSION` is deliberately **separate** from the stars dataset's
`SCHEMA_VERSION`.

## State & persistence

`NotifierState` (see `state.ts`):

```jsonc
{
  "schema_version": "1.0",
  "youtube": {
    "<channel_id>": {
      "initialized": true,
      "etag": null,
      "last_modified": null,
      "recent_seen": [{ "id": "<video>", "seen_at": "<iso>" }],
    },
  },
  "awesome_stars": {
    "initialized": true,
    "repository": "maguowei/awesome-stars",
    "ref": "master",
    "paths": ["README.md"],
    "last_commit_sha": "<sha>",
  },
  "pending": [
    /* PendingNotification[] — never pruned */
  ],
  "deliveries": [
    /* DeliveryRecord[] — pruned by age then count */
  ],
}
```

- **Validate-before-replace.** A schema-invalid loaded state throws (deferred);
  the last-known-good remote is kept, never overwritten with a repaired guess.
- **Deterministic bytes.** `serializeState` emits fixed key order + sorted
  dynamic collections + a single trailing newline, so an unchanged state is
  byte-identical and the persist step is genuinely commit-on-change.
- **One writer, one commit.** State lives on `state.branch` (default
  `starledger-state`) and is written with Git plumbing without checking out or
  mutating the main worktree. Persisting is validate → write → one commit → push,
  gated on a content change. **A push failure leaves the remote state unchanged**
  (mirrors the exporter's publish discipline). Workflow concurrency
  (`group: notifier`) keeps it single-writer.
- **Retention.** `recent_seen` is capped per channel; `deliveries` are pruned by
  `delivery_days` then `delivery_max`; `pending` is never pruned.

## Sources (P2.1)

Detection is required; description enrichment is best-effort (fix #1).

- **YouTube.** Poll each channel's Atom feed with `If-None-Match` /
  `If-Modified-Since`; `304` ⇒ no work, no state change. Parse entries into
  `DiscoveryItem`s; a missing `media:description` yields `description: null` and
  is fine. New = video id not in `recent_seen`.
- **awesome-stars.** Compare the head commit SHA touching the watched paths. On
  change, fetch the file content at the **old** and **new** SHA, extract the
  **set** of GitHub repo URLs from each, and emit the set difference (new − old)
  — a repository **set diff, not a markdown line diff**. The URL set is never
  persisted; only `last_commit_sha` is.

A retryable source failure advances **no** state for that source (its cursor /
etag / sha is left untouched), so the change is re-observed next run.

## Resolution (P2.2) · Summary & delivery (P2.3) · Workflow (P2.4)

Summarized here; implemented in later milestones.

- **Resolution.** Normalize HTTPS/SSH/`.git`/subpath URLs to `owner/repo`; reject
  reserved routes (topics, marketplace, settings, sponsors, orgs, users,
  features, collections); resolve through GitHub, dedupe by `node_id`, use the
  hydrated current name/URL (rename/transfer safe), reject private. No
  resolvable repo ⇒ `skipped_no_repo` (not a run failure). The pure URL layer
  (`github-url.ts`) already lands in P2.1 because the awesome-stars set diff
  needs it.
- **Summary.** `SummaryProvider` interface; the deterministic implementation
  (description, primary language, topics, stars, latest release) is the only
  summarizer in P2. An LLM-backed provider is deferred to P3 and would slot in
  behind this interface; `summary.use_llm` is reserved and **rejected** until
  then, and no `LLM_API_KEY` is read.
- **Telegram.** HTML mode; escape `&<>` in all external text and attribute URLs;
  **budget field widths before render** so the final payload never exceeds 4096
  chars after entity parsing and truncation never splits a tag or entity.
- **Workflow.** `.github/workflows/notify.yml` — `cron: '17 * * * *'`,
  `workflow_dispatch`, `concurrency: { group: notifier, cancel-in-progress: false }`.
  It checks out `main`, builds only `@starred/notifier`, and runs the CLI with
  `STAR_SYNC_TOKEN`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. `GitStateStore`
  creates/updates the dedicated state branch via Git plumbing without changing
  the checked-out `main` worktree.

## Release gate

`pnpm p2-gate`: typecheck · lint · format · unit/integration tests · source
fixture coverage · real-Git state-branch smoke · built-artifact replay smoke.
CI (`ci.yml`) additionally runs the **secret-free** state-branch and replay
smokes on every PR (they import the built artifact, so they run after `build`).
`pnpm smoke:telegram` is an opt-in manual test-chat smoke; it sends only when
`TELEGRAM_SMOKE=1` and valid Telegram credentials are provided.

## Live validation (the P2 completion gate)

The smokes above need no secrets; the final sign-off does. Run this once on
hosted Actions, with `STAR_SYNC_TOKEN` + `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
configured as repo secrets, to mark P2 complete. **`config/notifier.yaml` must be
committed on `main`**: `notify.yml` runs against `main` and loads the config only
from the checked-out repo, falling back to defaults (`maguowei/awesome-stars`)
when it is absent. Inspect state by reading `notifier-state.json` on the
`starledger-state` branch between dispatches.

1. **Baseline a fixture you control.** In `config/notifier.yaml`, point
   `awesome_stars.repository` at a small repo you own whose `README.md` lists a
   few GitHub links (set `ref`/`paths` to match). Dispatch **Notify discoveries**
   (`workflow_dispatch`). The first run cold-starts: it emits nothing and only
   records the cursor. Assert `notifier-state.json` shows
   `awesome_stars.initialized: true`, `pending: []`, and `deliveries: []`.
2. **Introduce one discovery.** Add exactly one new public GitHub repo URL to the
   fixture `README.md` and commit it.
3. **Deliver.** Dispatch **Notify discoveries** again. Assert: one Telegram
   message arrives for that repo; the run exits 0; `deliveries` gains exactly one
   `{ notification_key: "awesome_stars:<owner/repo>:<node_id>", status: "sent" }`;
   `pending` is empty; `awesome_stars.last_commit_sha` advanced.
4. **Prove no duplicate (the replay gate).** Without touching the fixture,
   dispatch a third time. Assert: **no** Telegram message; the run logs
   `state unchanged` (the `sent` key suppressed the replay, so the commit is a
   no-op); exit 0.
5. **(Optional) Prove the fatal path is loud.** The fatal check needs pending
   work: with an empty queue the notifier never builds a delivery processor or
   contacts Telegram, so a bad chat id _alone_ would just exit 0. So first add a
   _second_ new public repo URL to the fixture `README.md` and commit it, then set
   the `TELEGRAM_CHAT_ID` secret to a chat the bot cannot post to and dispatch
   once. Assert a single **exit 10** run that persists nothing: the second URL is
   NOT recorded and `awesome_stars.last_commit_sha` does not advance
   (last-known-good preserved). Restore `TELEGRAM_CHAT_ID`; because the fatal run
   advanced nothing, the next normal dispatch delivers that still-"new" second URL.

P2 is marked **complete** only after steps 1–4 pass on hosted Actions.

## Implementation status

- **P2.0 — contracts + scaffold:** ✅ models, config, state, docs, example config.
- **P2.1 — sources + durable state:** ✅ github-url, YouTube + awesome-stars
  sources, Git state-branch persistence, source isolation, real-Git state smoke.
- **P2.2 — GitHub resolution:** ✅ candidate normalization/rejection, public
  REST hydration, node-id deduplication, rename/transfer-safe current identity,
  partial-resolution retry.
- **P2.3 — summary + delivery:** ✅ deterministic summary (LLM deferred to P3),
  safe HTML/length-budgeted Telegram rendering, per-repository replay guard,
  durable at-least-once delivery state.
- **P2.4 — workflow + local gate:** ✅ hourly workflow, single-writer
  concurrency, state/replay smokes, opt-in Telegram test-chat smoke. The local
  test-chat delivery has passed.
- **P2.5 — closure:** ✅ delivery failure taxonomy
  (`retryable`/`permanent`/`fatal`) so `permanent_failure` is reachable and a bad
  destination is a loud exit 10; GitHub-`401` → fatal; `attention` telemetry for
  stuck items; inert LLM wiring removed (`summary.use_llm` reserved, no
  `LLM_API_KEY`); CI runs the secret-free state/replay smokes. **Live controlled
  delivery + no-duplicate replay on hosted Actions remains the final validation
  before P2 is marked complete.**
