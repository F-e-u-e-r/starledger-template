# ADR-003: SHA-pin third-party GitHub Actions (S4)

- Status: Accepted
- Date: 2026-07-09
- Milestone: continuous hardening (fable review S4)

## Context

Every workflow `uses:` a third-party action by a MUTABLE ref — a major tag such
as `actions/checkout@v5` or `actions/create-github-app-token@v3`. A tag is a
movable pointer: the action's owner (or anyone who compromises them) can re-point
`v5` at new code, and our workflows would silently run it on the next trigger.

That is a supply-chain risk anywhere, but it is acute in `sync-stars.yml`, which
has `contents: write`, mints a GitHub App installation token from the App private
key via `actions/create-github-app-token`, and hands that token to
`actions/checkout` (which persists it as the git credential used to publish to
protected `main`). A malicious re-point of either action could exfiltrate the App
token / private key or push arbitrary content to `main`. `actions/deploy-pages`
and `upload-pages-artifact` control what the public site serves.

## Threat covered

Mutable action tags → the code behind a fixed ref changes without any change in
our repo. Pinning to an immutable commit SHA removes that: a given SHA is the
exact tree GitHub verified, and it cannot be re-pointed.

## Decision

1. Pin EVERY external `uses:` across `.github/workflows/*.yml` to a full 40-hex
   commit SHA, preserving the human-readable tag in a trailing comment
   (`uses: actions/checkout@93cb…bfd # v5`).
2. Add an offline static guard — `findUnpinnedActionRefs` in
   `@starred/template-builder` — plus a test that scans the repo's workflows and
   FAILS if any external action ref is not a 40-hex SHA. This runs in `pnpm test`
   (hence CI), so a future unpinned ref (or a re-introduced `@vN`) fails the gate
   rather than shipping silently. Local `./…` refs are exempt.

Pins resolved from public GitHub metadata on 2026-07-09:

| action                          | tag | commit SHA                                 |
| ------------------------------- | --- | ------------------------------------------ |
| actions/checkout                | v5  | `93cb6efe18208431cddfb8368fd83d5badbf9bfd` |
| actions/create-github-app-token | v3  | `bcd2ba49218906704ab6c1aa796996da409d3eb1` |
| actions/deploy-pages            | v5  | `cd2ce8fcbc39b97be8ca5fce6e763baed58fa128` |
| actions/setup-node              | v5  | `a0853c24544627f65ddf259abe73b1d18a591444` |
| actions/upload-artifact         | v4  | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| actions/upload-pages-artifact   | v5  | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| pnpm/action-setup               | v6  | `0ebf47130e4866e96fce0953f49152a61190b271` |

## What this does NOT change

- No workflow behavior changes — the pinned SHAs are the exact commits the tags
  pointed at, so runtime is identical.
- No change to AI budget, `max_total_per_run`, PROV-5 / provenance semantics,
  required-check semantics, or ruleset bypass behavior.

## Residual risks / update procedure

- A SHA pin is frozen: it does NOT auto-receive the action's security patches.
  Bumping is a deliberate act (ideally a grouped Renovate/Dependabot PR that
  updates the SHA + comment together). This trades silent drift for reviewed
  updates — the intended tradeoff.
- To update an action: resolve the new SHA
  (`gh api repos/<owner>/<action>/commits/<tag> --jq .sha`), replace the ref,
  update the `# tag` comment, and let the guard test confirm it is 40-hex.
- The guard only checks THIS repo's workflows; the published template's workflows
  are a separate surface (future work if the template ships pinned actions).
