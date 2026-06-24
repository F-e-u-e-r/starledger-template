# P0 — Stars Exporter Specification

> Status: **P0 complete (P0.1–P0.6)** — typecheck, 90 tests, build, real-git smoke, and the aggregate release gate all green.
> Stack: Node ≥ 22, TypeScript, pnpm workspace. Next: P1 dashboard (stop extending the exporter).

The exporter turns a user's GitHub stars into a **deterministic, complete, canonical dataset**, validated and published through a single Git commit, that downstream phases (P1 dashboard, P2 notifier, P3 AI classification) consume. It is the trust boundary for everything that follows.

---

## 1. Scope

Enumerate the viewer's stars (GraphQL, with a REST fallback for truncated lists), hydrate metadata (with bisection + central retry), normalize, gate on a degraded-publication contract, validate, and publish `stars.json` + `dataset-meta.json` through **one Git commit**. A failure of any kind leaves the remote last-known-good unchanged.

Out of scope: dashboard/UI (P1), notifier (P2), AI/README (P3), template/action (P4), SaaS (P5). P0 does not fetch READMEs or compute derived/display values.

---

## 2. Locked decisions

| #   | Decision                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Primary key is `node_id`; dedup and sort tiebreak use it.                                                                                 |
| D2  | Order: `starred_at` DESC, `node_id` ASC tiebreak (total, deterministic).                                                                  |
| D3  | `stars.json` has no timestamps / no provenance → GraphQL and REST paths are byte-identical (I2 / DET-1). Volatile data → `run-meta.json`. |
| D4  | `latest_stable_release` ← `Repository.latestRelease`; `latest_any_release` ← `releases(first: 1, CREATED_AT DESC)`.                       |
| D5  | `is_private` hard-filtered; never in output.                                                                                              |
| D6  | Both enumeration paths converge to the identical `CanonicalRepo`, guaranteed by a single shared node selection (`REPO_NODE_FIELDS`).      |
| D7  | Per-repo hydration failure never fails the batch; degraded only when `degraded_ratio > max_degraded_ratio`.                               |

### Git publication architecture (P0.5)

|        |                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | A single Git commit (containing `stars.json` + `dataset-meta.json`) is the only remote publication boundary. Readers see the previous valid commit or the next complete one — never a partial working tree. |
| **A2** | No generation store / `current.json` pointer. Single workflow writer, low frequency, no server → Git already provides history, rollback, and last-known-good.                                               |
| **A3** | Local output ≠ published. `published` is true only after a successful `git push`.                                                                                                                           |
| **A4** | Last-known-good is the remote's current commit. Failures never push, so they never change it. No extra backup copies.                                                                                       |

### Corrections folded in (from review)

- **C1** provenance out of `stars.json` (→ `run-meta.json`).
- **C2** three files: `stars.json` (commit-on-change) · `dataset-meta.json` (committed with it; holds `stars_sha256`) · `run-meta.json` (git-ignored telemetry).
- **C3** `null` (confirmed absent) vs `unavailable_fields` (unknown), enforced as cross-field Zod invariants.

---

## 3. Authentication model

| Token                    | Use                         | Notes                                                                |
| ------------------------ | --------------------------- | -------------------------------------------------------------------- |
| `STAR_SYNC_TOKEN`        | read the viewer's stars     | fine-grained PAT, read-only, `Starring: read`; no write to the repo. |
| `GITHUB_TOKEN` (Actions) | commit + push, deploy Pages | `permissions: contents: write`; auto-injected.                       |

`viewer.starredRepositories` resolves to the token owner; `GITHUB_TOKEN` is `github-actions[bot]` (no stars) → cannot enumerate.

---

## 4. Pipeline

