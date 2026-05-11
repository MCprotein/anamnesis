# Public Benchmark Gallery

Status: v1.2 evidence surface. This page summarizes public-safe benchmark
evidence, generated runtime evidence, and headline-ready claims from evidence
still needing more repo shapes.

README claim wording is tracked in [`docs/README-CLAIMS.md`](README-CLAIMS.md).

<!-- anamnesis:benchmark-gallery:start -->
## Generated Evidence

This section is generated from runtime evidence. It separates README-ready
claim candidates from evidence that still needs more repo shapes or manual
review.

Generated: 2026-05-11T08:15:52.132Z
Source: `.anamnesis/evidence/events.jsonl; docs/benchmark-evidence/public-shapes.jsonl` (20 valid, 0 invalid)

## Evidence Entries

| Project | Kind | Generated | Evidence | Result | Claim candidate |
|---|---|---|---|---|---|
| anamnesis | dogfood-check | 2026-05-11T08:15:52.132Z | docs/DOGFOOD.md; .anamnesis/evidence/events.jsonl | dogfood 5/5; tools claude-code, codex, cursor | anamnesis dogfood check passes 5/5 continuity criteria across claude-code, codex, cursor. |
| sanitized-nest-prisma | benchmark-compare | 2026-05-08T04:39:52.456Z | docs/BENCHMARKS.md; .anamnesis/evidence/events.jsonl | 6 improved, 0 regressed, 3 unchanged | sanitized-nest-prisma before/after benchmark improved 6 scorecard dimension(s) with 0 regressions. |
| public-next-frontend-adoption | benchmark-compare | 2026-05-07T07:19:25.533Z | docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl | 3 improved, 0 regressed, 6 unchanged | public-next-frontend-adoption before/after benchmark improved 3 scorecard dimension(s) with 0 regressions. |
| sanitized-python-api | benchmark-report | 2026-05-07T07:15:19.092Z | docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl | ready layers 2/5; continuity 5/6; doctor 0 errors, 2 warnings | No readiness claim until continuity and doctor diagnostics are clean. |
| public-next-frontend | benchmark-report | 2026-05-07T07:15:06.340Z | docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl | ready layers 4/5; continuity 6/6; doctor 0 errors, 1 warnings | public-next-frontend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0. |
| public-nest-k8s-backend | benchmark-report | 2026-05-07T07:15:06.340Z | docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl | ready layers 4/5; continuity 6/6; doctor 0 errors, 2 warnings | public-nest-k8s-backend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0. |
| anamnesis | benchmark-report | 2026-05-07T05:25:00.700Z | docs/BENCHMARKS.md; .anamnesis/evidence/events.jsonl | ready layers 3/5; continuity 6/6; doctor 0 errors, 0 warnings | anamnesis current benchmark has continuity 6/6, ready layers 3/5, and doctor errors 0. |

## README Claim Candidates

- **dogfood-check-anamnesis**: anamnesis dogfood check passes 5/5 continuity criteria across claude-code, codex, cursor.
  Evidence: docs/DOGFOOD.md; .anamnesis/evidence/events.jsonl
  Boundary: Self-check evidence for this managed repo; skipped external smokes must stay disclosed.
- **benchmark-compare-sanitized-nest-prisma**: sanitized-nest-prisma before/after benchmark improved 6 scorecard dimension(s) with 0 regressions.
  Evidence: docs/BENCHMARKS.md; .anamnesis/evidence/events.jsonl
  Boundary: Same-repo deterministic scorecard delta only; not a model-intelligence benchmark.
- **benchmark-compare-public-next-frontend-adoption**: public-next-frontend-adoption before/after benchmark improved 3 scorecard dimension(s) with 0 regressions.
  Evidence: docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl
  Boundary: Same-repo deterministic scorecard delta only; not a model-intelligence benchmark.
- **benchmark-report-public-next-frontend**: public-next-frontend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0.
  Evidence: docs/BENCHMARKS.md; docs/benchmark-evidence/public-shapes.jsonl
  Boundary: Current deterministic context surface only; limitations depend on installed fragments and missing Layer A/B targets.
- **benchmark-report-public-nest-k8s-backend**: public-nest-k8s-backend current benchmark has continuity 6/6, ready layers 4/5, and doctor errors 0.
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

- expose no proprietary source snippets, credentials, hostnames, or internal
  business logic
- include the repo shape and fragment set
- report before/after or baseline/current state with the same metric
- link to the underlying `docs/BENCHMARKS.md` or `docs/DOGFOOD*.md` record
- state limitations instead of implying universal behavior

## Headline Evidence

