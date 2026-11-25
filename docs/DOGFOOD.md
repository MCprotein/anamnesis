# Dogfood & Self-Check

anamnesis must be managed by anamnesis. This document records the recurring
self-check used to verify that each version improves the product's core goal:
agents receive enough current context, ontology, handoff state, and guardrails
to continue work after switching tools.

This is a continuity and agent-effectiveness check, not a runtime speed
benchmark.

Private-project validation may be useful during development, but it must remain
internal. Do not copy private repository names, local paths, hostnames,
credentials, proprietary domain details, or private validation evidence into this file,
README, generated benchmark galleries, or npm package artifacts.

## Release Gate

Run this command before each release candidate and whenever the base fragment or
adapter fallbacks change:

```bash
npm run dogfood
```

That command runs `anamnesis dogfood check --append`, scores the current
continuity state, appends an automated record to this file, and writes a
machine-readable evidence record to `.anamnesis/evidence/events.jsonl`.

The underlying checklist is:

1. `anamnesis status`
2. `anamnesis doctor`
3. `anamnesis ontology bootstrap --dry-run`
4. Active handoff switch simulation in a temporary all-adapter project created
   through the first-install all-adapter path
5. Stale active handoff diagnostics through `status` / `doctor`
6. `npm test`
7. `npm run typecheck`
8. Confirm that this repo's `Agentfile` enables every supported adapter that
   should dogfood the base experience.

## Published Package Smoke

Published-package smokes verify npmjs.org package behavior rather than the
local TypeScript source. Run them from a fresh temp directory so `npm exec`
does not resolve a local or globally installed `anamnesis` binary first.

```bash
npm view @mcprotein/anamnesis@X.Y.Z version \
  --@mcprotein:registry=https://registry.npmjs.org/
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- anamnesis --version
```

For a fresh fixture smoke:

```bash
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- \
  anamnesis init --tools all --allow-exec-adapters
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- anamnesis status
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- anamnesis doctor
```

### v1.5.0

Recorded: 2026-06-19

Purpose: verify the npm-published compact SessionStart default and
session-context benchmark release, not the local TypeScript source tree.

Results:

- npmjs.org `@mcprotein/anamnesis@1.5.0` returned `1.5.0`.
- Published CLI execution from a fresh temp directory returned `1.5.0`.
- GitHub Actions `Publish` for tag `v1.5.0` completed successfully.
- Fresh published-package fixture with all adapters installed had continuity
  `ready (6/6)`, Codex hook warnings `0`, and doctor `0` errors. The only
  doctor warning was the expected missing Layer B enrichment for the fresh
  Prisma fixture.
- Direct published Claude Code SessionStart hook execution emitted
  `Mode: compact`, source pointers for `system_graph.yaml` and managed
  ontology files, an invariant digest, and the retrieval rule.
- Direct published Codex native SessionStart execution returned JSON
  `additionalContext` with compact mode, source pointers, invariant digest,
  and retrieval rule.

### v1.4.4

Recorded: 2026-05-19

Purpose: verify the npm-published Stop-hook handoff reminder dedupe patch,
not the local TypeScript source tree.

Results:

- npmjs.org `@mcprotein/anamnesis@1.4.4` returned `1.4.4`.
- Published CLI execution from a fresh temp directory returned `1.4.4`.
- GitHub Actions `Publish` for tag `v1.4.4` completed successfully.
- Fresh published-package fixture with all adapters installed had continuity
  `ready (6/6)`, Codex hook warnings `0`, and doctor `0` errors. The only
  doctor warning was the expected missing Layer B enrichment for the fresh
  Prisma fixture.
- Direct published Stop hook execution in a fresh git repo emitted the
  handoff reminder on the first unchanged dirty fingerprint and emitted
  nothing on the second run with the same dirty state.

### v1.4.3

Recorded: 2026-05-19

Purpose: verify the npm-published SessionStart ontology ordering patch, not
the local TypeScript source tree.

Results:

- npmjs.org `@mcprotein/anamnesis` latest returned `1.4.3`.
- Published CLI execution from a fresh temp directory returned `1.4.3`.
- GitHub Actions `Publish` for tag `v1.4.3` completed successfully.
- Fresh published-package fixture with all adapters installed had continuity
  `ready (6/6)`, Codex hook warnings `0`, and doctor `0` errors. The only
  doctor warning was the expected missing Layer B enrichment for the fresh
  Prisma fixture.