```
PROBE        viewer.starredRepositories(first: 1) { isOverLimit totalCount }
ENUMERATE    false → GraphQL pagination (inline hydration)                              [P0.1]
             true  → REST /user/starred (star+json) + full Link chain → seeds           [P0.3]
                     · one snapshot-conflict restart, else fail closed                  [P0.5]
HYDRATE      GraphQL nodes(ids:) in tunable batches, merged by node_id                  [P0.3]
             · central retry coordinator (Retry-After, jittered backoff, cooldown)      [P0.5]
             · bisection isolates problem nodes; singleton failure → degraded record    [P0.5]
NORMALIZE    raw → CanonicalRepo; release selection; topics; filter is_private
DEGRADE GATE degraded_ratio > max ⇒ do not publish                                       [P0.5]
RECONCILE    enumerated == exported + private + removed_mid_run + dropped_unidentifiable
SERIALIZE    deterministic canonical bytes
VALIDATE     Zod + node_id uniqueness + cross-file sha/count (in temp, before any WT)    [P0.5]
PUBLISH      commit-on-change → copy to WT → ONE commit (both files) → push              [P0.5]
META         write run-meta.json (git-ignored)
```

---

## 5. Outputs

`stars.json` = `{ schema_version, repos: CanonicalRepo[] }` (sorted per D2). `CanonicalRepo` carries identity, hydrated metadata (nullable), two release fields, `starred_at`, `hydration_status` (`ok|partial|failed`), and `unavailable_fields`.

`dataset-meta.json` = `{ schema_version, dataset_generated_at, stars_sha256, repo_count }` — committed with `stars.json`, only when it changes.

`run-meta.json` (git-ignored) carries lifecycle (`dataset_changed`, `validation_passed`, `degraded`, `degraded_ratio`, `staged`, `commit_created`, `push_succeeded`, `published`), `enumeration`, `counts`, `retry`, `hydrate`, rate limits, and `errors[]`.

JSON Schemas in `schemas/` are generated from Zod (`pnpm schemas`); cross-field invariants are enforced at runtime by Zod.

---

## 6. Degraded publication contract

```
degraded_ratio = hydration_failed_publishable / enumerated_after_dedup
```

Threshold compared in basis points to avoid float ambiguity: `failed*10000 <= total*bps` (bps = 500 for 5%). A failed-but-publishable record keeps identity (`node_id`, `name_with_owner`, `url`, `starred_at`) with all hydratable fields listed in `unavailable_fields`. `private_filtered` / `removed_mid_run` / `dropped_unidentifiable` are **not** part of numerator or denominator. A record without identity is dropped, not published.

---

## 7. Invariants & reconciliation

|        |                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| **I1** | `isOverLimit` true ⇒ never present a truncated GraphQL result as complete (switch to REST or fail).             |
| **I2** | GraphQL and REST paths produce byte-identical `stars.json`.                                                     |
| **I3** | (P2) replayed `source:item:target` must not re-notify.                                                          |
| **I4** | Any failure preserves last-known-good (no push) and flags the run degraded; exit 10/20 never change the remote. |

Reconciliation (asserted every run; `total_count_reported` is observational only):
`enumerated = exported + private_filtered + removed_mid_run + dropped_unidentifiable`.

---

## 8. Failure matrix

| ID  | Situation                       | Handling                                                    | Inv    | Phase        |
| --- | ------------------------------- | ----------------------------------------------------------- | ------ | ------------ |
| F1  | token missing/invalid (401)     | fast-fail, exit 10                                          | I4     | ✅ P0.1/P0.5 |
| F2  | empty replaces non-empty        | empty guard: defer unless allow_empty; bad prev = untrusted | I4     | ✅ P0.6      |
| F3  | primary rate limit insufficient | defer (exit 20), no retry                                   | I4     | ✅ P0.5      |
| F4  | secondary/abuse limit           | Retry-After + global cooldown; over budget → exit 20        | I4     | ✅ P0.5      |
| F5  | `isOverLimit == true`           | REST enumeration; never truncated                           | **I1** | ✅ P0.3      |
| F6  | REST page transient/permanent   | retry; unrecoverable → exit 20, no publish                  | I1/I4  | ✅ P0.3/P0.5 |
| F7  | node hydrate request fails      | bisect; singleton → degraded record                         | I4     | ✅ P0.5      |
| F8  | repo null after enumerate       | removed_mid_run; drop                                       | I4     | ✅ P0.3      |
| F9  | repo private & accessible       | filter (D5)                                                 | I1     | ✅ P0.1      |
| F10 | GraphQL batch timeout           | bisect + retry; singleton → failed                          | I4     | ✅ P0.5      |
| F11 | degraded_ratio exceeded         | do not publish, exit 20                                     | I4     | ✅ P0.5      |
| F12 | output fails validation         | no stage/commit; exit 20; WT untouched                      | I2/I4  | ✅ P0.5      |
| F13 | duplicate node_id, same ts      | dedup, keep first                                           | I2     | ✅ P0.3      |
| F14 | starred_at missing (star+json)  | IncompleteEnumerationError, exit 20                         | I1     | ✅ P0.3      |
| F15 | duplicate node_id, different ts | restart once; persistent → exit 20                          | I2     | ✅ P0.5      |
| F16 | commit/push failure             | exit 20; remote unchanged; published=false                  | I4     | ✅ P0.5      |

