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


## Automated Self-Check — 2026-05-19T07:33:48.907Z

Continuity readiness score: 5/5 (new baseline)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@12:in-sync
Drift: 32 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (407ms); anamnesis dogfood simulate-stale-handoff: pass (42ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1856ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1675ms); npm test: pass (9863ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 407 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 42 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1856 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1675 | passed |
| `npm test` | pass | 9863 | passed |


## Automated Self-Check — 2026-06-19T04:13:44.583Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@13:in-sync
Drift: 32 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (289ms); anamnesis dogfood simulate-stale-handoff: pass (23ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1189ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (888ms); npm test: pass (6328ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 289 | active.md and latest archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 23 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1189 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 888 | passed |
| `npm test` | pass | 6328 | passed |


## Automated Self-Check — 2026-06-24T15:45:55.260Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@13:in-sync
Drift: 32 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (437ms); anamnesis dogfood simulate-stale-handoff: pass (20ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1120ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (916ms); npm test: pass (6288ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 437 | active.md and latest archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 20 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1120 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 916 | passed |
| `npm test` | pass | 6288 | passed |


## Automated Self-Check — 2026-07-02T07:45:35.483Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@14:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (333ms); anamnesis dogfood simulate-stale-handoff: pass (27ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1224ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (960ms); npm test: pass (6757ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 333 | active.md and latest archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 27 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1224 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 960 | passed |
| `npm test` | pass | 6757 | passed |


## Automated Self-Check — 2026-07-02T07:56:38.583Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@14:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (221ms); anamnesis dogfood simulate-stale-handoff: pass (30ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1340ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (949ms); npm test: pass (7080ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 221 | active.md and latest archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 30 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1340 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 949 | passed |
| `npm test` | pass | 7080 | passed |


## Automated Self-Check — 2026-07-02T08:02:38.601Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@14:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (175ms); anamnesis dogfood simulate-stale-handoff: pass (31ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1168ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (953ms); npm test: pass (6600ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 175 | active.md and latest archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 31 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1168 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 953 | passed |
| `npm test` | pass | 6600 | passed |


## Automated Self-Check — 2026-07-02T08:12:34.733Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@14:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (245ms); anamnesis dogfood simulate-stale-handoff: pass (33ms); anamnesis dogfood simulate-codex-native-dispatch: pass (2038ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1029ms); npm test: pass (6715ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 245 | active.md and latest archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 33 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 2038 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1029 | passed |
| `npm test` | pass | 6715 | passed |


## Automated Self-Check — 2026-07-02T08:22:35.459Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@14:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (214ms); anamnesis dogfood simulate-stale-handoff: pass (28ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1186ms); anamnesis dogfood real-codex-native-smoke: skipped (1ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (974ms); npm test: pass (6822ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 214 | active.md and latest archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 28 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1186 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 1 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 974 | passed |
| `npm test` | pass | 6822 | passed |


## Automated Self-Check — 2026-07-02T08:32:53.436Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@15:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (217ms); anamnesis dogfood simulate-stale-handoff: pass (29ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1249ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1007ms); npm test: pass (7196ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 217 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 29 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1249 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1007 | passed |
| `npm test` | pass | 7196 | passed |


## Automated Self-Check — 2026-07-02T08:43:42.205Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@15:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (317ms); anamnesis dogfood simulate-stale-handoff: pass (29ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1159ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (964ms); npm test: pass (6660ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 317 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 29 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1159 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 964 | passed |
| `npm test` | pass | 6660 | passed |


## Automated Self-Check — 2026-07-02T08:46:02.894Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@15:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (179ms); anamnesis dogfood simulate-stale-handoff: pass (29ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1138ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (959ms); npm test: pass (6630ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 179 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 29 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1138 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 959 | passed |
| `npm test` | pass | 6630 | passed |


## Automated Self-Check — 2026-07-02T09:03:04.400Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@15:in-sync
Drift: 33 clean, 0 modified, 0 missing
Status continuity: ready (6/6)
Codex hooks: 3 total (anamnesis 3, omx 0, plugin 0, user 0, invalid 0, warnings 0)
Doctor: ok (0 errors, 0 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 6/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | pass | enabled adapters have clean native or fallback surfaces (claude-code, codex, cursor) |
| Diagnostics quality | pass | doctor 0 error(s), 0 warning(s); status continuity ready=true; ontology gaps warnings=0; codex hook warnings=0; executable security warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (321ms); anamnesis dogfood simulate-stale-handoff: pass (30ms); anamnesis dogfood simulate-codex-native-dispatch: pass (1141ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (956ms); npm test: pass (6719ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 321 | active.md and warm active archive source pointers injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 30 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 1141 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 956 | passed |
| `npm test` | pass | 6719 | passed |
