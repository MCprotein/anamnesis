# Public Benchmark Gallery

Status: public-safe evidence surface. This page summarizes only self-checks
and sanitized fixture evidence.

README claim wording is tracked in [`docs/README-CLAIMS.md`](README-CLAIMS.md).

<!-- anamnesis:benchmark-gallery:start -->
## Generated Evidence

This section is generated from runtime evidence. Public release candidates must
not include private project names, organization repository identifiers, local source
paths, hostnames, credentials, or proprietary domain details.

Generated: 2026-05-11T08:15:52.132Z
Source: `.anamnesis/evidence/events.jsonl; docs/benchmark-evidence/public-shapes.jsonl`

## Evidence Entries

| Project | Kind | Result | Claim candidate |
|---|---|---|---|
| anamnesis | dogfood-check | dogfood continuity checks passed across claude-code, codex, cursor | Self-dogfood continuity is passing for this repository. |
| sanitized-nextjs-adoption | benchmark-compare | 3 improved, 0 regressed, 6 unchanged | Sanitized frontend adoption evidence improved deterministic context scorecard dimensions. |
| sanitized-nextjs-frontend | benchmark-report | continuity 6/6; ready layers 4/5; doctor errors 0 | Sanitized frontend fixture keeps continuity ready with stated Layer B limitations. |
| sanitized-nest-k8s-backend | benchmark-report | continuity 6/6; ready layers 4/5; doctor errors 0 | Sanitized backend/infra fixture keeps continuity ready with stated Layer B limitations. |

## README Claim Candidates

- **dogfood-check-anamnesis**: anamnesis self-dogfood continuity is passing
  across claude-code, codex, and cursor.
  Evidence: docs/DOGFOOD.md; `.anamnesis/evidence/events.jsonl`
  Boundary: Self-check evidence for this repository only.
- **benchmark-compare-sanitized-nextjs-adoption**: a sanitized frontend
  adoption fixture improved 3 deterministic scorecard dimensions with 0
  regressions.
  Evidence: docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl
  Boundary: Same-fixture deterministic scorecard delta only; not a
  model-intelligence benchmark.
- **benchmark-report-sanitized-fixtures**: sanitized frontend and backend/infra
  fixtures reach continuity `6/6` with doctor errors `0`.
  Evidence: docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl
  Boundary: Current deterministic context surface only; Layer B limitations
  remain stated.

## Release Warnings

_No release warnings._
<!-- /anamnesis:benchmark-gallery -->

## Claim Policy

Only make public README claims from benchmark entries that:

- expose no proprietary source snippets, credentials, hostnames, local paths, or
  internal business logic
- use sanitized fixture names
- include the repo shape and fragment set
- report before/after or baseline/current state with the same metric
- state limitations instead of implying universal behavior

Do not claim yet:

- "works for every framework"
- "100% native UX across all agents"
- "all ontology is fully automatic"
- "registry fragments are secure"
- "benchmark-proven across the ecosystem"

## Collection Targets

Future public benchmark evidence should come from:

1. synthetic fixtures maintained inside this repository
2. intentionally public example repositories
3. sanitized archives reviewed before publication

Private validation may guide product priorities, but it must stay out of public
docs, npm package artifacts, generated gallery regions, and README claim
candidates.
