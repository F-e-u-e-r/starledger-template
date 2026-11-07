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

Both gates run on `pull_request_target` from the trusted default branch, fetch the
PR head **as data only**, and never execute PR code. **Keep auto-merge disabled**
initially and merge manually after reviewing the artifact.

### Actions event policy for the gates (public repositories)

In **public** repositories GitHub provides a default Actions event policy that
blocks `pull_request_target` unless an applicable Actions event policy explicitly
allows it; private and internal repositories are not affected. Where the default
is enforced, a blocked gate run fails without executing, so neither required
check can pass. GitHub's
[Securely using `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
page has the current enforcement status.

Repositories created from `starledger-template` inherit repository files, not
instance-specific GitHub Actions policy configuration: a policy set on the
template repository does not carry over. Configure your own:

1. In your repository, open **Settings → Actions → Policies** and create a new
   policy.
2. Set its enforcement status to **Active**.
3. Target only `.github/workflows/ai-agent-pr.yml` and
   `.github/workflows/ai-provenance.yml`.
4. Under **Restrict events**, allow only `pull_request_target`.

Keep it that narrow: never target all workflows (`~ALL`, or no workflow
targeting), allow all events, or add a broad repository-wide exception. If an
organization or enterprise policy that applies to your repository already allows
these two workflows on `pull_request_target`, a duplicate repository-level
policy may not be necessary; verify the effective policy rather than assuming.

The policy only lets the gates run; their trust model is unchanged. The workflow
definition comes from the repository's protected default branch, each gate job
checks out the trusted `base.sha`, the PR head is fetched as data only and never
checked out or executed, the token is limited to `contents: read`, and no
repository secret is used (the provenance gate reads READMEs with that read-only
`GITHUB_TOKEN`). Do not switch the gates to `pull_request` as a workaround: the
PR's own copy of the workflow would then run, so a PR could rewrite the gate
that judges it.

Before relying on `verify-agent-artifacts` and `verify-ai-provenance`, verify the
effective configuration: open a pull request and confirm both checks run and
pass. While GitHub only evaluates the default policy, gate runs continue even
without a matching policy, so a passing run alone does not prove the policy is
right; where available, also review the **Policy insights** page (under
**Policies** in the sidebar) for gate runs that were, or would have been,
blocked. GitHub docs:
[About Actions policies](https://docs.github.com/en/actions/concepts/about-actions-policies),
[Governing execution of GitHub Actions workflows](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution).

## Interlock

While `ai.enabled: false`, the planner writes an **empty** manifest and the
provenance gate **rejects** any attempted artifact publication — so a
disabled-but-present AI layer cannot leak annotations. Deterministic validation
commands remain safe to run regardless.

Contract: [`docs/P3-ai-spec.md`](../P3-ai-spec.md) and the executor runbook
[`docs/P3.2-executor-runbook.md`](../P3.2-executor-runbook.md). Troubleshooting:
[`troubleshooting.md`](./troubleshooting.md).