| Subject | Shape | Evidence | Result | Public claim allowed |
|---|---|---|---|---|
| `public-next-frontend-adoption` sanitized snapshot | Fresh Next.js frontend adoption | Generated evidence region, `docs/BENCHMARKS.md`, `docs/benchmark-evidence/public-shapes.jsonl` | 3 scorecard dimensions improved, 0 regressed; ready layers `3/5` -> `5/5` | Yes, as a sanitized frontend adoption path |
| `public-next-frontend` sanitized snapshot | Fresh Next.js frontend | Generated evidence region, `docs/BENCHMARKS.md`, `docs/benchmark-evidence/public-shapes.jsonl` | Continuity `6/6`; ready layers `4/5`; doctor errors `0` | Yes, with Layer B limitation stated |
| `public-nest-k8s-backend` sanitized snapshot | Fresh NestJS + Kubernetes backend/infra | Generated evidence region, `docs/BENCHMARKS.md`, `docs/benchmark-evidence/public-shapes.jsonl` | Continuity `6/6`; ready layers `4/5`; doctor errors `0` | Yes, with Layer B limitation stated |
| `anamnesis` self repo | CLI/library repo using base fragment across Claude Code, Codex, Cursor | `docs/BENCHMARKS.md` and `npm run dogfood:check` | Current continuity `6/6`; adapter surfaces ready; ready layers `3/5` because base has no Layer A/B target | Yes, as self-dogfood continuity evidence |

Allowed README wording:

> In current generated benchmark evidence, a sanitized Next.js adoption path
> improved 3 deterministic scorecard dimensions with 0 regressions after
> all-adapter install, deterministic bootstrap, and agent-authored Layer B
> enrichment. Fresh public frontend and backend/infra snapshots keep
> continuity at `6/6`, and the anamnesis repo itself keeps dogfood continuity
> at `5/5`.

Do not claim yet:

- "works for every framework"
- "100% native UX across all agents"
- "all ontology is fully automatic"
- "registry fragments are secure"
- "benchmark-proven across the ecosystem"

## Supporting Evidence

`docs/DOGFOOD-MATRIX.md` covers more local repo shapes:

| Repo shape | Signal | Gallery status |
|---|---|---|
| Fresh Next.js frontend | continuity `6/6`, doctor errors `0`, ready layers `4/5` | Represented as generated benchmark evidence |
| Fresh NestJS + Kubernetes + docker-compose backend | continuity `6/6`, doctor errors `0`, multi-fragment bootstrap | Represented as generated benchmark evidence |
| Existing managed NestJS + Prisma backend | exposed repair/continuity gaps | Represented as non-claim lifecycle evidence because one scorecard dimension regressed |
| Existing Python/uv API/ML repo | static + Layer A facts present, continuity `5/6` | Represented as non-claim evidence until adapter-surface gap is repaired |

These are useful product signals, but the generated region is the release gate
for README wording. Entries marked "No readiness claim" or "No public
improvement claim" stay supporting evidence only.

## Collection Targets

Current v1.2 collection covers the required public-safe shapes:

1. **Frontend app**: Next.js.
   - Goal: show all-adapter continuity and frontend-specific static ontology.
   - Current evidence: `public-next-frontend` and
     `public-next-frontend-adoption`.
2. **Infra/backend mixed repo**: Kubernetes plus NestJS.
   - Goal: show multi-fragment ontology bootstrap and continuity.
   - Current evidence: `public-nest-k8s-backend`.
3. **Python API**: FastAPI plus python-uv.
   - Goal: show non-Node stack coverage and command guidance.
   - Current evidence: `sanitized-python-api`, currently non-claim because one
     adapter-surface gap remains.

## Collection Procedure

For each candidate repo:

1. Create a temporary sanitized snapshot.
2. Remove credentials, hostnames, private package names, and proprietary
   business terms from any public summary.
3. Run `anamnesis benchmark report --json` for machine-readable capture.
4. Run `anamnesis benchmark report --append --output <path>` only after
   reviewing the markdown.
5. Record the repo shape, fragment set, ready layers, continuity score,
   ontology warning count, and limitations.
6. Update this gallery and README only with claims the report actually proves.

## Acceptance Criteria

- At least three public-safe repo shapes are represented before broad README
  benchmark claims are made.
- At least one entry is a before/after adoption comparison.
- At least one entry is a fresh install path.
- At least one entry includes Layer A bootstrap facts.
- Any Layer B enrichment claim points to agent-authored `.enriched.yaml`
  evidence or states that enrichment is still missing.
- Numeric scorecards keep raw dimensions visible instead of reducing evidence
  to an opaque aggregate.
