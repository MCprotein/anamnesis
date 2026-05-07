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

Generated: 2026-05-07T06:30:43.697Z
Source: `.anamnesis/evidence/events.jsonl` (7 valid, 0 invalid)

## Evidence Entries

| Project | Kind | Generated | Evidence | Result | Claim candidate |
|---|---|---|---|---|---|
| anamnesis | dogfood-check | 2026-05-07T06:30:43.697Z | docs/DOGFOOD.md; .anamnesis/evidence/events.jsonl | dogfood 5/5; tools claude-code, codex, cursor | anamnesis dogfood check passes 5/5 continuity criteria across claude-code, codex, cursor. |
| anamnesis | benchmark-report | 2026-05-07T05:25:00.700Z | docs/BENCHMARKS.md; .anamnesis/evidence/events.jsonl | ready layers 3/5; continuity 6/6; doctor 0 errors, 0 warnings | anamnesis current benchmark has continuity 6/6, ready layers 3/5, and doctor errors 0. |

## README Claim Candidates

- **dogfood-check-anamnesis**: anamnesis dogfood check passes 5/5 continuity criteria across claude-code, codex, cursor.
  Evidence: docs/DOGFOOD.md; .anamnesis/evidence/events.jsonl
  Boundary: Self-check evidence for this managed repo; skipped external smokes must stay disclosed.
- **benchmark-report-anamnesis**: anamnesis current benchmark has continuity 6/6, ready layers 3/5, and doctor errors 0.
  Evidence: docs/BENCHMARKS.md; .anamnesis/evidence/events.jsonl
  Boundary: Current deterministic context surface only; limitations depend on installed fragments and missing Layer A/B targets.

## Release Warnings

- No before/after benchmark comparison evidence found.
- Only 1 public-safe project shape(s) represented; do not claim ecosystem coverage.
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
| `sanitized-nest-prisma@e19fc0d` sanitized snapshot | NestJS + Prisma backend | `docs/BENCHMARKS.md` v0.7 before/after | Ready layers improved `1/5` -> `5/5`; continuity `4/6` -> `6/6`; ontology warnings `2` -> `0` | Yes, as a sanitized sanitized-fixture backend snapshot |
| `anamnesis` self repo | CLI/library repo using base fragment across Claude Code, Codex, Cursor | `docs/BENCHMARKS.md` and `npm run dogfood:check` | Current continuity `6/6`; adapter surfaces ready; ready layers `3/5` because base has no Layer A/B target | Yes, as self-dogfood continuity evidence |

Allowed README wording:

> In current dogfood evidence, a sanitized NestJS/Prisma backend snapshot
> improved from ready layers `1/5` to `5/5` after all-adapter install,
> deterministic bootstrap, and agent-authored enrichment; the anamnesis repo
> itself keeps cross-agent continuity at `6/6`.

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
| Fresh Next.js frontend | continuity `6/6`, doctor ok | Needs benchmark-report format before becoming headline evidence |
| Fresh NestJS + Kubernetes + docker-compose backend | continuity `6/6`, doctor ok, multi-fragment bootstrap | Needs benchmark-report format before becoming headline evidence |
| Existing managed NestJS + Prisma backend | exposed repair/continuity gaps | Useful lifecycle evidence, but not a positive headline claim |

These are useful product signals, but the gallery should not present them as
benchmark headline evidence until they are rerun through
`anamnesis benchmark report` with sanitized output.

## Next Collection Targets

Collect at least three public-safe benchmark entries during the v1.2 evidence
work:

1. **Frontend app**: Next.js, SvelteKit, Remix, or Nuxt.
   - Goal: show all-adapter continuity and frontend-specific static ontology.
   - Required report: baseline/fresh install plus bootstrap state.
2. **Infra/backend mixed repo**: Kubernetes plus a backend framework.
   - Goal: show multi-fragment ontology bootstrap and continuity.
   - Required report: before/after if adopting anamnesis into an existing repo.
3. **Python API**: FastAPI plus python-uv.
   - Goal: show non-Node stack coverage and command guidance.
   - Required report: fresh install plus ontology gap behavior.

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
