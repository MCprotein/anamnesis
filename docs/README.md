# Documentation map

Use the current guides below for commands and behavior. Design proposals and
historical measurements are retained separately because they explain decisions,
not because every command they discuss has shipped.

## Current guides and contracts

| Topic | Canonical entry |
| --- | --- |
| Installation and daily workflow | [User guide](USER-GUIDE.md) |
| Architecture | [Design](DESIGN.md), with explicitly marked historical sections |
| Terminal presentation | [Product design](../DESIGN.md) |
| Agentfile schema and upgrades | [Schema](../specs/agentfile.md), [migrations](AGENTFILE-MIGRATIONS.md) |
| Capabilities and adapter support | [Capabilities](../capabilities/README.md), [parity](ADAPTER-PARITY.md) |
| Fragment detection and authoring | [Rulebook](../rulebook.md), [catalog](../fragments/README.md), [authoring](FRAGMENT-AUTHORING.md) |
| Context, ontology and instructions | [Context index](CONTEXT-INDEX-DESIGN.md), [ontology bootstrap](ONTOLOGY-BOOTSTRAP.md), [instruction audit](INSTRUCTION-AUDIT.md) |
| Cross-agent continuity | [Switching guide](AGENT-SWITCHING-GUIDE.md), [handoff lifecycle](HANDOFF-LIFECYCLE.md), [Work design](WORK-UNIT-DESIGN.md) |
| Hooks and runtime diagnostics | [Hooks](HOOKS.md), [Codex continuity](CODEX-CONTINUITY.md), [doctor](DOCTOR.md), [repair](REPAIR.md) |
| Maintainer workflow | [CLI source](../cli/README.md), [API](API.md), [releases](RELEASING.md) |
| Measurements | [Benchmarks](BENCHMARKS.md), [evidence index](benchmark-evidence/README.md) |
| Shipped/deferred work | [Roadmap](ROADMAP.md), [changelog](../CHANGELOG.md) |

Work and task-harness design pages also contain explicitly labeled future
contracts; consult their implementation-status sections before using examples.

## Proposals and history

- [Fragment registry](FRAGMENT-REGISTRY.md), [signing](FRAGMENT-SIGNING.md),
  [remote sync](REMOTE-SYNC-STRATEGY.md), and [Codex plugin packaging](CODEX-PLUGIN-PACKAGING.md)
  are proposals/research, not additional installed CLI commands.
- [Registry v1 decision](REGISTRY-V1-DECISION.md), [Agentfile v1 freeze](AGENTFILE-V1-FREEZE.md),
  [command UX plan](COMMAND-UX-PLAN.md), and [README claim ledger](README-CLAIMS.md)
  retain dated decisions and measurements with current-status pointers.
- [Deprecated documents](deprecated/README.md), `base/.versions/`,
  `fragments/*/.versions/`, and benchmark snapshots preserve historical evidence.
  Fragment version directories remain inputs for pinned-version loading.
- Generated `.anamnesis/codex-instructions/`, `.claude/`, `.codex/` and managed
  `AGENTS.md`/`CLAUDE.md` regions come from their fragment or renderer sources.
  Fix the source and regenerate through the managed writer.

The [2026-09-21 audit](DOCUMENTATION-AUDIT-2026-09-21.md) records coverage,
corrections and validation for the repository-wide refresh.
