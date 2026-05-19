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

### v1.4.3

Recorded: 2026-05-19

Purpose: verify the npm-published SessionStart ontology ordering patch, not
the local TypeScript source tree.

Results:

- npmjs.org `@mcprotein/anamnesis` latest returned `1.4.3`.
- Published CLI execution from `/private/tmp` returned `1.4.3`.
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
