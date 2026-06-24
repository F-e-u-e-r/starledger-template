# Clean-room validation

A clean-room test proves a brand-new repo can deploy StarLedger from zero using
**only user-owned tokens** — no personal artifact copied, no hidden dependency on
`F-e-u-e-r/starledger`, no central service key, no pre-seeded state branch. Run
this once before publishing the template and after any change to the builder
allowlist.

## A. Generate + self-check the template (local)

```bash
pnpm template:build --out ../starledger-template --verify
```

For a later regeneration into an existing `starledger-template` Git checkout,
pass `--force`. It replaces all generated files but deliberately preserves that
checkout's `.git` directory (remote, branch, and history):

```bash
pnpm template:build --out ../starledger-template --force --verify
```

`--verify` runs, inside the generated output: `pnpm install --frozen-lockfile`,
`pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm setup:doctor
--template-clean`. All must pass. Then spot-check the output:

```bash
cd ../starledger-template
pnpm setup:doctor --template-clean --offline    # exit 0
test ! -e stars.json && test ! -e ai-annotations.json && test ! -e config/ai.yaml && echo "clean"
```

The CI guard [`.github/workflows/template-smoke.yml`](../../.github/workflows/template-smoke.yml)
performs the same build-and-check on every PR touching the builder, so drift is
caught automatically.

## B. Clean-room deploy (fresh GitHub repo)

1. Create a new repo from the template (**Use this template**, or push the
   generated output to a fresh repo).
2. Add `STAR_SYNC_TOKEN` (fine-grained PAT, **Starring: Read-only**).
3. Settings → Pages → Source = **GitHub Actions**; Actions → Workflow permissions
   = **Read and write**.
4. `pnpm install && pnpm setup:doctor --github-actions` → resolve anything it
   reports.
5. Actions → **Sync stars** → _Run workflow_.
6. Confirm `stars.json` + `dataset-meta.json` were committed.
7. Confirm the Pages deploy succeeded and the dashboard loads at
   `https://<you>.github.io/<repo>/`.
8. _(Optional)_ Telegram: add secrets, `cp config/notifier.example.yaml
config/notifier.yaml`, then `pnpm setup:doctor --telegram` and
   `TELEGRAM_SMOKE=1 pnpm smoke:telegram`.
9. _(Optional)_ AI: `cp config/ai.example.yaml config/ai.yaml`, set
   `ai.enabled: true` with budget 1, wire an external Claude Routine, and let it
   open **one** artifact PR. Confirm `verify-agent-artifacts` +
   `verify-ai-provenance` pass, then merge manually.

## Must prove

```text
[ ] No personal artifact copied (stars.json / ai-annotations*.json absent until first run)
[ ] No hidden dependency on F-e-u-e-r/starledger
[ ] No central service key needed (only STAR_SYNC_TOKEN for the base deploy)
[ ] No state branch required before the first run
[ ] Dashboard works before AI
[ ] Notifier stays disabled until configured
[ ] AI stays disabled until configured
[ ] Optional Claude Routine can open an artifact PR with no central key custody
```

## C. Publish the template repo (maintainer, one-time)

These steps are **external** (they create a GitHub repo and push) and are run by
the maintainer, not by CI:

```bash
# 1. Regenerate clean output and verify.
pnpm template:build --out ../starledger-template --verify

# 2. Create the repo and push (gh CLI; or create it in the UI first).
gh repo create F-e-u-e-r/starledger-template --public \
  --description "StarLedger template: deploy your own GitHub stars dashboard."
cd ../starledger-template
git init && git add -A && git commit -m "chore(template): initial sanitized template"
git branch -M main
git remote add origin git@github.com:F-e-u-e-r/starledger-template.git
git push -u origin main

# 3. Mark it as a GitHub *template repository*.
gh repo edit F-e-u-e-r/starledger-template --template
```

Then run section **B** against a repo created from it to confirm the published
template deploys cleanly.

## D. Tag the release

After clean-room validation passes, tag (maintainer choice):

```text
v1.1.0-alpha.5            # if continuing the existing alpha line
# or
v1.2.0-alpha.1            # if P4 is the first public template milestone
```

Release note:

> StarLedger template alpha: sanitized reusable setup, setup doctor, safe config
> examples, secrets guide, and clean-room deployment validation.
