# P5 — Discovery Inbox & Candidate Review

## Status

| Sub-phase | What                                     | Status        |
| --------- | ---------------------------------------- | ------------- |
| P5.0      | Spec / ADR                               | this document |
| P5.1      | Candidate schemas + package scaffolding  | complete      |
| P5.2      | Manual source ingest + URL normalization | complete      |
| P5.3      | GitHub resolver + stars dedupe           | complete      |
| P5.4      | Candidate artifact generation + CLI      | complete      |
| P5.5      | Dashboard Discovery Inbox view           | complete      |
| P5.6      | Manual workflow (`workflow_dispatch`)    | complete      |
| P5.7      | Hosted validation                        | complete      |

## Goal

Create a trusted, deterministic pipeline that accepts candidate GitHub repo URLs from controlled sources, resolves them, deduplicates them, stores them as reviewable candidates, and optionally displays them in the dashboard.

P5 answers:

- What repos have I discovered but not yet starred?
- Where did each candidate come from?
- Has it already been starred / notified / dismissed?
- Is it worth reviewing later?

## Product shape

A new dashboard section — **Discovery Inbox** — shows candidate repositories that are:

- not currently in `stars.json`
- resolved as public GitHub repositories
- deduplicated by `node_id`
- linked to source provenance
- safe to review manually

The user treats it as a lightweight research queue.

## Non-goals

These belong to P6 or later:

- NotebookLM ingestion
- Threads / X watcher
- Telegram command bot
- Auto-star / auto-merge
- AI deciding what to star
- Agent writing directly to main
- Always-on server
- Central token custody
- Browser extension
- GitHub OAuth app

P5 remains: deterministic, repo-owned, static/dashboard compatible, manual-review first, safe for template users.

---

## Data model

### Canonical artifacts

Two generated files, produced by trusted CLI code (never by an agent):

```
discovery-candidates.json
discovery-candidates-meta.json
```

### `DiscoveryCandidate`

```ts
type DiscoveryCandidate = {
  node_id: string;
  owner: string;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage_url: string | null;
  primary_language: string | null;
  stargazer_count: number | null;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  pushed_at: string | null;
  discovered_at: string;
  first_seen_source: DiscoverySource;
  sources: DiscoverySource[];
  status: 'candidate' | 'dismissed' | 'promoted';
  decision_reason?: string;
};
```

### `DiscoverySource`

```ts
type DiscoverySource = {
  kind: 'manual' | 'notifier' | 'fixture' | 'future-telegram' | 'future-youtube' | 'future-web';
  source_id: string;
  source_url?: string;
  observed_at: string;
  raw_ref?: string;
};
```

### `DiscoveryCandidatesMeta`

```ts
type DiscoveryCandidatesMeta = {
  schema_version: 1;
  generated_at: string;
  dataset_sha: string;
  candidate_count: number;
  source_count: number;
  generator_version: string;
};
```

### Identity

Canonical identity: `node_id`.
Fallback identity before hydration: lowercase `owner/name`.

---

## Inputs

### Manual seed file

```
config/discovery-inbox.yaml
```

```yaml
manual:
  - url: https://github.com/actualbudget/actual
    note: Personal finance app to review later
  - url: https://github.com/linkwarden/linkwarden
    note: Bookmark manager candidate
```

### Decision file

Human-owned, never generated:

```
config/discovery-decisions.yaml
```

```yaml
dismissed:
  - repo: octocat/Hello-World
    reason: fixture only

promoted:
  - repo: actualbudget/actual
    reason: worth starring later
```

Decisions are applied at artifact generation time. The generated artifact is deterministic; human decisions are auditable.

---

## Pipeline

```
config/discovery-inbox.yaml
→ parse and validate URLs
→ normalize GitHub repo URLs
→ resolve public repos via GitHub API
→ dedupe by node_id
→ remove repos already present in stars.json
→ apply local decisions
→ emit discovery-candidates.json + meta
→ dashboard loads artifact fail-soft
```

## Dedupe rules

Excluded if:

- repo is already in `stars.json` by `node_id`
- repo is private / inaccessible
- repo is deleted / disabled
- repo URL cannot be normalized to GitHub `owner/repo`

Merged if:

- same `node_id` appears from multiple sources
- same repo appears with different URL casing
- same repo appears with trailing slash / subpath URLs

---

## Trust boundary

- Generated artifacts are produced only by trusted CLI code.
- No agent or AI can directly alter candidate status.
- Decisions are human-owned config files, not generated.
- The dashboard loads discovery artifacts fail-soft (absent = dashboard still works).
- The workflow opens a PR; it never pushes directly to main.

## Dashboard integration

Optional fail-soft loading mirroring the P3 AI enrichment pattern:

- If files are absent: dashboard still works (canonical stars view unaffected).
- If schema invalid, integrity fails, or counts mismatch: fail-soft suppresses the optional Discovery Inbox tab; canonical stars remain unaffected.
- If candidates exist and validate: show Discovery Inbox tab/card.

Fields: repo name, description, language, stars, source kind, source count, status, discovered_at, open GitHub link. Already-starred repos are excluded before artifact generation, so the dashboard does not render an already-starred indicator.

Filters: status, language, source kind, archived / active.

Search: repo `full_name`, description, source note text.

## GitHub Actions workflow

Manual-only (`workflow_dispatch`). No schedule in P5 MVP.

Behavior:

1. Checkout main
2. Install/build
3. Run discovery CLI
4. If candidates changed: create branch `discovery/inbox-<timestamp>`, commit artifacts, open PR

Never pushes directly to main.

## Hosted validation evidence

P5.7 hosted validation completed on 2026-06-25:

- Temporary manual candidate config committed to main in `69f4c3e` with `linkwarden/linkwarden` as the single validation candidate.
- Discovery Inbox workflow dispatched manually; the successful run was `28181731509`.
- The workflow generated candidate artifacts, pushed branch `discovery/inbox-20260625-153542`, and opened PR #35, `feat(discovery): update candidate artifacts`.
- PR #35 changed only `discovery-candidates.json` and `discovery-candidates-meta.json`.
- `pnpm discover verify` passed locally against PR #35 with `candidate_count: 1`; `pnpm install`, `pnpm build`, and `pnpm format:check` also passed.
- Hosted CI for PR #35 passed in run `28181781470`.
- PR #35 merged in `cbad7f2`; the temporary input config was removed from main in `0ea9a8c`.

Validation guardrails:

- No schedule is enabled for Discovery Inbox.
- No auto-star behavior exists.
- No agent direct-write path exists for candidate artifacts or decisions.
- No central key custody is introduced; the workflow uses repo-owned `STAR_SYNC_TOKEN` for GitHub API reads.

## Template safety

For `starledger-template`, P5 ships with:

- `config/discovery-inbox.example.yaml`
- `config/discovery-decisions.example.yaml`
- `discovery-inbox.yml` as `workflow_dispatch` only
- No real candidates, no personal discovery data, no schedule, no secrets required unless resolving via API

---

## Package

```
packages/discovery    @starred/discovery
```

Separate package because P5 is a new product layer, not notifier logic.

## Acceptance criteria

1. Manual discovery candidates can be declared in config.
2. GitHub repo URLs are normalized and resolved.
3. Already-starred repos are excluded.
4. Candidate artifacts are deterministic and schema-validated.
5. Dashboard loads Discovery Inbox fail-soft.
6. Manual workflow can produce a candidate PR.
7. Template ships with examples only, no personal data.
8. Hosted validation is recorded.
9. No schedule is enabled by default.
10. No agent or AI can directly alter candidate state.
