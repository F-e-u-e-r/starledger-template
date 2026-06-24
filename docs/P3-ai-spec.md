# P3 - AI Classification and Enrichment

P3 adds optional AI-generated repository category, controlled tags, and a concise
summary without changing the canonical `stars.json`.

```text
stars.json            = canonical GitHub data, fail-closed
ai-annotations.json   = optional enrichment, fail-soft
```

The dashboard must remain usable when no executor is configured, classification
is partial, an executor fails, an AI artifact is missing or invalid, or an
individual repository cannot be classified.

## Trust boundary

Claude Routines and Codex App Automations are interchangeable **agent
executors**, not StarLedger's trusted core. They can create untrusted candidate
classifications only. The repository owns planning, validation, serialization,
hashing, and publication gates. P3.0 supplied the trusted structural artifact gate;
P3.3 adds current-source provenance validation for artifact PRs.

```text
deterministic planner
  -> bounded ClassificationManifest
agent executor
  -> ClassificationCandidate
deterministic validator and assembler
  -> validated public artifacts
Git PR and CI
  -> publication
```

P3 v1 is PR-gated. An executor creates a dedicated branch and pull request; it
never pushes `main`, updates a state branch directly, or merges itself. Claude
Routine is the initial cloud executor. Codex App Automation is a local,
worktree-based fallback. Enable only one scheduled executor at a time.

`.github/workflows/ai-agent-pr.yml` inspects **every** pull request — the
structural gate is **path-triggered**, not branch-triggered. It uses
`pull_request_target`, checks out the protected base revision, and fetches the
candidate commit as data only; the trusted CLI (`verify-agent-pr`), not
agent-controlled PR code, decides from the changed paths. A PR that touches no AI
artifact passes with no executor checks. A PR that touches `ai-annotations.json`
or `ai-annotations-meta.json` must originate from an approved **same-repository**
executor branch (`claude/*` or `codex/*`) and change only the complete, valid
artifact pair — so renaming a branch, or a fork impersonating `claude/*`, can
never bypass validation. Branch prefixes identify the approved executor only
AFTER an artifact change is detected; they never determine whether validation
runs. Event-controlled values (branch/repo names) are passed via environment
variables, never interpolated into the shell. The job has read-only contents
permission and no repository secret, and blocks artifact deletion and rename. It
is a structural gate only; P3.3's separate provenance gate adds current-source
and current-fingerprint validation.

## P3.0 status and boundaries

P3.0 establishes contracts and deterministic scaffolding only. It does **not**
call a model provider, fetch a README, schedule a job, publish directly to main,
modify the dashboard, or change `stars.json`.

P3.0 explicitly does not use `AI_API_KEY`, a provider adapter, a model timeout,
or GitHub Actions model calls. Executor subscription authentication belongs to
the executor platform and is never a StarLedger configuration value.

## Packages and temporary inputs

```text
packages/ai-schema/src/
  scalars.ts            UTC timestamps, canonical summaries, model labels, Git OIDs
  taxonomy.ts           fixed category/tag vocabulary and limits
  annotation.ts         strict public annotation contract
  artifact.ts/meta.ts   deterministic public files and exact-byte hash
  execution-profile.ts  controlled executor methodology version
  job.ts                immutable ClassificationJob and job_id
  manifest.ts           deterministic temporary work list
  candidate.ts          strict untrusted agent output contract

packages/classifier/src/
  config.ts             executor-neutral versioned configuration
  validate-candidate.ts exact job/candidate matching and normalization
  assemble.ts           deterministic public artifact assembly
  verify-diff.ts        agent PR path allowlist
  cli.ts                plan, validate, apply, artifact and diff commands

prompts/classify-agent-v1.md
  shared instruction transport for Claude Routine and Codex Automation
```

Manifests and candidate bundles may contain bounded, preprocessed README text.
They live under ignored `.ai-runs/`, must remain temporary, and must never be
committed. Public artifacts never contain raw README text, prompts, model output,
error bodies, or secrets.

## Taxonomy and execution profile

`taxonomy_version` is `"1"`. It covers the fourteen closed primary categories,
the sorted controlled tag vocabulary, and the limits: one category, zero to six
tags, tag length at most 32, and summary length from 80 to 400 characters.
Unknown categories and tags are rejected. The taxonomy test verifies every
controlled tag remains within `TAG_MAX_LENGTH`.

