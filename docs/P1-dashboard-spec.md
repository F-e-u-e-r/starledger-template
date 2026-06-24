# P1 — Dashboard Specification

> Status: **P1.1–P1.4 implemented** (trusted loading + states; full search/sort/filter UI with canonical URL state and a11y; GitHub Pages deploy via Actions artifact with dataset staging + integrity verification). `pnpm p1-gate` green.
> Stack: Vite · React · TypeScript · `@starred/schema` · GitHub Pages. No backend.

A static, client-side dashboard that loads the canonical `stars.json` produced by P0 and lets a user search, sort, and filter their starred repositories. State is reproducible (URL), data semantics are correct, and deployment needs no server.

> Naming: the workspace uses `@starred/*` (the P1 review examples wrote `@starledger/*`). The Pages base path is derived from `GITHUB_REPOSITORY` at build time, so a project rename needs no code change.

---

## 1. Architecture

```
apps/dashboard/
  src/
    app/         App + load state machine
    components/  state views (loading / error / empty / no-results)
    data/        load-stars (trusted loading) · derive-fields
    features/    repositories (cards + select pipeline) · search · filters (controls + chips) · sorting
    state/       canonical DashboardState + URL codec + useDashboardState
    styles.css
  index.html  vite.config.ts  (Pages base path derived from GITHUB_REPOSITORY)

packages/schema   ← shared canonical model (single source of truth, reused from P0)
packages/deploy   ← Pages tooling: dataset integrity, staging into dist, artifact verify, static smoke

.github/workflows ← ci.yml · pages.yml (reusable build + deploy) · sync-stars.yml (exporter → calls deploy)
```

The dashboard validates `stars.json` against the **same** `@starred/schema` the exporter writes — no schema drift.

---

## 2. Trusted data-loading contract (P1.1)

Extends the P0 publication contract to the reader:

1. fetch `dataset-meta.json` (no-cache) → JSON parse → `DatasetMetaSchema`
2. take `stars_sha256`
3. fetch `stars.json?sha=<hash>` — busts stale Pages/CDN/browser caches (both files came from the same commit, so the hash is the right cache key)
4. verify the **raw bytes'** SHA-256 == `stars_sha256` (integrity) **before** parsing
5. parse + `StarsFileSchema` validation
6. only then hand data to the UI

A single integrity mismatch is most likely a **cross-deployment read race** on Pages (old meta + new stars, or vice versa), so the **whole snapshot** (meta + stars) is re-fetched once before failing. Any failure throws a typed `DataLoadError` (`fetch` | `schema` | `integrity`) and the UI **fails closed** — never renders unvalidated data. An empty dataset is a normal empty state, not an error.

---

## 3. Derived fields (P1, not P0)

Computed at view time from raw fields (`deriveRepo(repo, now)`):

```ts
type DerivedRepo = CanonicalRepo & {
  monthsSincePush: number | null; // null when pushed_at is unknown/absent
  isStale: boolean; // false when the push date is unknown
  stableRelease: 'has' | 'none' | 'unavailable';
  anyRelease: 'has' | 'none' | 'unavailable';
};
```

The release fields are **three-state** precisely to preserve P0's `null`-vs-unknown distinction: a field in `unavailable_fields` becomes `'unavailable'` ("information unavailable"), never `'none'`. A hydration-failed repo must not render `latest_stable_release: null` as "No releases", and an unknown `pushed_at` is **not** counted as stale.

---

## 4. Milestones

|          | Content                                                                                                                                                                                                                                                                                                                                                                                                           | Status  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **P1.1** | Vite/React/TS scaffold · shared schema · load + validate `dataset-meta` + `stars` · loading/error/integrity/empty states · Pages base path                                                                                                                                                                                                                                                                        | ✅ done |
| P1.2     | **Filter / sort / search logic for every facet** (language, topics, license, archived, fork, has-release, stale, hydration) — substring search, AND across facets, OR within a facet; sort by `starred_at` / stars / pushed / release / name. **UI wiring is intentionally minimal** (search · sort · language · has-release · hide-archived); the remaining facet controls are P1.3, not an accidental omission. | ✅ done |
| P1.3     | UX: **all facet controls** (language · topics · license · archived · fork · stale · stable/any release · hydration) · responsive cards · result count · active-filter chips · clear-all · sort direction · keyboard a11y · **canonical URL state** (codec + history, back/forward) · memoized prepare→select pipeline                                                                                             | ✅ done |
| P1.4     | GitHub **Pages deploy via Actions artifact** (not `gh-pages`): `@starred/deploy` stages + integrity-verifies `stars.json`+`dataset-meta.json` into `dist/`; `ci.yml` (no secrets) · `pages.yml` (reusable build+deploy) · `sync-stars.yml` (exporter → commit → calls deploy directly); `p1-gate.sh`                                                                                                              | ✅ done |

