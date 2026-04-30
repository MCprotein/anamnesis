# Dogfood & Self-Check

anamnesis must be managed by anamnesis. This document records the recurring
self-check used to verify that each version improves the product's real
goal: agents receive enough current context, ontology, handoff state, and
guardrails to continue work after switching tools.

This is a continuity and agent-effectiveness check, not just a runtime
speed benchmark.

## Release Gate

Run this checklist before each release candidate and whenever the base
fragment or adapter fallbacks change:

1. `anamnesis status`
2. `anamnesis doctor`
3. `anamnesis ontology bootstrap --dry-run`
4. `npm test`
5. `npm run typecheck`
6. Confirm that this repo's `Agentfile` enables every supported adapter
   that should dogfood the base experience.
7. Record the result below, including whether the new version improved,
   regressed, or left unchanged:
   - **Context continuity**: can Claude Code, Codex, and Cursor all see the
     same project memory and handoff instructions?
   - **Ontology availability**: can a fresh agent find managed ontology
     slices and any bootstrap/enriched files?
   - **Adapter parity surface**: are native or fallback command/skill/hook
     surfaces present for each enabled adapter?
   - **Diagnostics quality**: does `status`/`doctor` make missing or stale
     continuity pieces obvious?
   - **Verification strength**: do tests lock the continuity contract?

## Current Dogfood Baseline

Recorded: 2026-04-30

Scope: this repository, `anamnesis`.

Agentfile:

```yaml
tools:
  - claude-code
  - codex
  - cursor
fragments:
  - id: base
    version: 6
```

Commands run:

```bash
npx tsx cli/src/index.ts update --dry-run --allow-exec-adapters
npx tsx cli/src/index.ts update --apply --allow-exec-adapters
npx tsx cli/src/index.ts status
npx tsx cli/src/index.ts doctor
npx tsx cli/src/index.ts ontology bootstrap --dry-run
npm test
npm run typecheck
```

Results:

| Check | Result |
|---|---|
| Adapter dogfood surface | Improved: `Agentfile` now enables `claude-code`, `codex`, and `cursor` instead of Claude Code only. |
| Managed entries | Improved: `status` reports 18 clean entries after adding Codex fallback regions and Cursor rule files. Previous self-check had 10 clean entries. |
| Fragment state | `base@6` in-sync. |
| Drift | none. |
| Doctor | ok: 0 errors, 0 warnings. |
| Ontology bootstrap | `base` skipped-no-introspector; no files written. This is expected for the base fragment. |
| Tests | 411 tests passed across 34 files. |
| Typecheck | passed. |

Continuity surfaces now present in this repo:

| Adapter | Surface |
|---|---|
| Claude Code | `AGENTS.md` baseline, `.anamnesis/ontology/base.yaml`, native `.claude/hooks`, `.claude/commands`, `.claude/skills`. |
| Codex | `AGENTS.md` baseline plus `codex-cmd-*` and `codex-skill-*` fallback regions. |
| Cursor | `AGENTS.md` baseline plus `.cursor/rules/*` command and skill fallbacks. |

Known gaps:

- This repo currently has only the base ontology slice. There is no
  project-specific code ontology for anamnesis internals yet.
- `status` and `doctor` report clean installation integrity, but they do
  not yet summarize context-continuity readiness as a first-class score.
- The current self-check records presence of surfaces. It does not yet
  run a full simulated Claude -> Codex -> Cursor handoff scenario.

Next checks to improve:

- Add `status`/`doctor` continuity diagnostics so missing handoff,
  ontology, or adapter fallback surfaces are reported directly.
- Add a simulated agent-switch scenario with an active handoff file.
- Use dogfood evidence from sanitized managed fixtures to choose the next
  ontology automation work.
