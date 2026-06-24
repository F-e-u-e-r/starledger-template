# AI executor (optional)

P3 adds optional, **fail-soft** AI enrichment: category, tags, and a summary per
repo, surfaced by the dashboard when present and silently ignored when absent. It
is **off by default** and adds no model call to CI.

## Trust boundary (read this first)

The model **never runs inside this repo**. StarLedger's CI is deterministic and
secret-light; the actual classification happens in an **external, replaceable**
Claude Routine or Codex Automation that you own:

```text
ai-state.yml (trusted, in-repo)        executor (external, untrusted)         in-repo gates
─────────────────────────────         ──────────────────────────────         ─────────────
plan --save-state  ──discovers──▶  reads READMEs, classifies,        ──PR──▶  verify-agent-artifacts
READMEs (content-free OID probes)   writes ai-annotations.json                verify-ai-provenance
prunes removed stars                opens artifact PR with its OWN             (recompute from trusted
                                    platform GitHub access                     base data; reject stale/invented)
```

The executor is an **untrusted candidate producer**. Its model label is
informational only; nothing it writes is trusted until the two gates recompute
the expected jobs/fingerprints from the trusted base dataset and accept the PR.

## Enable

1. Set `features.ai.enabled: true` in `config/template.yaml`.
2. Copy + edit config:

   ```bash
   cp config/ai.example.yaml config/ai.yaml
   ```

   Set `ai.enabled: true`. Keep the **budget minimal** to start —
   `max_new_per_run: 1`, refresh/retry `0` — so you can validate exactly one
   artifact PR end to end before raising it. No API key, provider, or model is
   configured here.

3. Pick **one** executor via `ai.executor_kind` (`claude-routine` or
   `codex-automation`). The manifest is bound to one executor; do not schedule
   both — switching executor deliberately creates new job ids.
4. Configure your external Claude Routine / Codex Automation to read this repo
   and open the artifact PR. **No model key is stored here** (see
   [`secrets.md`](./secrets.md)).
5. Validate locally:

   ```bash
   pnpm setup:doctor --ai     # ai.yaml valid? artifact/meta pair consistent?
   ```

6. Re-enable the schedule only after the first artifact PR is accepted. The
   generated `ai-state.yml` is manual-dispatch only, so uncomment its preserved
   `cron:` deliberately if you want ongoing state reconciliation.

## Required PR checks (AI users)

Protect `main` and require these existing jobs on artifact PRs:

| Check                    | Workflow            | Role                                                                                        |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------- |
| `verify-agent-artifacts` | `ai-agent-pr.yml`   | Structural gate: approved same-repo executor branch + complete valid artifact pair.         |
| `verify-ai-provenance`   | `ai-provenance.yml` | Recomputes jobs/fingerprints from trusted base data; rejects stale or invented annotations. |
| `verify`                 | `ci.yml`            | General CI (typecheck/lint/test/build).                                                     |

Both gates run on `pull_request_target` from the trusted base branch, fetch the
PR head **as data only**, and never execute PR code. **Keep auto-merge disabled**
initially and merge manually after reviewing the artifact.

## Interlock

While `ai.enabled: false`, the planner writes an **empty** manifest and the
provenance gate **rejects** any attempted artifact publication — so a
disabled-but-present AI layer cannot leak annotations. Deterministic validation
commands remain safe to run regardless.

Contract: [`docs/P3-ai-spec.md`](../P3-ai-spec.md) and the executor runbook
[`docs/P3.2-executor-runbook.md`](../P3.2-executor-runbook.md). Troubleshooting:
[`troubleshooting.md`](./troubleshooting.md).