**Explicitly excluded from P1:** AI categories, semantic search, Telegram, login, server/API, user editing, charts, heavy animation, IndexedDB.

### P1.5 — UX & accessibility hardening (maintenance)

A non-architectural polish pass over the shipped dashboard — no new data, no new facets:

- **The filter drawer is a real modal dialog** — focus moves in on open and is restored to the toggle on close, Tab/Shift+Tab are trapped inside, Escape and a backdrop click close it, and body scroll is locked while open (**A11Y-5**).
- **Card scan path** — heavier title, caution styling for the degraded/unavailable badge, and the stable + latest release **colocated** in the highlights row; "latest" appears only when it adds information (a prerelease-only repo, or a prerelease newer than the stable tag) rather than restating the stable tag (**CARD-5**).
- **Plainer product language** — one result line ("N of M · filtered" / "N results for …" instead of two stacked counts), a per-section "N selected" count in place of the static option count, brief help text for Stale / "Unavailable" / Data status, and the Data status facet hidden until the dataset actually contains degraded repositories (it still appears when a bookmarked URL has it active).

---

## 5. Acceptance tests

| ID       | Test                                                                     | Status |
| -------- | ------------------------------------------------------------------------ | ------ |
| DATA-1   | valid `stars.json` passes shared schema and renders                      | ✅     |
| DATA-2   | schema-invalid `stars.json` → no records rendered (fail closed)          | ✅     |
| DATA-3   | `dataset-meta` hash ≠ `stars` bytes → integrity error                    | ✅     |
| DATA-3B  | transient cross-deploy mismatch recovers on a full-snapshot retry        | ✅     |
| DATA-3C  | persistent mismatch → fail closed after one retry                        | ✅     |
| DATA-4   | unavailable release field shows "unknown", not "no release"              | ✅     |
| EMPTY-1  | zero repositories → normal empty state, not an error                     | ✅     |
| PATH-1   | under `/<repo>/` base, assets + data load (sha-busted)                   | ✅     |
| SEARCH-1 | search matches name/description/topic/language                           | ✅     |
| SEARCH-2 | case-insensitive; empty/whitespace query matches all                     | ✅     |
| SORT-1   | asc/desc with deterministic node_id tiebreak                             | ✅     |
| SORT-2   | null/unknown values sort last regardless of direction                    | ✅     |
| SORT-3   | sort returns a new array; input order and objects are not mutated        | ✅     |
| FILTER-1 | AND across facets                                                        | ✅     |
| FILTER-2 | OR within a facet (multi-select)                                         | ✅     |
| FILTER-3 | clearing filters restores the full dataset                               | ✅     |
| FILTER-4 | release "none" filter excludes "unavailable" (unknown≠absent)            | ✅     |
| FILTER-5 | stable=none + any=has match a prerelease-only repo (independent)         | ✅     |
| FILTER-6 | any-release "unavailable" is distinct from "none" (both ways)            | ✅     |
| RESULT-1 | combined search + filter + sort yields the correct set & count           | ✅     |
| PERF-1   | thousands of repos filter/sort without jank                              | ✅     |
| STATE-1  | defaults normalize to themselves; serialize to an empty string           | ✅     |
| STATE-2  | array facets deduplicate + sort; equivalent states are identical         | ✅     |
| URL-1    | full state round-trips; canonical emit order (reload/shared link)        | ✅     |
| URL-2    | equivalent states serialize byte-identically                             | ✅     |
| URL-3    | invalid enum/malformed values fail safe to defaults                      | ✅     |
| URL-4    | repeated scalar takes the last valid value                               | ✅     |
| URL-5    | default state produces no query string                                   | ✅     |
| URL-6    | prerelease-only (stable=none + any=has) round-trips                      | ✅     |
| URL-7    | unknown-but-valid facet values survive (bookmarks don't drop)            | ✅     |
| HIST-1   | replaceState for typing, pushState for discrete; popstate restores       | ✅     |
| FACET-1  | every supported facet is reachable from the UI                           | ✅     |
| FACET-2  | removing one chip removes only its filter                                | ✅     |
| FACET-3  | clear-all returns to the default state                                   | ✅     |
| RESULT-2 | no matches → no-results state, not the empty-dataset state               | ✅     |
| CARD-1   | confirmed-absent vs unavailable render distinctly                        | ✅     |
| CARD-2   | archived / fork / hydration states are visible                           | ✅     |
| CARD-3   | repository links use the canonical URL                                   | ✅     |
| CARD-4   | long names/descriptions/topics do not break layout (CSS wrap)            | ✅     |
| CARD-5   | stable + latest release colocated; latest shown only when distinct       | ✅     |
| A11Y-1   | search/filter/sort/chips operable by keyboard, with names                | ✅     |
| A11Y-4   | focus stays logical after chip removal / clear-all                       | ✅     |
| A11Y-5   | filter drawer traps + restores focus; Escape/backdrop close; scroll lock | ✅     |
| PERF-2   | prepared dataset powers many queries without re-deriving                 | ✅     |
| PERF-3   | facet options depend only on the dataset                                 | ✅     |
| TIME-1   | stale uses one mounted clock, stable across unrelated changes            | ✅     |
| TIME-2   | a newer mount clock re-evaluates staleness                               | ✅     |

**P1.4 — deployment** (`@starred/deploy`, run under vitest + the P1 gate):

| ID           | Test                                                           | Status        |
| ------------ | -------------------------------------------------------------- | ------------- |
| BUILD-DATA-1 | matching stars + meta verify; dist contains both data files    | ✅            |
| BUILD-DATA-2 | a stars/meta hash mismatch is rejected                         | ✅            |
| BUILD-DATA-3 | run-meta/secret files are refused in the artifact              | ✅            |
| PATH-2       | the artifact works under `/<repo>/` (assets are base-prefixed) | ✅            |
| DEPLOY-1     | dist passes schema/hash/count validation before upload         | ✅            |
| DEPLOY-2     | base-path asset + data URLs resolve in a static-server smoke   | ✅            |
| DEPLOY-3/4   | invalid/failed staging never mutates or ships the dataset      | ✅            |
| DEPLOY-5     | unchanged run deploys only on manual dispatch (no data commit) | ✅ (workflow) |
| DEPLOY-6     | the live page loads/searches/sorts the real dataset            | ◻ live        |

Suite: load-stars (DATA-1/2/3/3B/3C, EMPTY-1, PATH-1) · App state machine · derive-fields (incl. stale boundary) · search · sorting (SORT-1/2/3) · filters (FILTER-1..6) · select + prepared pipeline (RESULT-1, PERF-1/2/3) · dashboard-state codec (STATE/URL) · useDashboardState (HIST) · FilterControls/Chips · RepositoryCard (CARD/DATA-4) · RepositoryView (FACET/RESULT-2/A11Y) · `@starred/deploy` (BUILD-DATA/PATH-2/DEPLOY) — all green. The pipeline takes an explicit `now`; `RepositoryView` fixes one session clock so derived staleness does not drift across recomputes. DEPLOY-6 is the only check that requires the live Pages site.

---

## 6. Exit condition

> P1 is complete when a user can reliably load the canonical stars dataset on GitHub Pages and quickly search, sort, and filter repositories; all state is reproducible, data semantics are correct, and deployment depends on no backend.

Status against the P1 exit checklist:

1. dashboard loads only a schema-valid, hash-valid canonical dataset — ✅ (`load-stars`)
2. search, sorting and every intended filter are reachable in the UI — ✅ (FACET-1)
3. unavailable data stays distinct from confirmed absence — ✅ (DATA-4 / CARD-1)
4. state is canonically URL-encoded and survives reload/back/forward — ✅ (URL/HIST)
5. the interface is responsive and keyboard accessible — ✅ (A11Y, responsive CSS)
6. Actions can safely update the dataset and deploy Pages — ✅ (`sync-stars` + `pages`)
7. a workflow-generated data commit does not rely on a suppressed `push` to deploy — ✅ (`sync-stars` calls `pages.yml` directly)
8. failed exporter/build/deploy runs cannot corrupt the canonical dataset — ✅ (DEPLOY-3/4)
9. the live Pages site passes an end-to-end smoke without a backend — ◻ verified on first deploy (DEPLOY-6)

Everything except (9), which requires the live site, is covered by `pnpm p1-gate`.
