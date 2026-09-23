# P4 — Template Artifact Inventory

The authoritative classification of every path in this repo into **ships**
(reusable, goes into `starledger-template`) vs. **never ships** (personal data,
generated artifacts, or operational state). The template builder
([`packages/template-builder`](../packages/template-builder)) implements this as
an **allowlist** — only listed paths are copied — so anything not explicitly
allowed is excluded by default. The setup doctor's `--template-clean` mode
verifies the "never ships" set is absent.

> Exit condition for this document: a reviewer can tell exactly what is personal
> data, what is reusable code, and what must never be copied.

## Never ships — personal data and generated artifacts

These are produced by the running deployment. They are user-specific and must be
regenerated from scratch by the template user's own first run.

| Path                                           | What it is                                                | Why excluded                                               |
| ---------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `stars.json`                                   | The maintainer's canonical starred-repo dataset (~600 KB) | Personal data. Recreated by the user's first `Sync stars`. |
| `dataset-meta.json`                            | Fingerprint of `stars.json`                               | Bound to the maintainer's dataset.                         |
| `ai-annotations.json`                          | AI category/tag/summary artifacts                         | Personal + executor-generated.                             |
| `ai-annotations-meta.json`                     | Fingerprint of the annotations                            | Bound to the maintainer's annotations.                     |
| `run-meta.json`, `ai-run-meta.json`            | Per-run telemetry                                         | Already git-ignored; per-execution, never committed.       |
| `.ai-runs/`                                    | Scratch manifests from planner runs                       | Already git-ignored; ephemeral.                            |
| `notifier-state.json`, `classifier-state.json` | Delivery / classifier operational state                   | User-specific state; normally branch-resident.             |
| `discovery-candidates.json`                    | Generated discovery candidate artifacts                   | Personal data. Recreated by user's first discovery run.    |
| `discovery-candidates-meta.json`               | Fingerprint of the discovery candidates                   | Bound to the maintainer's candidates.                      |

## Never ships — tracked personal _configuration_

These are committed to `main` (they are **not** git-ignored) and therefore are
the easiest to leak by accident. The allowlist ships only `*.example.yaml`, so
the live configs below are excluded — but they are called out explicitly because
a denylist or manual copy would ship them.

| Path                   | Risk                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `config/ai.yaml`       | The maintainer's **live** AI config (`ai.enabled: true`). Ships only as `config/ai.example.yaml` (disabled, budget 1). |
| `config/notifier.yaml` | Live notifier config if present. Ships only as `config/notifier.example.yaml`.                                         |
| `config.yaml`          | Live exporter config (git-ignored). Ships only as root `config.example.yaml`.                                          |
| `.env*`                | Local secrets and environment configuration (git-ignored).                                                             |

No secret value (`STAR_SYNC_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
Claude/Codex executor auth) is stored in any tracked file — all are read from the
environment / GitHub Actions secrets. See [`docs/setup/secrets.md`](./setup/secrets.md).

## Never ships — branch-resident operational state

This state lives on dedicated branches, **not** in the working tree of `main`.
The builder exports from a `main` checkout, so it never sees these; they must not
be recreated in the template.

| Branch                | Contents                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `starledger-state`    | Notifier state (`notifier-state.json`): delivery log, pending queue.                         |
| `starledger-ai-state` | Classifier operational state (`classifier-state.json`): README OID cache, retry bookkeeping. |

Also excluded implicitly: GitHub Pages deployment history, the maintainer's PR /
branch history, and the `gh-pages`/Pages environment.

## Ships — reusable code, schemas, and examples

| Path                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/`                                                                                     | All workspace packages (minus `node_modules/`, `dist/`, `*.tsbuildinfo`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/dashboard/`                                                                               | The static dashboard (minus `node_modules/`, `dist/`, `.vite/`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `schemas/`                                                                                      | Generated JSON Schemas (deterministic, regenerable via `pnpm schemas`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `prompts/`                                                                                      | `classify-agent-v1.md` — the executor prompt contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `.github/workflows/`                                                                            | CI/CD workflows, transformed for the template. `sync-stars.yml`, `notify.yml`, and `ai-state.yml` are emitted **dispatch-only** (schedules commented out). Parent-only workflows are **never emitted** — `template-smoke.yml` (needs `README.template.md`), `ai-stall-watch.yml`, `p3-completion-check.yml`, `public-pat-smoke.yml` (they run `scripts/`, which the allowlist excludes) — see `EXCLUDE_WORKFLOWS`. Inside the emitted workflows, any step annotated with the comment `# template-builder: omit` is removed (in `ci.yml`: the notifier smokes and the AI stall-watch smoke); a malformed or orphaned marker fails the build. |
| `docs/`                                                                                         | Specs + setup guides. Personal P0–P3 notes are reusable architecture docs and ship as-is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `config/*.example.yaml`                                                                         | `ai.example.yaml`, `notifier.example.yaml`, `template.example.yaml`, `discovery-inbox.example.yaml`, `discovery-decisions.example.yaml`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `config.example.yaml` (repo root)                                                               | **Exporter** example config. Easy to miss — it is at the root, not under `config/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`                                         | Workspace definition + frozen lockfile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tsconfig*.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore` | Tooling config.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `.gitignore`, `.npmrc`, `.nvmrc`, `LICENSE`                                                     | Repo hygiene + license.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `README.template.md` → `README.md`                                                              | The template's onboarding README replaces the personal one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Excluded build/tooling output

`node_modules/`, `**/dist/`, `**/coverage/`, `**/.vite/`, `*.tsbuildinfo`,
`.DS_Store`, `*.swp`, and `.git/` are excluded everywhere. The template ships
source + lockfile; the user runs `pnpm install` to rebuild.

## Verification

```bash
pnpm template:build --out ../starledger-template   # regenerate
pnpm setup:doctor --template-clean                 # assert "never ships" absent here is N/A;
                                                   # run inside the OUTPUT to confirm clean
```

Inside the generated template, `pnpm setup:doctor --template-clean` must exit `0`
with no personal artifact and no live config present.
