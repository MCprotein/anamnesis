# Agent Switching Guide

This guide describes the intended v0.7 user journey: install anamnesis once,
work in one agent, switch to another agent, and continue from the same project
state without re-briefing the new agent.

It documents user-facing parity, not identical native UI. Claude Code, Codex,
and Cursor expose different extension surfaces, so anamnesis renders the same
context and workflow contract through the best available surface for each tool.

## 1. Install All Agent Surfaces

For a project that may move between Claude Code, Codex, and Cursor, initialize
all supported adapters up front:

```bash
anamnesis init --tools all --allow-exec-adapters
```

Use `--dry-run` first when adopting anamnesis in an existing project:

```bash
anamnesis init --tools all --allow-exec-adapters --dry-run
```

The install creates or updates:

- `AGENTS.md` as the canonical cross-agent operating surface.
- `CLAUDE.md` as the Claude Code entrypoint back to `AGENTS.md`.
- `.claude/hooks`, `.claude/commands`, and `.claude/skills` when executable
  adapters are allowed.
- `.cursor/rules/*` for Cursor fallback rules.
- `.anamnesis/ontology/*.yaml` static ontology slices.
- `.anamnesis/ontology/*.bootstrap.yaml` when deterministic Layer A
  introspection applies.

Confirm the install:

```bash
anamnesis status
anamnesis doctor
```

## 2. Keep Ontology Current

anamnesis separates generated facts from agent-authored semantics:

- Static ontology slices come from installed fragments.
- `.bootstrap.yaml` files come from deterministic CLI introspectors.
- `.enriched.yaml` files come from `/ontology-enrich`, where the active agent
  turns facts into relationships, flows, intent, invariants, and open
  questions.

Recommended refresh loop:

```bash
anamnesis status
anamnesis ontology bootstrap
```

Then ask the active agent to run `/ontology-enrich` when `status`, `doctor`, or
`ontology bootstrap` says semantic enrichment is missing or stale.

The enriched layer is append-safe by design: existing reviewed entries should
be preserved, new facts appended with stable IDs, and replaced designs marked
with `supersedes`.

## 3. Prepare Before Switching

Before closing one tool or moving to another, run `/handoff-prepare` in the
current agent.

Adapter surfaces:

| Current agent | Handoff prepare surface |
|---|---|
| Claude Code | native `.claude/commands/handoff-prepare.md` |
| Codex | `AGENTS.md` `/handoff-prepare` command region |
| Cursor | `.cursor/rules/handoff-prepare-cmd.mdc` fallback rule |

The handoff writes:

- `.anamnesis/handoff/active.md` as the current task index.
- `.anamnesis/handoff/<timestamp>.md` as the detailed archive.

The archive should capture the goal, done work, in-flight files, decisions,
open questions, and concrete next steps. This is the durable bridge between
agents.

## 4. Resume In The Next Agent

Start the target agent in the same repository. The target agent should load:

1. `AGENTS.md` and any tool-specific entrypoint that points to it.
2. `.anamnesis/ontology/*.yaml`, `.bootstrap.yaml`, and `.enriched.yaml`.
3. `.anamnesis/handoff/active.md`.
4. The archive referenced by `active.md`, or the newest timestamped handoff
   archive when the index is stale.

Adapter resume surfaces:

| Target agent | Resume surface |
|---|---|
| Claude Code | SessionStart `.claude/hooks/inject-handoff.sh` plus ontology injection |
| Codex | Native `.codex/hooks.json` SessionStart wrapper when exec adapters are allowed, plus `AGENTS.md` fallback procedures |
| Cursor | `AGENTS.md` session-start procedure plus `.cursor/rules/*` |

Expected result: the new agent can continue the current task from the handoff
and ontology state without the user writing a custom "read these files first"
prompt.

The ordered 3x3 source/target matrix is documented in
[`SWITCHING-SCENARIOS.md`](SWITCHING-SCENARIOS.md).

## 5. Verify Continuity

Use these checks after setup, after upgrades, and before publishing claims:

```bash
anamnesis status --json
anamnesis doctor
anamnesis dogfood check --append
anamnesis benchmark report --append
```

What to look for:

- Continuity readiness passes for project memory, ontology, handoff startup,
  adapter surfaces, and managed drift.
- Ontology gaps are either resolved or intentionally documented.
- Stale active handoff diagnostics are clear.
- Adapter surfaces exist for the tools you expect to use.
- Benchmark reports show whether static, bootstrap, enriched, continuity, and
  adapter-surface evidence improved.

## Known Limits

- Claude Code has the richest native surface today. Hooks, commands, skills,
  and SessionStart injection are first-class there.
- Codex now has native SessionStart continuity and selected native lifecycle
  hook wrappers when executable adapters are allowed, but still relies on
  explicit fallback instructions for commands, skills, and unsupported hook
  surfaces. Cursor relies on fallback rules and startup instructions.
- Real external agent sessions can still fail if the target agent ignores
  installed startup instructions. `status`, `doctor`, switching fixtures, and
  dogfood checks reduce this risk but do not control third-party agent
  behavior.
- Layer A introspection is deliberately shallow and deterministic. Project
  intent belongs in Layer B enriched ontology, not in a framework-specific
  knowledge engine inside the CLI.
- `--allow-exec-adapters` is required before anamnesis writes executable
  Claude Code hooks, commands, and skills.

## Related References

- [`ADAPTER-PARITY.md`](ADAPTER-PARITY.md) — capability-level native vs
  fallback surfaces.
- [`SWITCHING-SCENARIOS.md`](SWITCHING-SCENARIOS.md) — tested 3x3 source and
  target agent matrix.
- [`ONTOLOGY-BOOTSTRAP.md`](ONTOLOGY-BOOTSTRAP.md) — Layer A / Layer B ontology
  lifecycle.
- [`BENCHMARKS.md`](BENCHMARKS.md) — deterministic context-quality reports.
- [`DOGFOOD.md`](DOGFOOD.md) — self-check and sanitized-fixture dogfood evidence.
