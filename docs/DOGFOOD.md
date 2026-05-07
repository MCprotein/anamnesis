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
continuity state, appends an automated record to this file, and writes a
machine-readable evidence record to `.anamnesis/evidence/events.jsonl`.

The underlying checklist is:

1. `anamnesis status`
2. `anamnesis doctor`
3. `anamnesis ontology bootstrap --dry-run`
4. Active handoff switch simulation in a temporary all-adapter project
   created through the first-install all-adapter path
   (`init --tools claude-code,codex,cursor`);
   full ordered 3x3 source/target switching matrix coverage is locked by
   `cli/src/adapters/switching.test.ts` and
   [`docs/SWITCHING-SCENARIOS.md`](SWITCHING-SCENARIOS.md)
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
     slices and see whether bootstrap/enriched files are missing or stale,
     or whether introspector support is unavailable?
   - **Adapter parity surface**: are native or fallback command/skill/hook
     surfaces present for each enabled adapter?
   - **Diagnostics quality**: does `status`/`doctor` make missing or stale
     continuity pieces obvious?
   - **Verification strength**: do tests lock the continuity contract?

## Published Package Smoke — v0.7.0

Recorded: 2026-05-04

Purpose: verify the npm-published package, not the local TypeScript source.

Package:

```bash
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@0.7.0 -- anamnesis --version
```

Result: `0.7.0`

Smoke subjects:

| Subject | Command path | Result |
|---|---|---|
| Fresh NestJS/Prisma fixture | `init --tools all --allow-exec-adapters` -> `status` -> `doctor` -> `benchmark report` | init created 25 surfaces; continuity `6/6`; doctor `0` errors; benchmark `4/5` before Layer B enrichment |
| `sanitized-nest-prisma@e19fc0d` source snapshot | same published-package command path | init created 25 surfaces; continuity `6/6`; doctor `0` errors; benchmark `4/5` before Layer B enrichment |

Interpretation:

- The package tarball includes the built CLI, docs, base fragment, adapter
  surfaces, and framework fragments needed for first-install all-adapter use.
- Layer B enrichment warnings are expected immediately after `init`; the
  published CLI correctly routes the user to `/ontology-enrich`.
- No `v0.7.1` package-repair patch is needed from this smoke result.

## Published Package Smoke — v0.8.0

Recorded: 2026-05-04

Purpose: verify the npm-published package, not the local TypeScript source.

Package:

```bash
npm view '@mcprotein/anamnesis@0.8.0' version \
  --@mcprotein:registry=https://registry.npmjs.org/
cd "$(mktemp -d)"
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@0.8.0 -- anamnesis --version
```

Result: `0.8.0`

Smoke subjects:

| Subject | Command path | Result |
|---|---|---|
| Fresh Prisma fixture | `init --tools all --allow-exec-adapters` -> `status` -> `doctor` | init created 23 surfaces; base@8 and prisma@2 in sync; continuity `6/6`; doctor `0` errors and expected Layer B enrichment warning |

Interpretation:

- The `v0.8.0` npm package includes the built CLI, public API entrypoint,
  docs, base fragment, adapter surfaces, and Prisma fragment required for a
  fresh all-adapter install.
- Static ontology and Layer A bootstrap were generated for the fixture;
  missing `.enriched.yaml` is expected until an agent runs `/ontology-enrich`.
- The published CLI version check must run from a fresh temp directory. From
  this repository, `npm exec` can resolve a local or globally installed
  `anamnesis` binary before the published package binary.

## Published Package Smoke — v0.9.0

Recorded: 2026-05-04

Purpose: verify the npm-published package, not the local TypeScript source.

Package:

```bash
npm view '@mcprotein/anamnesis@0.9.0' version \
  --@mcprotein:registry=https://registry.npmjs.org/
cd "$(mktemp -d)"
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@0.9.0 -- anamnesis --version
```

Result: `0.9.0`

Smoke subjects:

| Subject | Command path | Result |
|---|---|---|
| Fresh Prisma fixture | `init --tools all --allow-exec-adapters` -> `status` -> `doctor` | init created 23 surfaces; base@8 and prisma@2 in sync; continuity `6/6`; doctor `0` errors and expected Layer B enrichment warning |

Interpretation:

- The `v0.9.0` npm package includes the built CLI plus the public ecosystem
  readiness docs: fragment authoring, registry design, signing/checksum
  policy, docs-site plan, benchmark gallery, and remote sync strategy.
