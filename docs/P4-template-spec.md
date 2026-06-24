# P4 — `starledger-template` Specification

StarLedger P4 packages the personal deployment into a **sanitized, reusable
template** so a new user can deploy their own GitHub stars dashboard, notifier,
and optional AI enrichment without inheriting the maintainer's data, secrets, or
state. P4 adds **no product features** — it is packaging, sanitization, setup
validation, and clean-room onboarding.

## Trust model (preserved, not extended)

The template must keep StarLedger's invariant that nothing is centrally
custodied:

```text
User-owned repo
User-owned GitHub token        (STAR_SYNC_TOKEN, fine-grained, read-only stars)
User-owned Telegram bot / chat (optional notifier)
User-owned Claude/Codex executor (optional AI; runs OUTSIDE this repo)
No central key custody
No shared OAuth backend
No shared database
No hosted SaaS dependency
```

**Non-goals.** P4 does not add central OAuth, a shared backend/database, a shared
Telegram bot or GitHub App, auto-merge by default, NotebookLM/Threads/X watchers,
or a Telegram command bot. Those belong to later milestones.

## P4.0 — Two-repo strategy

```text
F-e-u-e-r/starledger           = personal production deployment (this repo)
F-e-u-e-r/starledger-template  = clean reusable starter (generated from here)
```

The personal repo already holds real stars, AI artifacts, state branches, and
deployment history. A template must start clean — examples and setup checks, not
production data. The template is **generated deterministically** from this repo
by `pnpm template:build` (see [`packages/template-builder`](../packages/template-builder));
it is never hand-copied, so it cannot drift from source.

## What ships vs. what never ships

The authoritative allowlist/denylist is
[`docs/P4-template-inventory.md`](./P4-template-inventory.md) and is enforced in
code by the template builder's allowlist. Summary:

| Ships (reusable)                                             | Never ships (personal / generated)                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `packages/`, `apps/`, `schemas/`, `prompts/`                 | `stars.json`, `dataset-meta.json`                                      |
| `.github/workflows/` (schedules neutralized — see below)     | `ai-annotations.json`, `ai-annotations-meta.json`                      |
| `docs/`, `config/*.example.yaml`, root `config.example.yaml` | `run-meta.json`, `.ai-runs/`, `config/ai.yaml`, `config/notifier.yaml` |
| `package.json`, lockfile, workspace + tooling config         | `starledger-state` / `starledger-ai-state` branch data                 |
| `README.template.md` → `README.md`                           | real Telegram ids, PATs, executor tokens, Pages history                |

## User paths

### Path A — GitHub template

```text
"Use this template" → create <username>/starledger
→ add STAR_SYNC_TOKEN secret
→ enable GitHub Pages (source = GitHub Actions)
→ run the "Sync stars" workflow (manual dispatch)
→ stars.json + dataset-meta.json are committed → dashboard deploys
```

### Path B — Fork

```text
Fork starledger-template → rename if desired
→ add secrets → enable workflows
→ pnpm setup:doctor → fix what it reports
→ run "Sync stars"
```

Either path: **run `pnpm setup:doctor` first** to learn exactly what is missing
before enabling anything.

## Required GitHub settings

| Setting                     | Value                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Actions                     | Enabled                                                                               |
| Pages source                | GitHub Actions                                                                        |
| Workflow permissions        | Read **and write** (the exporter commits `stars.json`)                                |
| Allow Actions to create PRs | Only if an in-repo workflow opens PRs; external executors use their own GitHub access |
| Branch protection / ruleset | Protect `main`                                                                        |

For AI-enabled users the required PR checks are the existing job names:

```text
verify-agent-artifacts   (.github/workflows/ai-agent-pr.yml — structural gate)
verify-ai-provenance     (.github/workflows/ai-provenance.yml — provenance gate)
verify                   (.github/workflows/ci.yml — general CI)
manual merge recommended · auto-merge disabled initially
```

## Scheduled-workflow safety (template default: manual dispatch)

In the production repo the exporter, notifier, and AI state reconciler run on a
schedule. A brand-new template repo has **no secrets yet**, so a scheduled run
would fail noisily (`sync-stars` needs `STAR_SYNC_TOKEN`; `notify` throws
without Telegram creds) or create optional AI operational state before the user
has opted in. To keep the opt-in invariant — _nothing runs until you ask_ — the
builder emits `sync-stars.yml`, `notify.yml`, and `ai-state.yml` as
**`workflow_dispatch`-only** in the template, with the original `cron:`
preserved as a comment. The user re-enables automation deliberately after
`setup:doctor` passes. `pages.yml` already guards on `hashFiles('stars.json')`,
so it remains a green no-op on a dataless repo and is shipped unchanged.

## Tooling

| Tool                                                        | Command               | Purpose                                     |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------- |
| [`packages/setup-doctor`](../packages/setup-doctor)         | `pnpm setup:doctor`   | Tells a fresh repo what is missing / unsafe |
| [`packages/template-builder`](../packages/template-builder) | `pnpm template:build` | Regenerates the template from this repo     |

Setup guides live under [`docs/setup/`](./setup): `secrets.md`,
`github-pages.md`, `notifier.md`, `ai-executor.md`, `troubleshooting.md`, and the
`clean-room-validation.md` runbook.

With no mode flags, `setup:doctor` checks both local hygiene and the deployable
core (`STAR_SYNC_TOKEN` / GitHub stars read). Optional Telegram and AI checks
are added only when `config/template.yaml` opts into those features. Use an
explicit mode such as `--local` or `--template-clean` when that narrower scope
is intended.

## Exit criteria

P4 is complete when:

1. `starledger-template` exists as a separate sanitized repo.
2. No personal artifacts are present in it.
3. A new user can create a repo from the template.
4. `setup:doctor` explains missing setup clearly.
5. `STAR_SYNC_TOKEN` / Telegram / AI executor secrets are documented separately.
6. GitHub Pages deploys from a clean repo.
7. The notifier stays disabled until explicitly configured.
8. AI stays disabled until explicitly configured.
9. The optional Claude Routine flow can open an artifact PR with **no** central
   key custody.
10. Clean-room validation passes (see
    [`docs/setup/clean-room-validation.md`](./setup/clean-room-validation.md)).