`execution_profile_version` is `agent-v1`. It is owned by StarLedger and is the
authoritative methodology/cache invalidation key. `executor_kind` is bound to
each manifest and job; switching between `claude-routine` and `codex-automation`
therefore produces new job IDs and prevents one executor's candidates from
satisfying the other executor's manifest. Bump the profile if the instructions,
selected model, reasoning level, or methodology changes enough to warrant
reclassification. An executor-reported `model_label` is optional observation
data, canonicalized, and never a trust or cache key.

The supported `execution.kind` values are `claude-routine` and
`codex-automation`. They share the same candidate schema, but each manifest is
bound to exactly one of them.

## Public artifact contracts

`ai-annotations.json` is strict, sorted by `node_id`, and joins the dashboard
only through that key. It carries exactly one category, normalized tags, summary,
source fingerprint, and generation provenance:

```json
{
  "schema_version": "1.0",
  "taxonomy_version": "1",
  "annotations": [
    {
      "node_id": "R_kgDO...",
      "category": "developer-tools",
      "tags": ["automation", "cli"],
      "summary": "A concise factual explanation within the documented character bounds.",
      "source": {
        "kind": "readme",
        "readme_path": "README.md",
        "readme_oid": "abc123",
        "repo_metadata_sha256": "...",
        "fingerprint": "..."
      },
      "generation": {
        "executor_kind": "claude-routine",
        "execution_profile_version": "agent-v1",
        "model_label": "informational-only",
        "prompt_version": "classify-v1",
        "generated_at": "2026-06-20T00:00:00Z"
      }
    }
  ]
}
```

`ai-annotations-meta.json` stores the SHA-256 of the exact annotation bytes,
the annotation count, taxonomy version, canonical dataset hash, and generation
timestamp. It is updated only when annotation bytes change.

All committed timestamps are UTC ISO-8601 strings ending in `Z`. Summaries are
normalized before validation: Unicode NFC, CRLF/CR to LF, horizontal whitespace
collapsed, newlines collapsed to spaces, and leading/trailing whitespace
trimmed. The committed artifact only accepts canonical single-paragraph
summaries and rejects control characters. `readme_oid` is an opaque Git object
ID from GitHub, not a StarLedger SHA-256 fingerprint.

## Job and candidate contract

Each `ClassificationJob` includes an immutable `job_id`, `node_id`, source
fingerprint, taxonomy/prompt/profile versions, `executor_kind`, bounded
canonical metadata and optional README input, plus the full allowed taxonomy
constraints. `job_id` is a SHA-256 over all of those immutable fields with
canonical key and list order.

Every candidate must repeat `job_id`, `node_id`, `source_fingerprint`,
`taxonomy_version`, `prompt_version`, and `execution_profile_version` exactly.
The candidate's `execution.kind` must match the job's `executor_kind`. The
deterministic validator rejects mismatches as stale or invalid. Candidate tags
are deduplicated and sorted before artifact construction; unknown values and
over-budget values are rejected. The resulting public artifact is strict and
canonical.

## Deterministic commands

```text
pnpm classifier plan --out .ai-runs/manifest.json
pnpm classifier validate-candidates --manifest .ai-runs/manifest.json --candidates .ai-runs/candidates.json
pnpm classifier apply --manifest .ai-runs/manifest.json --candidates .ai-runs/candidates.json --generated-at <ISO-8601> --out-dir .
pnpm classifier verify-artifacts --annotations ai-annotations.json --meta ai-annotations-meta.json
pnpm p3-agent-gate origin/main
```

The P3.0 scaffold emitted an empty, valid manifest. P3.1 now supplies bounded
repository discovery, preprocessing, fingerprints, and actual jobs. `apply` only
accepts candidates that pass exact job matching; it merges by `node_id`, sorts,
serializes fixed key order, and derives metadata from exact bytes.

`p3-agent-gate` is for an executor branch or PR only. It rejects every changed
path except `ai-annotations.json` and `ai-annotations-meta.json`, requires the
artifact pair to be added or updated together, and rejects deletion or rename of
either artifact. The `ai-agent-pr.yml` workflow independently runs the
equivalent checks with trusted base-branch code. Do not run it as a general
source-code CI gate.