- Static ontology and Layer A bootstrap were generated for the fixture;
  missing `.enriched.yaml` is expected until an agent runs `/ontology-enrich`.
- No `v0.9.1` package-repair patch is needed from this smoke result.

## Upgrade Smoke — v1.0 candidate

Recorded: 2026-05-04

Purpose: verify the v1.0 exit criterion that existing v0.7/v0.8/v0.9 managed
projects can upgrade without losing user edits.

Procedure:

1. For each published source version (`0.7.0`, `0.8.0`, `0.9.0`), create a
   fresh Prisma fixture.
2. Install that fixture with the published npm package:
   `anamnesis init --tools all --allow-exec-adapters`.
3. Add a user-authored sentinel line outside managed regions in `AGENTS.md`.
4. Run the current candidate CLI:
   `update --apply --allow-exec-adapters`, then `status`, then `doctor`.
5. Assert that the sentinel remains present, continuity is `ready (6/6)`, and
   doctor reports `0 error(s)`.

Results:

| Source version | User sentinel | Status | Doctor |
|---|---|---|---|
| `0.7.0` | preserved | continuity `ready (6/6)` | ok; `0 error(s)`, expected Layer B enrichment warning |
| `0.8.0` | preserved | continuity `ready (6/6)` | ok; `0 error(s)`, expected Layer B enrichment warning |
| `0.9.0` | preserved | continuity `ready (6/6)` | ok; `0 error(s)`, expected Layer B enrichment warning |

Interpretation:

- Existing published managed projects from the supported pre-v1 line can be
  updated to the current candidate without losing user-authored prose outside
  managed regions.
- The remaining warning is intentional: a fresh Prisma fixture has Layer A
  bootstrap facts but no agent-authored Layer B `.enriched.yaml` yet.

## Local Package Smoke — v1.0.0 candidate

Recorded: 2026-05-04

Purpose: verify the built npm tarball before publishing `1.0.0`.

Package:

```bash
npm pack --pack-destination /private/tmp
npm exec --yes --package=/private/tmp/mcprotein-anamnesis-1.0.0.tgz \
  -- anamnesis --version
```

Result: `1.0.0`

Smoke subjects:

| Subject | Command path | Result |
|---|---|---|
| Fresh Prisma fixture | local tarball `init --tools all --allow-exec-adapters` -> `status` -> `doctor` | init completed; continuity `ready (6/6)`; doctor `0` errors and expected Layer B enrichment warning |

Interpretation:

- The local `1.0.0` tarball exposes the correct CLI version and help output.
- A fresh all-adapter install from the tarball reaches the same continuity
  readiness target as the source-tree dogfood check.
- The remaining warning is intentional: generated Layer A bootstrap exists
  before an agent writes Layer B `.enriched.yaml`.

## Published Package Smoke — v1.0.0

Recorded: 2026-05-04

Purpose: verify the npm-published package, not the local TypeScript source or
local release tarball.

Package:

```bash
npm view '@mcprotein/anamnesis@1.0.0' version \
  --@mcprotein:registry=https://registry.npmjs.org/
cd "$(mktemp -d)"
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@1.0.0 -- anamnesis --version
```

Result: `1.0.0`

Smoke subjects:

| Subject | Command path | Result |
|---|---|---|
| Fresh Prisma fixture | published package `init --tools all --allow-exec-adapters` -> `status` -> `doctor` | init completed; continuity `ready (6/6)`; doctor `0` errors and expected Layer B enrichment warning |

Interpretation:

- The tag-triggered publish workflow produced an npmjs.org package visible as
  `@mcprotein/anamnesis@1.0.0`.
- The published CLI runs from a fresh temp directory and reports `1.0.0`.
- A fresh all-adapter project installed from npmjs.org reaches the v1.0
  continuity target without local source-tree fallback.

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
    version: 8
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
| Fragment state | `base@8` in-sync. |
| Drift | none. |
| Doctor | ok: 0 errors, 0 warnings. |
| Ontology gaps | `status` reports actionable warning counts plus stale bootstrap and informational Layer A coverage gaps. |
| Ontology bootstrap | `base` skipped-no-introspector; no files written. This is expected for the base fragment. |
| Tests | 430 tests passed across 37 files. |
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
  diagnostics, then simulates an active handoff switch locally. v0.7 also
  locks the full ordered 3x3 source/target switching matrix for Claude Code,
  Codex, and Cursor in
  [`docs/SWITCHING-SCENARIOS.md`](SWITCHING-SCENARIOS.md). These checks do
  not invoke real external Claude Code, Codex, or Cursor CLI sessions.

