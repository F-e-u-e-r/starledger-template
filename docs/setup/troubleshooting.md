# Troubleshooting

Run `pnpm setup:doctor` (with the relevant `--mode`) first — it pinpoints most of
these. Exit `0` ready · `20` incomplete / needs setup · `10` invalid / unsafe.

## The GitHub token cannot read my stars

- **Symptom:** `sync-stars` fails on auth, or `--github-actions` reports the stars
  read failing.
- **Cause:** `STAR_SYNC_TOKEN` missing, expired, or lacks `Starring: Read-only`
  (user permission). A classic PAT without the right scope also fails.
- **Fix:** Create a fine-grained PAT with **User → Starring: Read-only** and
  **Metadata: Read-only**, owned by the account whose stars you sync. Add it as
  the `STAR_SYNC_TOKEN` Actions secret. See [`secrets.md`](./secrets.md).

## The workflow cannot push generated data

- **Symptom:** exporter runs but the `stars.json` commit/push fails (403).
- **Cause:** Actions workflow permissions are read-only.
- **Fix:** Settings → Actions → General → Workflow permissions → **Read and
  write**. The push uses the built-in `GITHUB_TOKEN`, so `STAR_SYNC_TOKEN` itself
  can stay read-only. See [`github-pages.md`](./github-pages.md).

## Pages is not deploying

- **Symptom:** the Pages job is skipped or the site 404s.
- **Cause:** no dataset committed yet (the guard job skips as a green no-op), or
  Pages source is not "GitHub Actions".
- **Fix:** Set Pages source = **GitHub Actions**, then run `Sync stars` once so
  `stars.json` + `dataset-meta.json` exist. The guard only builds once data is
  present. See [`github-pages.md`](./github-pages.md).

## The Telegram bot cannot send a message

- **Symptom:** notifier exits `10` (`MissingTelegramCredentialsError`) or
  `--telegram` reports the send failing.
- **Cause:** `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` missing or wrong; the bot
  was never started by the destination chat; wrong chat id sign for a channel.
- **Fix:** Recreate the token via @BotFather, send `/start` to the bot from the
  destination, and confirm the chat id (`-100…` for channels). Validate with
  `pnpm setup:doctor --telegram`, then `TELEGRAM_SMOKE=1 pnpm smoke:telegram`.

## Claude Routine can read but cannot push its branch

- **Symptom:** the executor classifies but no artifact PR appears.
- **Cause:** the external Routine/Automation lacks GitHub push access. The
  executor does not use the repository's `GITHUB_TOKEN`.
- **Fix:** Grant the executor platform-side push access to your repo. The
  Actions setting **Allow GitHub Actions to create and approve pull requests**
  applies only to workflows using `GITHUB_TOKEN`; enable it only if you later
  add such a workflow. The external executor uses its **own** auth — nothing is
  stored in this repo. See [`ai-executor.md`](./ai-executor.md).

## An AI artifact PR is blocked by the provenance gate

- **Symptom:** `verify-ai-provenance` (or `verify-agent-artifacts`) fails.
- **Cause (by design):** the annotations are stale (computed against an older
  dataset), invented (no matching trusted job), the artifact/meta pair is
  incomplete, or the branch is not an approved same-repo executor branch.
- **Fix:** Re-run the executor against the **current** `main` so fingerprints
  match, and ensure both `ai-annotations.json` and `ai-annotations-meta.json` are
  present and consistent. The gate recomputes everything from trusted base data —
  it is meant to reject these. Do **not** weaken the gate. See
  [`ai-executor.md`](./ai-executor.md).

## `setup:doctor --template-clean` exits non-zero in my deployment

- **Expected.** That mode asserts the repo is a _pristine template_ — no
  `stars.json`, `ai-annotations.json`, live `config/ai.yaml`, etc. Your running
  deployment legitimately has those. Use `--template-clean` only against freshly
  generated template output.
