# Labels & Issues Runbook

Run these commands to create labels and issues on GitHub.
Review each block before pasting — adjust colors/text as needed.

## 1. Labels

```bash
# Phase labels
gh label create "P0:exporter"   --color "0E8A16" --description "Exporter (stars → stars.json)"
gh label create "P1:dashboard"  --color "0E8A16" --description "Static dashboard"
gh label create "P2:notifier"   --color "0E8A16" --description "Notifier (YouTube / awesome-stars → Telegram)"
gh label create "P3:ai"         --color "0E8A16" --description "AI classification layer"
gh label create "P4:template"   --color "0E8A16" --description "Reusable template (fork model)"
gh label create "P5:discovery"  --color "0E8A16" --description "Discovery Inbox"

# Type labels
gh label create "bug"           --color "d73a4a" --description "Something isn't working"
gh label create "feedback"      --color "a2eeef" --description "Feature request or improvement"
gh label create "tech-debt"     --color "fbca04" --description "Internal cleanup or refactoring"
gh label create "docs"          --color "0075ca" --description "Documentation"
gh label create "CI"            --color "e4e669" --description "CI / GitHub Actions"

# Priority labels
gh label create "priority:high" --color "b60205" --description "Blocking or critical"
gh label create "good first issue" --color "7057ff" --description "Good for newcomers"
```

## 2. Issues (5 trimmed)

```bash
gh issue create \
  --title "P3: visual UI polish + no-churn closeout" \
  --label "P3:ai" \
  --body "P3.0–P3.5 implementation and live artifact publication are complete.
Remaining: visual UI polish and no-churn closeout.
See docs/P3-ai-spec.md for details."

gh issue create \
  --title "P5: hosted validation (P5.7)" \
  --label "P5:discovery" \
  --body "P5.1–P5.6 are implemented. P5.7 hosted validation remains:
- Run the discovery workflow on GitHub Actions with a real config
- Verify candidate artifacts are generated and PR is created
- Confirm dashboard loads candidates correctly from published artifacts
See docs/P5-discovery-inbox-spec.md."

gh issue create \
  --title "Dashboard: improve mobile layout and accessibility" \
  --label "P1:dashboard,feedback" \
  --body "Audit the dashboard for mobile responsiveness and a11y issues.
- Tab navigation on small screens
- Discovery card layout at narrow widths
- ARIA roles on filter controls"

gh issue create \
  --title "CI: add discovery schema drift check" \
  --label "CI,P5:discovery" \
  --body "Add a CI step (or extend the existing schemas gate) that regenerates
discovery JSON schemas and fails if the committed schemas are stale.
Mirrors the pattern used for P0/P3 schemas."

gh issue create \
  --title "Docs: consolidate setup guides into a getting-started flow" \
  --label "docs" \
  --body "docs/setup/ has individual guides (secrets, pages, notifier, ai-executor,
troubleshooting, clean-room-validation). A single getting-started guide
that links them in order would reduce onboarding friction for template users."
```