Next checks to improve:

- Use the `sanitized-nest-prisma` matrix finding to watch whether documented
  repair guidance is enough, or whether a future repair command is needed for
  user-modified managed surfaces.
- Use dogfood evidence from sanitized managed fixtures to choose the next
  ontology automation work.
- Promote the 3x3 switching matrix into the recurring dogfood score only if
  the artifact-level command needs per-pair regression reporting beyond
  `npm test`.
- Add real external agent-session smoke checks only if local artifact
  simulation misses a concrete adapter behavior.

## v0.6 Sanitized fixture Ontology Before/After

Date: 2026-05-03

Subject: `sanitized-nest-prisma@e19fc0d`

Method:

- Used a `git archive HEAD` snapshot under `/tmp` so the source repository was
  not modified.
- The live `sanitized-nest-prisma` working tree had uncommitted anamnesis changes,
  so this run intentionally excluded dirty working-tree state.
- Used current anamnesis from this repository as the library.
- Sensitive infrastructure credential values from the target repo docs were
  not copied into this summary.

### Before: static ontology only

Initial snapshot state:

| Check | Result |
|---|---|
| Tools | `claude-code` only |
| Fragments | `base@2`, `prisma@1`, `nestjs@1` |
| Managed entries | 9 clean |
| Static ontology | 3 files: `base.yaml`, `prisma.yaml`, `nestjs.yaml` |
| Bootstrap ontology | 0 files |
| Enriched ontology | 0 files |
| `status` continuity | issues `4/6` |
| `status` ontology gaps | 2 warnings, 1 info |
| `doctor` | 3 errors, 6 warnings |
| `ontology bootstrap --dry-run` | would write `prisma.bootstrap.yaml` and `nestjs.bootstrap.yaml` |

Before interpretation:

- A fresh agent could see generic Prisma and NestJS operating rules, but not
  the actual models, routes, queues, worker split, or domain flows.
- The v0.6 diagnostics correctly linked missing Layer A facts to the follow-up
  `/ontology-enrich` step and printed the expected `.enriched.yaml` targets.
- Existing managed surfaces still carried older continuity gaps, matching the
  v0.5 matrix finding for this repo.

### After: bootstrap plus agent enrichment

Actions in the temporary snapshot:

1. Enabled `claude-code`, `codex`, and `cursor` in `Agentfile`.
2. Ran `update --dry-run --allow-exec-adapters`.
3. Ran `update --apply --allow-exec-adapters`.
4. Ran `ontology bootstrap`.
5. Ran the agent-side enrichment pass and wrote:
   - `.anamnesis/ontology/prisma.enriched.yaml`
   - `.anamnesis/ontology/nestjs.enriched.yaml`
6. Re-ran `status`, `doctor`, and `ontology bootstrap --dry-run`.

After state:

| Check | Result |
|---|---|
| Tools | `claude-code`, `codex`, `cursor` |
| Fragments | `base@8`, `prisma@2`, `nestjs@1` all in sync |
| Managed entries | 21 clean |
| Static ontology | 3 files |
| Bootstrap ontology | 2 files: `prisma.bootstrap.yaml`, `nestjs.bootstrap.yaml` |
| Enriched ontology | 2 files: `prisma.enriched.yaml`, `nestjs.enriched.yaml` |
| `status` continuity | issues `5/6` |
| `status` ontology gaps | 0 warnings, 1 info |
| `doctor` | 3 errors, 1 warning |
| `ontology bootstrap --dry-run` | `prisma` and `nestjs` unchanged |

Generated Layer A facts:

| Fragment | Facts |
|---|---|
| `prisma` | 10 Prisma models with fields and relations |
| `nestjs` | 7 controllers and 30 HTTP routes |

Generated Layer B semantics:

| Category | Count | Examples |
|---|---:|---|
| Relationships | 8 | user-owned product data, tracked repository aggregate, HTTP/worker split, notification bridge |
| Flows | 5 | GitHub OAuth, commit sync persistence, monthly AI analysis, report lifecycle |
| Operational notes | 6 | Prisma client output, migration safety, deploy backend and worker together, API type SDK sync |
| Open questions | 2 | MinIO/report retention, whether `@Sse()` routes should become Layer A facts |

After interpretation:

- The ontology lifecycle moved from "static rules only" to "static +
  deterministic project facts + semantic project memory".
