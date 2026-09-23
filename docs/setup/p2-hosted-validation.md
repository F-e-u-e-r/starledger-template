# P2.5 — Hosted notifier validation runbook

Operationalizes the **Live validation** gate in
[`docs/P2-notifier-spec.md`](../P2-notifier-spec.md) (steps 1–4): prove the
hosted notifier cold-starts silently, delivers exactly one Telegram message for
one new repo, and never re-delivers on replay. Every step here is run **by the
operator** — it creates a fixture repo, commits a temporary config to `main`, and
sends real Telegram messages.

Two safety choices baked in:

- **Isolated state branch.** The config below uses `state.branch:
starledger-validation-state`, so production's `starledger-state` (the live
  `maguowei/awesome-stars` baseline) is never touched.
- **Temporary, reverted.** The fixture repo, the `main` config, and the
  validation state branch are all removed in step 6.

> Why `main`: `notify.yml` checks out `main` and loads `config/notifier.yaml`
> only from there (falling back to `maguowei/awesome-stars` when absent). A branch
> or local file is not seen by a dispatched run.

## 0. Preflight

```bash
gh secret list --repo F-e-u-e-r/starledger   # expect STAR_SYNC_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

The hourly schedule fires at **:17**. Run the sequence in one sub-hour window away
from :17. An interleaved scheduled run is dedupe-safe (it shares this config and state
branch) but could _consume_ the Run-2 delivery — so do Run 1 → add URL → Run 2
promptly, and in step 4 check `gh run list` for a `schedule` event.

> macOS `base64` emits a single line (used below). On Linux use `base64 -w0`.

## 1. Create the fixture repo (baseline: no repo URLs)

```bash
gh repo create F-e-u-e-r/starledger-discovery-fixture --public \
  --description "StarLedger notifier P2.5 validation fixture (temporary)" --add-readme

sha=$(gh api repos/F-e-u-e-r/starledger-discovery-fixture/contents/README.md --jq .sha)
gh api repos/F-e-u-e-r/starledger-discovery-fixture/contents/README.md -X PUT \
  -f message="baseline: no repositories" \
  -f content="$(printf '# StarLedger discovery fixture\n\nTemporary fixture for P2.5 notifier validation. Baseline: no repositories.\n' | base64)" \
  -f sha="$sha" -f branch=main
```

The baseline README contains **no** `github.com/<owner>/<repo>` URL, so the cold
start records an empty seen-set.

## 2. Point the notifier at the fixture (commit config to `main`)

Create `config/notifier.yaml`:

```yaml
# TEMPORARY — P2.5 hosted validation only. Removed in step 6.
youtube:
  channels: []
awesome_stars:
  repository: F-e-u-e-r/starledger-discovery-fixture
  ref: main
  paths:
    - README.md
state:
  branch: starledger-validation-state # isolate from production starledger-state
  file: notifier-state.json
  remote: origin
telegram:
  disable_web_page_preview: true
```

```bash
git switch main && git pull
git add config/notifier.yaml
git commit -m "test(notifier): P2.5 hosted validation config (temporary)"
git push origin main
```

## 3. Run 1 — baseline (expect: no delivery)

```bash
gh workflow run notify.yml --repo F-e-u-e-r/starledger
sleep 5; gh run list --workflow=notify.yml -L 3
gh run watch <run-id>     # or: gh run view <run-id> --log
git fetch origin starledger-validation-state
git show origin/starledger-validation-state:notifier-state.json
```

Assert: run **exit 0**; **no** Telegram message; state shows
`awesome_stars.initialized: true`, `pending: []`, `deliveries: []`.

## 4. Add one URL → Run 2 — deliver (expect: exactly one Telegram)

```bash
sha=$(gh api repos/F-e-u-e-r/starledger-discovery-fixture/contents/README.md --jq .sha)
gh api repos/F-e-u-e-r/starledger-discovery-fixture/contents/README.md -X PUT \
  -f message="add one repo" \
  -f content="$(printf '# StarLedger discovery fixture\n\nValidation: one repository.\n\n- https://github.com/octocat/Hello-World\n' | base64)" \
  -f sha="$sha" -f branch=main

