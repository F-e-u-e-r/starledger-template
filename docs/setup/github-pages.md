# GitHub Pages

The dashboard is a static Vite/React site deployed by GitHub Actions
([`.github/workflows/pages.yml`](../../.github/workflows/pages.yml)). There is no
server and no `gh-pages` branch — the build is uploaded as a Pages artifact and
deployed with `actions/deploy-pages`.

## One-time settings

| Setting (Settings → …)                   | Value                   |
| ---------------------------------------- | ----------------------- |
| Pages → Build and deployment → Source    | **GitHub Actions**      |
| Actions → General → Workflow permissions | **Read and write**      |
| Actions → General                        | Allow Actions (enabled) |

`Read and write` is required because `sync-stars.yml` commits the refreshed
`stars.json` back to the repo with the built-in `GITHUB_TOKEN`.

## First deploy

`pages.yml` has a **guard** job: if `stars.json` + `dataset-meta.json` are not
committed yet, it logs a warning and skips the build as a green no-op — it does
**not** fail. So on a fresh template the order is:

```text
1. Add STAR_SYNC_TOKEN + set Pages source = GitHub Actions.
2. Actions → "Sync stars" → Run workflow (manual dispatch).
   The exporter commits stars.json + dataset-meta.json, then calls the deploy.
3. Pages builds and deploys. The Pages URL appears in the deploy job summary.
```

The base path is derived from `GITHUB_REPOSITORY` at build time, so the site
works at `https://<user>.github.io/<repo>/` with no config.

## Re-deploys

Pages re-runs on:

- a scheduled / manual `Sync stars` run that changes the dataset, and
- a push to `main` touching `stars.json`, `dataset-meta.json`,
  `ai-annotations*.json`, `apps/dashboard/**`, `packages/**`, or `pages.yml`.

## Verify

```bash
pnpm setup:doctor --local   # confirms workflows present + dataset absent-or-valid
```

If the dashboard 404s on `stars.json` locally, that just means no dataset exists
yet — run the exporter (or `Sync stars`) first. Troubleshooting:
[`troubleshooting.md`](./troubleshooting.md).
