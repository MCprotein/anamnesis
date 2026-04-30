# Dogfood & Self-Check

anamnesis must be managed by anamnesis. This document records the recurring
self-check used to verify that each version improves the product's real
goal: agents receive enough current context, ontology, handoff state, and
guardrails to continue work after switching tools.

This is a continuity and agent-effectiveness check, not just a runtime
speed benchmark.

## Release Gate

Run this command before each release candidate and whenever the base
fragment or adapter fallbacks change:

```bash
npm run dogfood
```

That command runs `anamnesis dogfood check --append`, scores the current
continuity state, and appends an automated record to this file.

The underlying checklist is:

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
- `status` now reports continuity readiness and `doctor` emits
  continuity-specific warnings. The next diagnostic gap is active handoff
  scenario coverage, not surface presence.
- The current self-check records presence of surfaces and continuity
  diagnostics. It does not yet run a full simulated Claude -> Codex ->
  Cursor handoff scenario.

Next checks to improve:

- Add a simulated agent-switch scenario with an active handoff file.
- Use dogfood evidence from sanitized managed fixtures to choose the next
  ontology automation work.


## Automated Self-Check — 2026-04-30T08:30:21.884Z

Continuity readiness score: 5/5 (new baseline)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@6:in-sync
Drift: 18 clean, 0 modified, 0 missing
Doctor: ok (0 errors, 0 warnings)
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | all supported tools enabled and AGENTS.md baseline is clean |
| Ontology availability | pass | 1 clean ontology file(s) |
| Adapter parity surface | pass | Claude native surfaces, Codex AGENTS fallbacks, and Cursor rules checked |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); drift clean=true |
| Verification strength | pass | npm run typecheck: pass (1359ms); npm test: pass (2574ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `npm run typecheck` | pass | 1359 | passed |
| `npm test` | pass | 2574 | passed |


## Automated Self-Check — 2026-04-30T08:41:11.930Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@6:in-sync
Drift: 18 clean, 0 modified, 0 missing
Status continuity: ready (5/5)
Doctor: ok (0 errors, 0 warnings)
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 5/5 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true |
| Verification strength | pass | npm run typecheck: pass (1281ms); npm test: pass (1772ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `npm run typecheck` | pass | 1281 | passed |
| `npm test` | pass | 1772 | passed |