- The main product goal improved for this repo: a new agent can now recover
  concrete domain structure without re-reading all source files first:
  persisted entities, route surface, async queues, worker responsibilities,
  object-storage split, AI-analysis flow, notification flow, and key operating
  invariants.
- Remaining `doctor` failures are not ontology failures. They are the known
  existing-managed-repo repair issue where user-modified Claude Code surfaces
  block hook registration repair. This should stay tracked separately from the
  v0.6 ontology automation success.

v0.6 signal:

- The bounded Layer A approach is enough to establish factual shape for a real
  NestJS/Prisma backend.
- Layer B enrichment adds the product-level memory a parser should not try to
  infer: why the modules exist, how queues and workers interact, where domain
  ownership lives, and which operational invariants future agents must keep.
- The next product gap is not deeper framework parsing by default. The concrete
  follow-up from this run was the bounded `@Sse()` route question below:
  deterministic route facts belong in Layer A, but product meaning still
  belongs in Layer B.

### Follow-up: NestJS SSE route fact

Date: 2026-05-03

A follow-up run on a fresh `sanitized-nest-prisma@e19fc0d` archive snapshot after
adding NestJS `@Sse()` support showed:

| Check | Result |
|---|---|
| Source repo mutation | none; the run used a `/tmp` git archive snapshot |
| NestJS route facts | `30 -> 31` |
| New Layer A route | `method: SSE`, `path: /notifications/stream`, `handler: stream` |
| Ontology warnings after bootstrap | only missing enrichment warnings remained |

The v0.6.0 release-candidate replay produced the same 31 NestJS route facts
with `generator: anamnesis@0.6.0` in the bootstrap output.

Interpretation:

- The first v0.6 dogfood run produced a valid Layer A improvement because the
  missing fact was deterministic, shallow, and directly visible in NestJS
  controller source.
- This does not justify broad technology coverage. Future Layer A changes
  still need dogfood or benchmark evidence that a directly parseable fact is
  hurting agent continuity.

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


