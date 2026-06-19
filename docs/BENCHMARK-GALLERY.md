# Public Benchmark Gallery

Status: public-safe evidence surface. This page summarizes only self-checks
and sanitized fixture evidence.

README claim wording is tracked in [`docs/README-CLAIMS.md`](README-CLAIMS.md).

<!-- anamnesis:benchmark-gallery:start -->
## Generated Evidence

This section is generated from runtime evidence. It separates README-ready
claim candidates from evidence that still needs more repo shapes or manual
review.

Generated: 2026-06-19T04:13:44.583Z
Source: `.anamnesis/evidence/events.jsonl; docs/benchmark-evidence/public-shapes.jsonl` (18 valid, 0 invalid)

## Evidence Entries

| Project | Kind | Generated | Evidence | Result | Claim candidate |
|---|---|---|---|---|---|
| anamnesis | dogfood-check | 2026-06-19T04:13:44.583Z | docs/DOGFOOD.md; .anamnesis/evidence/events.jsonl | dogfood 5/5; tools claude-code, codex, cursor | anamnesis dogfood check passes 5/5 continuity criteria across claude-code, codex, cursor. |
| sanitized-nextjs-adoption | benchmark-compare | 2026-05-07T07:19:25.533Z | docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl | 3 improved, 0 regressed, 6 unchanged | sanitized-nextjs-adoption before/after benchmark improved 3 scorecard dimension(s) with 0 regressions. |
| sanitized-nextjs-frontend | benchmark-report | 2026-05-07T07:15:06.340Z | docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl | ready layers 4/5; continuity 6/6; doctor 0 errors, 1 warnings | sanitized-nextjs-frontend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0. |
| sanitized-nest-k8s-backend | benchmark-report | 2026-05-07T07:15:06.340Z | docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl | ready layers 4/5; continuity 6/6; doctor 0 errors, 2 warnings | sanitized-nest-k8s-backend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0. |
| anamnesis | benchmark-report | 2026-05-07T05:25:00.700Z | docs/BENCHMARKS.md; .anamnesis/evidence/events.jsonl | ready layers 3/5; continuity 6/6; doctor 0 errors, 0 warnings | anamnesis current benchmark has continuity 6/6, ready layers 3/5, and doctor errors 0. |

## README Claim Candidates

- **dogfood-check-anamnesis**: anamnesis dogfood check passes 5/5 continuity criteria across claude-code, codex, cursor.
  Evidence: docs/DOGFOOD.md; .anamnesis/evidence/events.jsonl
  Boundary: Self-check evidence for this managed repo; skipped external smokes must stay disclosed.
- **benchmark-compare-sanitized-nextjs-adoption**: sanitized-nextjs-adoption before/after benchmark improved 3 scorecard dimension(s) with 0 regressions.
  Evidence: docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl
  Boundary: Same-repo deterministic scorecard delta only; not a model-intelligence benchmark.
- **benchmark-report-sanitized-nextjs-frontend**: sanitized-nextjs-frontend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0.
  Evidence: docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl
  Boundary: Current deterministic context surface only; limitations depend on installed fragments and missing Layer A/B targets.
- **benchmark-report-sanitized-nest-k8s-backend**: sanitized-nest-k8s-backend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0.
  Evidence: docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl
  Boundary: Current deterministic context surface only; limitations depend on installed fragments and missing Layer A/B targets.
- **benchmark-report-anamnesis**: anamnesis current benchmark has continuity 6/6, ready layers 3/5, and doctor errors 0.
  Evidence: docs/BENCHMARKS.md; .anamnesis/evidence/events.jsonl
  Boundary: Current deterministic context surface only; limitations depend on installed fragments and missing Layer A/B targets.

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