- Direct published Claude Code SessionStart hook execution emitted
  `system_graph.yaml (user-managed)` before generated ontology slices.

## Current Public Claim Boundary

- Self-dogfood may claim this repository's continuity checks pass.
- Sanitized fixtures may claim only their own deterministic scorecard results.
- Public docs must not imply universal framework coverage, fully automatic
  semantic ontology, or identical native UI across agents.

## Archived Self-Check Records

Older automated records live in `docs/dogfood/`, one file per month:

- [2026-05](dogfood/2026-05.md)
- [2026-06](dogfood/2026-06.md)
- [2026-07](dogfood/2026-07.md)
- [2026-08](dogfood/2026-08.md)
- [2026-09](dogfood/2026-09.md)

## Automated Self-Check — current baseline

Project: anamnesis
Tools: claude-code, codex, cursor

| Check | Result |
|---|---|
| Context continuity | expected through managed AGENTS.md, ontology, handoff, commands, skills, and hooks |
| Ontology availability | base static ontology present; no project-specific Layer A target for the self repo |
| Adapter surfaces | Claude Code, Codex, and Cursor surfaces are generated or represented through fallbacks |
| Verification | `npm run release:check` is the release gate |

Known limitation:

- This self-check records artifact presence and deterministic diagnostics. It
  does not prove model-intelligence gains or full ecosystem coverage.


## Automated Self-Check — 2026-10-11T15:09:45.327Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@30:in-sync
Drift: 57 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 5 total (anamnesis 5, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 3 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 3 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (595ms); anamnesis dogfood simulate-stale-handoff: pass (239ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1317ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1233ms); npm test: pass (67918ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 595 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 239 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1317 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1233 | passed |
| `npm test` | pass | 67918 | passed |


## Automated Self-Check — 2026-10-11T15:54:41.174Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@30:in-sync
Drift: 57 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 5 total (anamnesis 5, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 3 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 3 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (543ms); anamnesis dogfood simulate-stale-handoff: pass (295ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1604ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1492ms); npm test: pass (75911ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 543 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 295 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1604 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1492 | passed |
| `npm test` | pass | 75911 | passed |


## Automated Self-Check — 2026-10-11T16:38:02.999Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@30:in-sync
Drift: 57 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 5 total (anamnesis 5, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 3 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 3 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (605ms); anamnesis dogfood simulate-stale-handoff: pass (272ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1592ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1337ms); npm test: pass (81073ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 605 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 272 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1592 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1337 | passed |
| `npm test` | pass | 81073 | passed |


## Automated Self-Check — 2026-10-11T16:53:41.817Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@30:in-sync
Drift: 57 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 5 total (anamnesis 5, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 3 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 3 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (763ms); anamnesis dogfood simulate-stale-handoff: pass (269ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1425ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1297ms); npm test: pass (69193ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 763 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 269 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1425 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1297 | passed |
| `npm test` | pass | 69193 | passed |


## Automated Self-Check — 2026-10-11T17:42:18.901Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@31:in-sync
Drift: 57 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 5 total (anamnesis 5, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 3 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 3 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (700ms); anamnesis dogfood simulate-stale-handoff: pass (242ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1333ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1261ms); npm test: pass (68665ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 700 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 242 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1333 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1261 | passed |
| `npm test` | pass | 68665 | passed |


## Automated Self-Check — 2026-10-11T17:57:12.666Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@31:in-sync
Drift: 57 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 5 total (anamnesis 5, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 3 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 3 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (621ms); anamnesis dogfood simulate-stale-handoff: pass (254ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1347ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1278ms); npm test: pass (68307ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 621 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 254 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1347 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1278 | passed |
| `npm test` | pass | 68307 | passed |


## Automated Self-Check — 2026-11-25T06:09:44.865Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@32:in-sync
Drift: 57 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 5 total (anamnesis 5, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 3 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 3 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (483ms); anamnesis dogfood simulate-stale-handoff: pass (313ms); anamnesis dogfood simulate-codex-native-dispatch: pass (479ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1386ms); npm test: pass (41308ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 483 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 313 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 479 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1386 | passed |
| `npm test` | pass | 41308 | passed |
