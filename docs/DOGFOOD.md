# Dogfood & Self-Check

anamnesis must be managed by anamnesis. This document records the recurring
self-check used to verify that each version improves the product's real
goal: agents receive enough current context, ontology, handoff state, and
guardrails to continue work after switching tools.

This is a continuity and agent-effectiveness check, not just a runtime
speed benchmark.

The sanitized-fixture matrix for v0.5 lives in
[`docs/DOGFOOD-MATRIX.md`](DOGFOOD-MATRIX.md).

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
4. Active handoff switch simulation in a temporary all-adapter project
5. Stale active handoff diagnostics through `status` / `doctor`
6. `npm test`
7. `npm run typecheck`
8. Confirm that this repo's `Agentfile` enables every supported adapter
   that should dogfood the base experience.
9. Record the result below, including whether the new version improved,
   regressed, or left unchanged:
   - **Context continuity**: can Claude Code, Codex, and Cursor all see the
     same project memory and handoff instructions?
   - **Ontology availability**: can a fresh agent find managed ontology
     slices and see whether bootstrap/enriched files or introspector support
     are missing?
   - **Adapter parity surface**: are native or fallback command/skill/hook
     surfaces present for each enabled adapter?
   - **Diagnostics quality**: does `status`/`doctor` make missing or stale
     continuity pieces obvious?
   - **Verification strength**: do tests lock the continuity contract?

## Current Dogfood Baseline

Recorded: 2026-05-03

Scope: this repository, `anamnesis`.

Agentfile:

```yaml
tools:
  - claude-code
  - codex
  - cursor
fragments:
  - id: base
    version: 7
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
| Managed entries | Improved: `status` reports 19 clean entries after adding Codex fallback regions, Cursor rule files, and the Claude Code entrypoint. Previous self-check had 10 clean entries. |
| Fragment state | `base@7` in-sync. |
| Drift | none. |
| Doctor | ok: 0 errors, 0 warnings. |
| Ontology gaps | `status` reports actionable warning counts plus informational Layer A coverage gaps. |
| Ontology bootstrap | `base` skipped-no-introspector; no files written. This is expected for the base fragment. |
| Tests | 428 tests passed across 37 files. |
| Typecheck | passed. |

Continuity surfaces now present in this repo:

| Adapter | Surface |
|---|---|
| Claude Code | `AGENTS.md` baseline, `CLAUDE.md` entrypoint, `.anamnesis/ontology/base.yaml`, native `.claude/hooks`, `.claude/commands`, `.claude/skills`. |
| Codex | `AGENTS.md` baseline plus `codex-cmd-*` and `codex-skill-*` fallback regions. |
| Cursor | `AGENTS.md` baseline plus `.cursor/rules/*` command and skill fallbacks. |

Known gaps:

- This repo currently has only the base ontology slice. There is no
  project-specific code ontology for anamnesis internals yet.
- `status` now reports continuity readiness and `doctor` emits
  continuity-specific warnings, including stale active handoff state.
- The current self-check records presence of surfaces and continuity
  diagnostics, then simulates an active handoff switch locally. It does not
  invoke real external Claude Code, Codex, or Cursor CLI sessions.

Next checks to improve:

- Use the `sanitized-nest-prisma` matrix finding to watch whether documented
  repair guidance is enough, or whether a future repair command is needed for
  user-modified managed surfaces.
- Use dogfood evidence from sanitized managed fixtures to choose the next
  ontology automation work.
- Add real external agent-session smoke checks only if local artifact
  simulation misses a concrete adapter behavior.


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


## Automated Self-Check — 2026-04-30T09:14:14.529Z

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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (307ms); npm run typecheck: pass (1749ms); npm test: pass (2653ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 307 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `npm run typecheck` | pass | 1749 | passed |
| `npm test` | pass | 2653 | passed |


## Automated Self-Check — 2026-04-30T09:29:21.482Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@6:in-sync
Drift: 18 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Doctor: ok (0 errors, 0 warnings)
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (273ms); anamnesis dogfood simulate-stale-handoff: pass (37ms); npm run typecheck: pass (1361ms); npm test: pass (3147ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 273 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 37 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1361 | passed |
| `npm test` | pass | 3147 | passed |


## Automated Self-Check — 2026-04-30T14:31:50.786Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@6:in-sync
Drift: 18 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Doctor: ok (0 errors, 0 warnings)
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (574ms); anamnesis dogfood simulate-stale-handoff: pass (51ms); npm run typecheck: pass (1323ms); npm test: pass (2230ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 574 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 51 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1323 | passed |
| `npm test` | pass | 2230 | passed |


## Automated Self-Check — 2026-05-02T14:41:53.457Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@6:in-sync
Drift: 19 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Doctor: ok (0 errors, 0 warnings)
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (242ms); anamnesis dogfood simulate-stale-handoff: pass (38ms); npm run typecheck: pass (1213ms); npm test: pass (1862ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 242 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 38 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1213 | passed |
| `npm test` | pass | 1862 | passed |


## Automated Self-Check — 2026-05-02T15:08:20.654Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@6:in-sync
Drift: 19 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (274ms); anamnesis dogfood simulate-stale-handoff: pass (49ms); npm run typecheck: pass (1400ms); npm test: pass (2640ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 274 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 49 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1400 | passed |
| `npm test` | pass | 2640 | passed |


## Automated Self-Check — 2026-05-02T16:03:57.478Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@7:in-sync
Drift: 19 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (266ms); anamnesis dogfood simulate-stale-handoff: pass (44ms); npm run typecheck: pass (1259ms); npm test: pass (1881ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 266 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 44 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1259 | passed |
| `npm test` | pass | 1881 | passed |