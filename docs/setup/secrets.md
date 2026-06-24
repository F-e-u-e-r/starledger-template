# Secrets

StarLedger has **no central key custody**. Every secret is created and owned by
you, stored as a GitHub Actions repository secret (Settings → Secrets and
variables → Actions), and read from the environment at runtime. No secret is ever
committed to a tracked file. `pnpm setup:doctor` reports which of these are
present without printing their values.

## Required — exporter + dashboard (P0/P1)

### `STAR_SYNC_TOKEN`

Reads your GitHub stars and public repo metadata.

Recommended: a **fine-grained PAT**, scoped as tightly as possible.

```text
Resource owner:        your account
User permissions:
  - Starring:          Read-only        (enumerate your stars)
Repository access:
  - Only your StarLedger repo
Repository permissions:
  - Metadata:          Read-only        (always required by GitHub)
  - Contents:          Read and write   ONLY if the exporter workflow commits
                                         stars.json with this token
```

In the shipped `sync-stars.yml` the commit is pushed with the workflow's built-in
`GITHUB_TOKEN`, **not** `STAR_SYNC_TOKEN` — so `STAR_SYNC_TOKEN` can stay
**read-only** (no `Contents: write`). Grant `Contents: write` to the PAT only if
you change the workflow to push with it.

> `STAR_SYNC_TOKEN` is **not** an AI model key and **not** a shared StarLedger
> service key. It only reads your stars.

The notifier reuses `STAR_SYNC_TOKEN` for public GitHub reads (`Contents:
read-only` is enough there).

## Required — Telegram notifier (P2, optional feature)

| Secret               | What it is                                           |
| -------------------- | ---------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather). |
| `TELEGRAM_CHAT_ID`   | Destination chat id (a user, group, or channel).     |

Optional, opt-in smoke test:

| Variable           | Effect                                                      |
| ------------------ | ----------------------------------------------------------- |
| `TELEGRAM_SMOKE=1` | Lets `pnpm smoke:telegram` send one real test-chat message. |

Without both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` the notifier exits
fatally (`MissingTelegramCredentialsError`) — which is why the template ships the
notify workflow as manual-dispatch only. See [`notifier.md`](./notifier.md).

## Optional — Claude Routine / Codex Automation (P3 AI)

**Do not store Claude/Codex subscription auth in this repo.** The executor runs
**outside** StarLedger:

- The Claude Routine / Codex Automation uses **its own platform-side GitHub
  access** to open a `claude/*` (or equivalent) artifact PR.
- StarLedger only **receives** the resulting `ai-annotations.json` PR and gates
  it with `verify-agent-artifacts` + `verify-ai-provenance`.

So there is no AI model key to add as a repository secret. See
[`ai-executor.md`](./ai-executor.md).

## Not required (by design)

```text
AI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY   — no model is called in CI
central OAuth client secret                        — there is no shared OAuth
shared database credential                          — there is no shared database
a StarLedger service key                            — there is no hosted service
```

## Quick verification

```bash
pnpm setup:doctor                    # checks local setup + STAR_SYNC_TOKEN / stars read
pnpm setup:doctor --github-actions   # explicit GitHub-only check
pnpm setup:doctor --telegram         # validates the bot token / chat when notifier on
pnpm setup:doctor --ai               # AI config + artifact-pair sanity
```
