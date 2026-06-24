# StarLedger

Your own GitHub stars **dashboard**, optional Telegram **notifier**, and optional
**AI enrichment** — deployed entirely on infrastructure you own. No central
service, no shared backend, no key custody: StarLedger only ever uses **your**
GitHub token, **your** Telegram bot, and (optionally) **your** Claude/Codex
executor.

> This is the reusable template. It ships clean — with example configs and setup
> checks, not anyone else's data. Generated from
> [`F-e-u-e-r/starledger`](https://github.com/F-e-u-e-r/starledger) by
> `pnpm template:build`.

## Quick start

1. **Create your repo** — click **Use this template** (or fork), making
   `<you>/starledger`.
2. **Add the token** — create a fine-grained PAT with **Starring: Read-only** and
   add it as the `STAR_SYNC_TOKEN` Actions secret.
   See [`docs/setup/secrets.md`](docs/setup/secrets.md).
3. **Enable Pages** — Settings → Pages → Source = **GitHub Actions**; Settings →
   Actions → Workflow permissions = **Read and write**.
   See [`docs/setup/github-pages.md`](docs/setup/github-pages.md).
4. **Check readiness:**

   ```bash
   pnpm install        # Node >= 22
   pnpm setup:doctor   # tells you exactly what is missing (0 ready · 20 incomplete · 10 unsafe)
   ```

5. **Deploy** — Actions → **Sync stars** → _Run workflow_. The exporter commits
   `stars.json` + `dataset-meta.json`, and Pages publishes your dashboard at
   `https://<you>.github.io/starledger/`.

## What you get

| Feature                 | Default | Enable                                                                                                           |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Stars dashboard (P0/P1) | **on**  | Just run _Sync stars_.                                                                                           |
| Telegram notifier (P2)  | off     | Add Telegram secrets + `config/notifier.yaml` — [`docs/setup/notifier.md`](docs/setup/notifier.md).              |
| AI enrichment (P3)      | off     | `config/ai.yaml` + an external Claude/Codex executor — [`docs/setup/ai-executor.md`](docs/setup/ai-executor.md). |

Scheduled automation is **disabled by default** in the template: the `Sync stars`,
`Notify`, and optional `AI operational state` workflows ship as manual-dispatch
only (their `cron:` is preserved as a comment) so nothing runs before you have
added secrets and explicitly enabled the matching feature. Re-enable them
deliberately once `setup:doctor` passes.

## Trust model

```text
User-owned repo · user-owned GitHub token · user-owned Telegram bot/chat
Optional user-owned Claude/Codex executor (runs OUTSIDE this repo)
No central key custody · no shared OAuth · no shared database · no hosted SaaS
```

No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / OAuth secret / database credential is
ever required. The AI model never runs in CI — an external executor opens an
artifact PR that the in-repo provenance gates verify.

## Setup guides

- [`docs/setup/secrets.md`](docs/setup/secrets.md) — which secrets, why, safe permissions
- [`docs/setup/github-pages.md`](docs/setup/github-pages.md) — Pages + first deploy
- [`docs/setup/notifier.md`](docs/setup/notifier.md) — Telegram notifier
- [`docs/setup/ai-executor.md`](docs/setup/ai-executor.md) — optional AI enrichment
- [`docs/setup/troubleshooting.md`](docs/setup/troubleshooting.md) — common failures
- [`docs/setup/clean-room-validation.md`](docs/setup/clean-room-validation.md) — full zero-to-deploy checklist

Architecture specs: [`docs/P0-exporter-spec.md`](docs/P0-exporter-spec.md) ·
[`docs/P1-dashboard-spec.md`](docs/P1-dashboard-spec.md) ·
[`docs/P2-notifier-spec.md`](docs/P2-notifier-spec.md) ·
[`docs/P3-ai-spec.md`](docs/P3-ai-spec.md) ·
[`docs/P4-template-spec.md`](docs/P4-template-spec.md).

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