## Automated Self-Check — 2026-05-02T16:44:08.869Z

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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (306ms); anamnesis dogfood simulate-stale-handoff: pass (112ms); npm run typecheck: pass (1404ms); npm test: pass (2086ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 306 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 112 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1404 | passed |
| `npm test` | pass | 2086 | passed |


## Automated Self-Check — 2026-05-02T16:57:21.107Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@8:in-sync
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (232ms); anamnesis dogfood simulate-stale-handoff: pass (37ms); npm run typecheck: pass (1293ms); npm test: pass (2132ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 232 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 37 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1293 | passed |
| `npm test` | pass | 2132 | passed |


## Automated Self-Check — 2026-05-03T11:32:29.914Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@8:in-sync
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (575ms); anamnesis dogfood simulate-stale-handoff: pass (39ms); npm run typecheck: pass (1342ms); npm test: pass (2211ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 575 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 39 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1342 | passed |
| `npm test` | pass | 2211 | passed |


## Automated Self-Check — 2026-05-03T12:51:17.295Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@8:in-sync
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (856ms); anamnesis dogfood simulate-stale-handoff: pass (46ms); npm run typecheck: pass (1384ms); npm test: pass (2533ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 856 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 46 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1384 | passed |
| `npm test` | pass | 2533 | passed |


## Automated Self-Check — 2026-05-04T04:20:51.010Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@8:in-sync
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (426ms); anamnesis dogfood simulate-stale-handoff: pass (52ms); npm run typecheck: pass (1503ms); npm test: pass (3167ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 426 | active.md and latest archive injected; Codex/Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 52 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1503 | passed |
| `npm test` | pass | 3167 | passed |


## Automated Self-Check — 2026-05-04T14:16:50.904Z

Continuity readiness score: 3/5 (regressed vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@8:update-available
Drift: 19 clean, 0 modified, 0 missing
Status continuity: issues (5/6)
Doctor: ok (0 errors, 2 warnings)
Ontology gaps: 0 warning(s), 1 info
Ontology bootstrap dry-run: skipped-no-introspector=1

| Criterion | Result | Detail |
|---|---|---|
| Context continuity | pass | enabled tools: claude-code, codex, cursor; status continuity 5/6 |
| Ontology availability | pass | 1 clean ontology file(s) are tracked |
| Adapter parity surface | fail | missing or drifted surfaces: .anamnesis/codex-native-hooks/session-start.mjs, .codex/config.toml [features.codex_hooks=true], .codex/hooks.json [hook:SessionStart:node ".anamnesis/codex-native-hooks/session-start.mjs"] |
| Diagnostics quality | fail | doctor 0 error(s), 2 warning(s); status continuity ready=false; ontology gaps warnings=0 |
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (360ms); anamnesis dogfood simulate-stale-handoff: pass (39ms); npm run typecheck: pass (1377ms); npm test: pass (2454ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 360 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 39 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1377 | passed |
| `npm test` | pass | 2454 | passed |

## Automated Self-Check — 2026-05-04T14:17:39.358Z

Continuity readiness score: 5/5 (improved vs previous 3/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@9:in-sync
Drift: 22 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (371ms); anamnesis dogfood simulate-stale-handoff: pass (37ms); npm run typecheck: pass (1385ms); npm test: pass (2553ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 371 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 37 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1385 | passed |
| `npm test` | pass | 2553 | passed |


## Automated Self-Check — 2026-05-04T16:11:54.326Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (429ms); anamnesis dogfood simulate-stale-handoff: pass (40ms); npm run typecheck: pass (1377ms); npm test: pass (2710ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 429 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 40 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1377 | passed |
| `npm test` | pass | 2710 | passed |

## Automated Self-Check — 2026-05-04T16:12:35.500Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (424ms); anamnesis dogfood simulate-stale-handoff: pass (37ms); npm run typecheck: pass (1467ms); npm test: pass (2619ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 424 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 37 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1467 | passed |
| `npm test` | pass | 2619 | passed |

## Automated Self-Check — 2026-05-06T15:15:43.631Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (277ms); anamnesis dogfood simulate-stale-handoff: pass (39ms); npm run typecheck: pass (1666ms); npm test: pass (2964ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 277 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 39 | status and doctor detect active.md that does not reference the newest archive |
| `npm run typecheck` | pass | 1666 | passed |
| `npm test` | pass | 2964 | passed |

## Automated Self-Check — 2026-05-06T16:41:03.877Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (382ms); anamnesis dogfood simulate-stale-handoff: pass (38ms); anamnesis dogfood simulate-codex-native-dispatch: pass (318ms); anamnesis dogfood real-codex-native-smoke: pass (19699ms); npm run typecheck: pass (1421ms); npm test: pass (2886ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 382 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 38 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 318 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | pass | 19699 | real Codex CLI invoked SessionStart hook before expected isolated-CODEX_HOME auth failure |
| `npm run typecheck` | pass | 1421 | passed |
| `npm test` | pass | 2886 | passed |


## Automated Self-Check — 2026-05-07T00:48:32.166Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (296ms); anamnesis dogfood simulate-stale-handoff: pass (44ms); anamnesis dogfood simulate-codex-native-dispatch: pass (359ms); anamnesis dogfood real-codex-native-smoke: pass (19990ms); anamnesis dogfood real-codex-project-hook-smoke: pass (19431ms); npm run typecheck: pass (1541ms); npm test: pass (3721ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 296 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 44 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 359 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | pass | 19990 | real Codex CLI invoked SessionStart hook before expected isolated-CODEX_HOME auth failure |
| `anamnesis dogfood real-codex-project-hook-smoke` | pass | 19431 | real Codex CLI discovered project-local .codex/hooks.json SessionStart hook before expected isolated-CODEX_HOME auth failure |
| `npm run typecheck` | pass | 1541 | passed |
| `npm test` | pass | 3721 | passed |


## Automated Self-Check — 2026-05-07T00:58:47.904Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (312ms); anamnesis dogfood simulate-stale-handoff: pass (48ms); anamnesis dogfood simulate-codex-native-dispatch: pass (381ms); anamnesis dogfood real-codex-native-smoke: pass (19636ms); anamnesis dogfood real-codex-project-hook-smoke: pass (19947ms); anamnesis dogfood real-codex-user-prompt-smoke: pass (20017ms); npm run typecheck: pass (3312ms); npm test: pass (7677ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 312 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 48 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 381 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | pass | 19636 | real Codex CLI invoked SessionStart hook before expected isolated-CODEX_HOME auth failure |
| `anamnesis dogfood real-codex-project-hook-smoke` | pass | 19947 | real Codex CLI discovered project-local .codex/hooks.json SessionStart hook before expected isolated-CODEX_HOME auth failure |
| `anamnesis dogfood real-codex-user-prompt-smoke` | pass | 20017 | real Codex CLI invoked UserPromptSubmit hook with additionalContext output before expected isolated-CODEX_HOME auth failure |
| `npm run typecheck` | pass | 3312 | passed |
| `npm test` | pass | 7677 | passed |


## Automated Self-Check — 2026-05-07T01:11:11.298Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (391ms); anamnesis dogfood simulate-stale-handoff: pass (49ms); anamnesis dogfood simulate-codex-native-dispatch: pass (382ms); anamnesis dogfood real-codex-native-smoke: pass (20197ms); anamnesis dogfood real-codex-project-hook-smoke: pass (19675ms); anamnesis dogfood real-codex-user-prompt-smoke: pass (19557ms); anamnesis dogfood real-codex-tool-turn-smoke: pass (14096ms); npm run typecheck: pass (1494ms); npm test: pass (4615ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 391 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 49 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 382 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | pass | 20197 | real Codex CLI invoked SessionStart hook before expected isolated-CODEX_HOME auth failure |
| `anamnesis dogfood real-codex-project-hook-smoke` | pass | 19675 | real Codex CLI discovered project-local .codex/hooks.json SessionStart hook before expected isolated-CODEX_HOME auth failure |
| `anamnesis dogfood real-codex-user-prompt-smoke` | pass | 19557 | real Codex CLI invoked UserPromptSubmit hook with additionalContext output before expected isolated-CODEX_HOME auth failure |
| `anamnesis dogfood real-codex-tool-turn-smoke` | pass | 14096 | real Codex CLI Bash tool turn invoked PreToolUse and PostToolUse hooks |
| `npm run typecheck` | pass | 1494 | passed |
| `npm test` | pass | 4615 | passed |


## Automated Self-Check — 2026-05-07T01:35:28.004Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (273ms); anamnesis dogfood simulate-stale-handoff: pass (37ms); anamnesis dogfood simulate-codex-native-dispatch: pass (344ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1406ms); npm test: pass (3638ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 273 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 37 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 344 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1406 | passed |
| `npm test` | pass | 3638 | passed |

## Automated Self-Check — 2026-05-07T01:54:38.442Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (250ms); anamnesis dogfood simulate-stale-handoff: pass (36ms); anamnesis dogfood simulate-codex-native-dispatch: pass (310ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1271ms); npm test: pass (3327ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 250 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 36 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 310 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1271 | passed |
| `npm test` | pass | 3327 | passed |


## Automated Self-Check — 2026-05-07T03:51:40.181Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (937ms); anamnesis dogfood simulate-stale-handoff: pass (51ms); anamnesis dogfood simulate-codex-native-dispatch: pass (474ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (2421ms); npm test: pass (6232ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 937 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 51 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 474 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 2421 | passed |
| `npm test` | pass | 6232 | passed |


## Automated Self-Check — 2026-05-07T03:57:51.937Z

Continuity readiness score: 5/5 (unchanged vs previous 5/5)

Project: anamnesis
Tools: claude-code, codex, cursor
Fragments: base@10:in-sync
Drift: 29 clean, 0 modified, 0 missing
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
| Verification strength | pass | anamnesis dogfood simulate-handoff: pass (408ms); anamnesis dogfood simulate-stale-handoff: pass (37ms); anamnesis dogfood simulate-codex-native-dispatch: pass (363ms); anamnesis dogfood real-codex-native-smoke: skipped (0ms); anamnesis dogfood real-codex-project-hook-smoke: skipped (0ms); anamnesis dogfood real-codex-user-prompt-smoke: skipped (0ms); anamnesis dogfood real-codex-tool-turn-smoke: skipped (0ms); npm run typecheck: pass (1334ms); npm test: pass (3570ms) |

| Verification command | Result | ms | Detail |
|---|---|---:|---|
| `anamnesis dogfood simulate-handoff` | pass | 408 | active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present |
| `anamnesis dogfood simulate-stale-handoff` | pass | 37 | status and doctor detect active.md that does not reference the newest archive |
| `anamnesis dogfood simulate-codex-native-dispatch` | pass | 363 | synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers |
| `anamnesis dogfood real-codex-native-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke |
| `anamnesis dogfood real-codex-project-hook-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke |
| `anamnesis dogfood real-codex-user-prompt-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke |
| `anamnesis dogfood real-codex-tool-turn-smoke` | skipped | 0 | set ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1 to run the authenticated Codex CLI tool-turn smoke |
| `npm run typecheck` | pass | 1334 | passed |
| `npm test` | pass | 3570 | passed |
