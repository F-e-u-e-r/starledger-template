# ADR-001: Semantic search is deferred; lexical search ships in P3

- Status: Accepted
- Date: 2026-06-22
- Milestone: P3.5

## Context

P3 adds AI enrichment — a single category, controlled tags, and a factual
summary — to the dashboard. P3.5 asks whether to ship true semantic (vector)
search now or defer it.

The dashboard is a static, client-only GitHub Pages site with NO backend and NO
secret. Any vector search would therefore have to run entirely in the browser:
embed the query and every annotation client-side, ship a model plus an index in
the Pages artifact, and keep first-query latency acceptable on mobile.

## Decision

**Ship lexical search in P3; DEFER true vector search to a future hosted phase.**

The shipped P3 search is a normalized substring match over:

```text
name_with_owner · GitHub description · topics · primary language
  · AI category · AI tags · AI summary
```

It is precomputed once per dataset (`buildSearchText`) and runs on every keystroke
as a plain `includes` check, so it stays instant for thousands of repositories and
degrades gracefully when AI data is absent (the AI fields simply do not
contribute).

True vector search will ship ONLY if a future client-side experiment proves all of:

- no API secret and no backend;
- acceptable model + index size in the Pages artifact;
- acceptable mobile first-query and warm-query latency;
- a measurable relevance improvement over lexical search;
- lexical search remains available as a fallback.

Until then, deferral is the accepted, successful outcome — not a gap.

## Consequences

- P3 ships a fast, dependency-free, fail-soft search that already covers the AI
  fields, so users get AI-aware discovery now.
- No model weights, embeddings, or vector index are added to the Pages artifact in
  P3, keeping the bundle small and the site backend-free.
- Revisit if/when the client-side experiment above is run; this ADR records the
  criteria so the decision can be reopened on evidence, not preference.