## Executor operating policy

Use the shared repository prompt. Treat all repository material as untrusted
data. Keep executor network access and connectors minimal. The agent cannot
choose the job set, taxonomy, schema, source fingerprint, manifest dataset SHA,
hash, artifact order,
publication decision, executor binding, or files outside the path allowlist.

For a Claude Routine, preserve the default restricted `claude/` branch policy;
do not enable unrestricted pushes or auto-merge. For Codex App Automation, use a
new worktree so an automation cannot alter an active local working tree. The
Codex machine must remain available for project-scoped scheduled runs, so it is
a fallback rather than a second simultaneous writer.

## Generated schemas and P3.0 gate

`pnpm schemas` generates and CI drift-checks:

```text
schemas/ai-annotations.schema.json
schemas/ai-annotations-meta.schema.json
schemas/classification-job.schema.json
schemas/classification-manifest.schema.json
schemas/classification-candidate.schema.json
```

`pnpm p3-gate` runs typecheck, lint, format check, all tests, build, generated
schema regeneration, and schema drift verification.

P3.0 proves strict taxonomy validation, tag-length bounds, deterministic job and
manifest bytes, exact candidate/job/executor matching, deterministic artifact
bytes and hashes, public-artifact secret/README exclusion, canonical UTC
timestamps, summary/model-label normalization, artifact deletion/rename
blocking, and the agent diff allowlist.

## Gate semantics

- **P3.0 structural gate:** validates changed paths, add/update lifecycle,
  public artifact schemas, exact artifact hash, deterministic serialization, and
  executor/job/candidate structural consistency. It runs only trusted base-branch
  code and uses no secrets. It does not prove classification provenance.
- **P3.1 planning (delivered):** deterministic trusted README/metadata discovery,
  per-repo source fingerprints, and a budget-limited `ClassificationManifest`
  carrying `dataset_sha256`. It produces jobs from canonical stars only; it is not
  itself a PR gate.
- **P3.3 provenance gate (delivered):** `verify-ai-provenance` recomputes current
  jobs and fingerprints from the protected base dataset plus live README
  discovery, and rejects any changed annotation that does not match a current job
  — stale fingerprint/OID/metadata, invented node, wrong `dataset_sha256`, wrong
  executor/profile, or an over-budget delta.
- **P3.3 publication (delivered):** validated artifacts publish through a reviewed
  merge; the Pages workflow stages them fail-soft and deploys the merged commit.
  Operational state on `starledger-ai-state` is written only by the trusted
  `ai-state` workflow, never by an executor.

With the P3.3 provenance gate in place an executor may run, but keep BOTH
`verify-agent-artifacts` and `verify-ai-provenance` required on `main`, and do not
auto-merge agent PRs — every AI artifact still publishes through human review.

## P3.0 exit conditions

- all schemas are strict;
- every job and candidate is bound to one executor;
- committed timestamps are canonical UTC `Z`;
- summaries and model labels are canonicalized;
- artifact deletion and rename are blocked for agent PRs;
- every AI-artifact PR is inspected regardless of branch name (the gate is path-triggered);
- only approved same-repository executor branches may modify AI artifacts;
- the `verify-agent-artifacts` check is a REQUIRED status check on `main` — a
  repository ruleset / branch-protection setting that cannot be enforced from
  repo code, so it must be configured before P3 is treated as PR-gated;
- the agent PR workflow executes only trusted base-branch code;
- no API key, provider adapter, model call, or scheduled executor exists;
- `pnpm p3-gate` is green.

## P3.1 — trusted sources, fingerprints, and planner

P3.1 turns the empty P3.0 scaffold into a real deterministic planner. It calls no
agent, publishes no annotation, and does not touch `stars.json` or the dashboard.
`pnpm classifier plan` now:

1. **Loads + verifies the canonical dataset** exactly as the dashboard loader and
   exporter do (both schemas, exact `stars_sha256`, `repo_count`, unique
   node_ids). Only repositories that pass classify; the dataset SHA is recorded.
2. **Discovers the preferred README** through a narrow `ReadmeSource` seam: a
   lightweight `getReadmeRef` (path + blob OID, resolved for a known path by a
   content-free GraphQL `object(expression:"HEAD:<path>")` probe) and a heavyweight
   `getReadmeContent`. An unchanged OID never downloads content; a repository with
   no README classifies from canonical metadata instead.