Exit codes: **0** published (or unchanged) · **20** deferred (remote last-known-good preserved) · **10** fatal (auth/schema/config). Each `ExporterError` carries its `exitCode`.

---

## 9. Acceptance tests — 90 green across 16 files

| Group                | IDs                                           | Status                        |
| -------------------- | --------------------------------------------- | ----------------------------- |
| Release              | REL-1..3                                      | ✅                            |
| Enumeration limit    | LIM-1, LIM-2, LIM-3                           | ✅                            |
| REST enumeration     | REST-1..5, missing-starred_at, dropped, DET-3 | ✅                            |
| Hydrate / bisection  | HYD-1..3, BIS-1..6                            | ✅                            |
| Retry / rate limit   | RATE-1..6, secondary-cooldown                 | ✅                            |
| Degraded gate        | DEG-1..7                                      | ✅                            |
| Duplicate conflict   | DUP-1..4                                      | ✅                            |
| Publication          | PUB-1..8, HASH-1                              | ✅ (FakeGit) + real-git smoke |
| Empty guard (F2)     | EMPTY-1..5                                    | ✅                            |
| Security             | SEC-1, SEC-2, strict-schema (no is_private)   | ✅                            |
| Budget               | BUD-1 (telemetry), BUD-2 (reserve floor)      | ✅                            |
| Run-level            | PRIV-1/2, DEG-3/5/6, HASH-2, REL-GATE-2       | ✅                            |
| Release gate         | REL-GATE-1 (`pnpm release-gate`)              | ✅ + public-PAT smoke (CI)    |
| Determinism / schema | DET-1, DET-2, SCHEMA cross-field              | ✅                            |

---

## 10. Milestones

|      | Content                                                                                                            | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| P0.1 | config/probe/GraphQL pagination/normalize/release/serializer/schemas                                               | ✅     |
| P0.2 | release fixtures                                                                                                   | ✅     |
| P0.3 | REST fallback (star+json, Link), nodes() hydrate, merge, dedup, reconciliation                                     | ✅     |
| P0.4 | path convergence + DET-1                                                                                           | ✅     |
| P0.5 | retry coordinator · bisection · degraded gate · duplicate-conflict restart · validated single-commit publication   | ✅     |
| P0.6 | empty guard (F2) · secret redaction · budget telemetry + reserve floor · release gate + real-git/public-PAT smokes | ✅     |

**P0 is complete.** Per the agreed exit condition: both paths produce the same deterministic dataset; incomplete / suspiciously-empty / over-threshold / invalid / rate-limited / publication-failed runs cannot modify the remote last-known-good; budget and reliability are observable; and the full release gate passes against real Git (public-PAT smoke runs in CI).

> **Private repositories are not a publication-blocking condition.** Upstream results containing private repositories may still publish after filtering — the invariant (I1/D5) is that **no private repository or internal field may enter the canonical dataset**, not that the run fails. `private_filtered > 0` is a credential-hygiene warning in run-meta, and the public-only PAT smoke asserts `private_filtered == 0`.

Next is **P1 dashboard** — stop extending the exporter.

---

## 11. Package layout

```
packages/schema          @starred/schema         Zod model + JSON Schema gen (trust boundary)
packages/github-client   @starred/github-client  errors · retry coordinator · GraphQL probe/page/hydrate(bisection) · REST enumeration · Octokit
packages/exporter        @starred/exporter        config · enumerate(dual-path) · hydrate-merge · degraded · normalize · serialize · publish(staged+git) · run/CLI
schemas/                 generated JSON Schemas
```