gh workflow run notify.yml --repo F-e-u-e-r/starledger
sleep 5; gh run list --workflow=notify.yml -L 3   # confirm the newest run is event=workflow_dispatch
gh run watch <run-id>
git fetch origin starledger-validation-state
git show origin/starledger-validation-state:notifier-state.json
```

Assert: **one** Telegram message for `octocat/Hello-World`; run exit 0;
`deliveries` gains exactly one
`{ notification_key: "awesome_stars:octocat/hello-world:<node_id>", status: "sent" }`;
`pending: []`; `awesome_stars.last_commit_sha` advanced. (If a `schedule`-event
run appears here and already delivered it, that's still correct — to observe the
delivery in a dispatch run, add a second URL and re-dispatch.)

## 5. Run 3 — replay (expect: no duplicate)

```bash
gh workflow run notify.yml --repo F-e-u-e-r/starledger
sleep 5; gh run watch <run-id>
git fetch origin starledger-validation-state
git show origin/starledger-validation-state:notifier-state.json
```

Assert: **no** Telegram message; the run logs `state unchanged`; exit 0; state is
identical to step 4 (still one `sent` record).

### Validation checklist

```text
[ ] Run 1 — no send; initialized:true; pending:[]; deliveries:[]
[ ] Run 2 — exactly one Telegram; one sent record; last_commit_sha advanced
[ ] Run 3 — no duplicate; state unchanged
[ ] pending empty throughout
[ ] no secret / raw token / chat id printed in any Actions log
```

> Optional (spec step 5 — fatal path is loud): add a second URL, set
> `TELEGRAM_CHAT_ID` to an unreachable chat, dispatch once → a single **exit 10**
> that persists nothing (`last_commit_sha` does not advance); then restore the
> secret. See [`docs/P2-notifier-spec.md`](../P2-notifier-spec.md).

## 6. Rollback (restore production)

```bash
git switch main && git pull
git rm config/notifier.yaml
git commit -m "test(notifier): remove P2.5 validation config"
git push origin main                                   # notifier returns to maguowei default

git push origin --delete starledger-validation-state    # drop isolated validation state
gh repo delete F-e-u-e-r/starledger-discovery-fixture --yes   # or: gh repo edit ... --visibility private
```

The `notify.yml` schedule was never changed; production resumes on
`starledger-state` against `maguowei/awesome-stars`.

## Part 4 — record P2 complete (docs PR, after steps 1–5 pass)

The validation **method** is already documented in the P2 spec; only the
**status** changes. Two edits, then `pnpm format:check` (docs-only):

- `README.md` P2 row — replace
  `implementation complete (P2.5 closure); hosted Telegram delivery + replay validation pending`
  with
  `✅ complete — hosted Telegram delivery + no-duplicate replay validated via a controlled fixture source`.
- `docs/P2-notifier-spec.md` → **Implementation status** → P2.5 bullet — replace
  `**Live controlled delivery + no-duplicate replay on hosted Actions remains the final validation before P2 is marked complete.**`
  with
  `**Hosted validation complete (YYYY-MM-DD): a controlled fixture source proved cold-start baseline (no send), single delivery, and no-duplicate replay on hosted Actions.**`

## Part 5 — tag (after the Part 4 docs merge)

```bash
git switch main && git pull
git tag -a v1.2.0-alpha.2 -m "P2 hosted notifier validation + P4 template status docs"
git push origin v1.2.0-alpha.2
```

Release note:

> P2 hosted notifier validation: Telegram delivery and no-duplicate replay
> verified with a controlled fixture source. P4 template status docs updated after
> hosted clean-room validation.