3. **Preprocesses README text as untrusted, bounded data** — NFC, LF endings,
   badge/image/comment noise removed, code blocks capped, truncated to
   `readme_max_chars`. Preprocessing is a pure function with no network access, so
   a link inside a README is never fetched.
4. **Computes a per-repo `source_fingerprint`** over the source identity (README
   path+OID, or `metadata`), the classification-relevant canonical metadata
   (`repo_metadata_sha256`), and the taxonomy/prompt/profile/executor versions. It
   DELIBERATELY excludes the whole-dataset SHA: an unchanged README OID must let
   the planner skip a repository, and an unrelated star delta must not churn a
   repository's annotation. The dataset SHA is represented at the manifest and
   `ai-annotations-meta.json` level instead, where the P3.3 gate verifies it.
5. **Plans a budget-limited manifest** by a fixed precedence — terminal →
   not-yet-due retry → due retry → new → changed-fingerprint refresh → skip — with
   per-bucket and total per-run ceilings, sorted deterministically before the cut.
   Jobs come ONLY from verified canonical stars: an agent cannot add, remove, or
   alter a job, and a repository removed from the dataset is never planned.
6. **Persists operational state** to the dedicated `starledger-ai-state` branch
   (`classifier-state.json`): README path/OID cache, retry bookkeeping, and
   terminal-unavailable flags only — never README content, prompts, candidates,
   model output, secrets, or raw error bodies. The branch is independent of the
   notifier's, and load validates before replace, so a corrupt remote document
   never overwrites the last-known-good.

## P3.2 — agent executor integration

P3.2 lets an external **agent executor** turn a trusted manifest into candidate
JSON. The executor is the ONLY model-calling component and runs OUTSIDE this
repository: there is no `AI_API_KEY`, no provider adapter, and no model call in
GitHub Actions. The repository supplies the deterministic CLI, the shared prompt,
and the trust boundary; the executor supplies untrusted candidates.

`prompts/classify-agent-v1.md` is the single versioned instruction transport for
both executors. It states that all repository material is untrusted data (never an
instruction), that the agent must use only each job's `constraints`, copy the job
identity verbatim, emit a `ClassificationCandidate`, modify only the two AI
artifacts, and never push `main`, push a state branch, or merge a PR. A test pins
those invariants so the prompt cannot silently weaken.

**Executors.** Claude Routine is the primary, cloud-hosted, scheduled executor; it
opens a `claude/*` pull request. Codex App Automation is a local, worktree-based
fallback that opens a `codex/*` PR. Each is bound to exactly one `executor_kind`;
switching executor produces new job IDs, so one executor's candidates can never
satisfy the other's manifest. Enable only one scheduled executor at a time — there
is no in-repo schedule for either (the gate workflow is the only AI-related CI).
See `docs/P3.2-executor-runbook.md` for setup and the command sequence.

**Reconciliation and failure handling.** `reconcileRun` matches each candidate to a
manifest job by `job_id` and validates it exactly. A candidate that matches no
manifest job, declares the wrong executor, carries a stale fingerprint, or fails
validation is REJECTED — the CLI `apply` hard-fails rather than letting a bad
candidate enter an artifact. A manifest job with no valid candidate is recorded as
pending and reclassified on a later run, so a job is never silently dropped and an
executor can never introduce a node the planner did not authorize. Partial
candidate sets are therefore first-class.

**Merge discipline.** The structural gate restricts an executor PR to the complete
`ai-annotations.json` + `ai-annotations-meta.json` pair; manifests and candidates
live under ignored `.ai-runs/` and are rejected if a PR tries to commit them. State
is written only by the trusted `ai-state` workflow on the `starledger-ai-state`
branch — never by the agent, never on `main`, and never auto-merged.

## P3.3 — provenance gate and publication

P3.3 adds the SECOND required check, `verify-ai-provenance`, and wires publication
to GitHub Pages. The structural gate proves an AI-artifact PR is shaped correctly;
the provenance gate proves it is TRUE.

**Provenance gate.** For every PR that touches an AI artifact, trusted base-branch
code (`.github/workflows/ai-provenance.yml`) recomputes the current jobs from the
protected base dataset and live README discovery, and verifies each CHANGED
annotation against them. Even when the artifact schema is valid, it rejects:

- an annotation whose source fingerprint, README path/OID, or canonical metadata
  hash does not match the recomputed current job (stale or invented);
- a head `dataset_sha256` that is not the current canonical SHA;
- an annotation for a `node_id` not in the canonical dataset, or a prune of one
  still present;
- an `executor_kind` / `execution_profile_version` / `prompt_version` that does
  not match configuration;
- a changed-annotation delta larger than one run's budget (`max_total_per_run`).

It also re-checks artifact integrity (schema + exact meta hash), so it stands
alone. The README discovery target always comes from the trusted dataset, never
from the untrusted PR, so a hostile PR cannot direct it to fetch arbitrary repos.
Like the structural gate it runs on `pull_request_target`, checks out the
protected base, fetches the head as data, and never executes PR code; unlike it,
it uses the read-only workflow `GITHUB_TOKEN` for README discovery, so it lives in
a SEPARATE workflow to keep the structural gate secret-free.

**Both checks are required.** `verify-agent-artifacts` and `verify-ai-provenance`
must both be configured as required status checks on `main` (a repository ruleset
/ branch-protection setting that CANNOT be enforced from repository code). Neither
may be skipped on an AI-artifact PR.

**One-time workflow bootstrap.** The PR that first introduces
`ai-provenance.yml` cannot run that workflow as a required `pull_request_target`
check: GitHub correctly executes only the protected base revision, which does not
yet contain either the workflow or the trusted CLI command. That bootstrap PR
must contain no public AI artifacts, pass the existing structural gate and
`pnpm p3-gate`, and receive human review. After it merges, open a source-only PR
to register a green `verify-ai-provenance` check, add it to the `main` ruleset,
and only then enable an executor to create artifact PRs.

**Merge rules.** A successful new candidate adds an annotation; a successful
refresh replaces the matching one; a refresh with no candidate retains the
previous valid annotation; a removed star prunes its annotation; an unchanged
annotation stays byte-identical (a no-op keeps its original `generated_at`); an
invalid candidate changes nothing. The deterministic assembler and provenance
gate reject timestamp-only or metadata-only artifact updates, so an unchanged run
produces no churn.

**Publication.** Remote Git remains the publication boundary: valid PR → structural
gate → provenance gate → human review → merge. The Pages workflow stages the AI
artifacts into the deployed site FAIL-SOFT — a missing, malformed, or
hash-mismatched pair is skipped, never blocking the canonical deployment — and a
merge that changes the artifacts triggers a Pages deploy of the merged commit.
Auto-merge stays disabled in v1.

**Operational state.** The `starledger-ai-state` branch (`classifier-state.json`)
is written ONLY by the trusted `ai-state.yml` workflow, never by an executor: it
runs the deterministic planner with `--save-state` on the protected default
branch, refreshing the README path/OID cache, pruning stars that left the dataset,
and commit-on-change pushing the result. The executor only READS this state to
plan. An unclassified repository is always re-planned within budget, so a job is
never silently dropped; v1 does not yet increment per-attempt backoff, because
precise attempt counting needs run-outcome observation a trusted reconstruction
cannot derive from canonical data alone.

## P3.4 — dashboard AI enrichment

P3.4 surfaces the published annotations in the dashboard as an OPTIONAL, fail-soft
layer loaded AFTER the canonical dataset. Canonical loading stays fail-closed; AI
loading never blocks it.

`data/load-annotations.ts` mirrors the canonical loader (meta → sha-busted content
→ verify bytes → parse), but resolves to `null` on ANY problem — a missing,
malformed, mis-hashed, or schema-invalid artifact (LOAD-2/3/4). It validates BOTH
files against the SHARED contract via the crypto-free `@starred/ai-schema/contracts`
entrypoint (`AiAnnotationsMetaSchema` + `AiAnnotationsSchema`), so the browser
enforces the exact published contract with zero drift and no `node:crypto`.

Annotations join the canonical repositories ONLY by `node_id`: an orphan
annotation is ignored, an unannotated repository stays fully visible, and AI never
overrides a canonical field (JOIN-1..4). The AI layer adds:

- a category filter and an AI-tag filter (OR within a facet, AND across facets),
  surfaced only when valid annotations exist, with `category=` / `aiTag=` URL
  parameters that round-trip (deduplicated, sorted);
- AI category, tags, and summary folded into the existing lexical search;
- a per-card secondary, clearly-labelled "AI-generated" summary, category badge,
  tags, and generated date — the GitHub description stays primary and is never
  replaced;
- an "N of M AI-enriched" coverage count, so partial coverage looks intentional.

Publication is already handled by P3.3's fail-soft `stageAiArtifacts`: the Pages
build contains the AI files when present (DEPLOY-1) and a canonical-only build
remains valid when they are absent (DEPLOY-2).

## P3.5 — closeout and the semantic-search decision

P3.5 delivers the semantic-search ADR and validates live artifact publication;
the final operational closeout remains pending.
Required P3 search is lexical over name, GitHub description, topics, language, and
the AI category/tags/summary. True vector search is DEFERRED
to a future hosted phase unless a client-side experiment proves it adds relevance
with no secret/backend and acceptable size + latency — see
`docs/adr/ADR-001-semantic-search.md`. Deferral is a valid, successful outcome.

**Live artifact publication is validated.** Three manually started Claude Routine
runs produced and merged PRs #17, #18, and #20. Each changed only the public
artifact pair, passed CI plus the structural and provenance gates, and deployed
through Pages. The public artifact bytes and metadata hashes were verified against
`main`; the current published coverage is five annotations out of 492 canonical
repositories. The third run exercised the configured `max_total_per_run: 3`
budget without exceeding it.

**Final operational closeout remains pending.** `verify-ai-provenance` remains
required alongside `verify-agent-artifacts` and CI on `main`. Continue bounded,
manual backfill with exactly one executor enabled. Before P3 is fully closed,
visually confirm the public dashboard's category/tag facets and secondary summary,
then run the executor unchanged after the current collection is fully accounted
for and prove it produces neither an artifact PR nor byte churn. Existing fixture
and no-op tests support this behavior but do not replace the required live replay.

`pnpm p3-gate` is the aggregate gate: typecheck, lint, format, the full test suite
(AI schema drift, fingerprint/planner, injection fixtures, structural + provenance
gates, real-Git artifact smokes, dashboard canonical-only AND AI-enabled suites),
build, and generated-schema drift.

## P3 exit conditions

The contract, gate, and implementation conditions below are met and tested. Live
artifact publication is also verified; the visible-dashboard check and no-churn
replay remain pending the operational closeout above.

- canonical stars remain untouched by AI;
- jobs are generated only by trusted deterministic code;
- agent candidates are schema- and provenance-bound;
- classification is incremental and budgeted;
- stale or invented candidates cannot merge;
- previous annotations survive a refresh failure;
- the dashboard works fully without AI (fail-soft) and fails closed only on
  canonical data;
- public AI artifact deployment is hash-verified against `main`;
- live AI facets, secondary summaries, and AI-aware search still need visual
  confirmation on the public dashboard;
- an unchanged live run produces no artifact churn after bounded backfill;
- semantic search is explicitly deferred by ADR-001 (lexical search shipped).

## Subsequent milestones

- **P3.1 (delivered):** preferred README discovery, untrusted preprocessing,
  per-repo source fingerprints, bounded job planning, and a dedicated
  `starledger-ai-state` operational-state branch.
- **P3.2 (delivered):** shared versioned prompt, executor reconciliation (partial
  sets, executor binding, no-smuggle), and the Claude Routine / Codex Automation
  runbook. Candidate generation only — no API adapter, no model call in CI.
- **P3.3 (delivered):** the `verify-ai-provenance` gate, fail-soft Pages
  publication of the merged commit, and operational-state persistence on the
  `starledger-ai-state` branch.
- **P3.4 (implementation delivered):** fail-soft AI loading with strict contract
  validation, node-id join, category/AI-tag facets with URL state, AI-aware lexical
  search, secondary labelled card summaries, and a coverage count.
- **P3.5 (ADR and live artifact publication delivered; final closeout pending):**
  vector search is deferred and lexical search shipped. Three validated Claude
  Routine artifact PRs have merged and deployed five annotations under bounded
  budgets. Public dashboard visual confirmation and the post-backfill no-churn
  replay remain pending.
