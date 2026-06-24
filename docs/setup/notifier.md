# Notifier (Telegram)

The notifier (P2) polls discovery sources (YouTube channels, `awesome-stars`) and
delivers new items to Telegram exactly once. It is **off by default** in the
template: the `notify` workflow ships as manual-dispatch only, and without
Telegram secrets the CLI exits fatally rather than half-running.

## Enable

1. Set `features.notifier.enabled: true` in `config/template.yaml` (copied from
   [`config/template.example.yaml`](../../config/template.example.yaml)) so the
   doctor checks Telegram setup.
2. Add the secrets (see [`secrets.md`](./secrets.md)):
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `STAR_SYNC_TOKEN` (public reads).
3. Copy + edit config:

   ```bash
   cp config/notifier.example.yaml config/notifier.yaml
   ```

   Set your `youtube.channels` (the `channel_id` from
   `https://www.youtube.com/feeds/videos.xml?channel_id=...`). The example ships
   with an empty channel list and `maguowei/awesome-stars` as a sample source —
   change or remove it. No chat id or token goes in this file; those are env-only.

4. Validate before sending anything real:

   ```bash
   pnpm setup:doctor --telegram     # bot token + chat reachable?
   TELEGRAM_SMOKE=1 pnpm smoke:telegram   # opt-in: sends ONE test message
   ```

5. Re-enable automation. The template's `notify.yml` is dispatch-only; restore
   the hourly schedule by uncommenting the `cron:` line the builder preserved,
   then run it once manually first.

## Delivery guarantees

State (delivery log + pending queue) lives on the dedicated `starledger-state`
branch and is committed only when it changes — never on `main`. Delivery is
**at-least-once**: a successful send followed by a crash before the state push
can resend once on recovery. A pending item still failing after
`retry.attention_after_attempts` is surfaced as `attention` telemetry but never
auto-dropped.

Exit codes: `0` clean · `20` deferred (retryable failure left work pending, or a
new permanent failure surfaced once) · `10` fatal (missing/invalid GitHub or
Telegram credential, bad destination, or invalid config/state).

Contract: [`docs/P2-notifier-spec.md`](../P2-notifier-spec.md). Troubleshooting:
[`troubleshooting.md`](./troubleshooting.md).
