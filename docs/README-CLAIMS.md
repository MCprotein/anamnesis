# README Claims

Status: v1.0 evidence-backed README claim ledger.

README claims should stay traceable to deterministic tests, dogfood records,
switching fixtures, or public-safe benchmark reports. This file records the
allowed claim surface before v1.0 publish.

The generated evidence region in
[`docs/BENCHMARK-GALLERY.md`](BENCHMARK-GALLERY.md) is refreshed by
`anamnesis benchmark gallery --write` and checked by
`anamnesis benchmark gallery --validate`. If the generated region lacks a
matching claim candidate or emits a release warning, keep README wording at
the narrower manually evidenced boundary.

## Current README Claims

| README claim | Evidence | Boundary |
|---|---|---|
| anamnesis installs always-loaded project context, ontology, handoff instructions, and adapter surfaces | `README.md` quickstart, `docs/DOGFOOD.md`, `npm run release:check` | Supported for built-in/local fragments only |
| The same Agentfile and fragments render to Claude Code, Codex, and Cursor | `docs/ADAPTER-PARITY.md`, `docs/SWITCHING-SCENARIOS.md`, adapter tests, `docs/DOGFOOD.md` | User-facing continuity parity, not identical native UI |
| A fresh agent can continue without a bespoke "read these files first" prompt | `docs/AGENT-SWITCHING-GUIDE.md`, `docs/SWITCHING-SCENARIOS.md`, `cli/src/adapters/switching.test.ts` | Requires installed surfaces and current handoff/ontology state |
| Stack-specific concerns are detected from project files | `rulebook.md`, fragment catalog in `README.md`, rulebook tests | Limited to bundled trigger rules and local/project files |
| User-authored files are preserved | `docs/DOGFOOD-MATRIX.md`, `docs/REPAIR.md`, update/applier tests | Managed regions can update; user-modified files are surfaced and skipped |
| Layer A ontology is deterministic and Layer B enrichment is agent-authored | `docs/ONTOLOGY-BOOTSTRAP.md`, `docs/BENCHMARKS.md`, `docs/DOCS-V1-AUDIT.md` | Do not claim fully automatic deep ontology for every framework |
| Sanitized Next.js adoption evidence improved 3 scorecard dimensions with 0 regressions | `docs/BENCHMARKS.md`, `docs/BENCHMARK-GALLERY.md`, `docs/benchmark-evidence/public-shapes.jsonl` | One public-safe frontend adoption path, not ecosystem-wide proof |
| Fresh public frontend and backend/infra snapshots keep continuity at `6/6` with 0 doctor errors | `docs/BENCHMARKS.md`, `docs/BENCHMARK-GALLERY.md`, `docs/benchmark-evidence/public-shapes.jsonl` | Layer B enrichment remains missing in fresh-install evidence |
| Self-dogfood keeps cross-agent continuity at `6/6` | `docs/BENCHMARK-GALLERY.md`, `docs/DOGFOOD.md`, `npm run dogfood:check` | Self-repo has base fragment only, so Layer A/B targets are intentionally partial |

## Allowed README Wording

The current README may claim:

- anamnesis is an AI coding agent config lifecycle manager;
- it installs and refreshes project memory, ontology, handoff, and adapter
  surfaces;
- Claude Code, Codex, and Cursor have tested user-facing continuity parity;
- Layer A ontology is deterministic and Layer B semantic enrichment is
  agent-authored;
- current public-safe evidence includes frontend, backend/infra, Python/uv,
  before/after adoption, and self-dogfood continuity;
- broader framework and ecosystem claims need more public-safe benchmark
  shapes.

## Disallowed README Wording

Do not claim:

- "works for every framework";
- "100% native UX across all agents";
- "all ontology is fully automatic";
- "public remote fragment registry shipped";
- "remote signed fragments supported";
- "benchmark-proven across the ecosystem";
- "no user review needed for generated context."

## Update Rule

When README claims change:

1. Add or update the evidence in `docs/BENCHMARKS.md`,
   `docs/BENCHMARK-GALLERY.md`, `docs/DOGFOOD.md`,
   `docs/SWITCHING-SCENARIOS.md`, or tests.
2. Update this ledger in the same commit as the README claim.
3. Keep the claim narrower than the evidence.
4. Record unsupported future claims under collection targets, not README.
