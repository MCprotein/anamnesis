# Capabilities

Capabilities describe what a fragment supplies. Adapters translate those
capabilities into each tool's files and instructions. This directory is a
conceptual reference; the executable schema and renderers live under `cli/src/`.

## Supported types

| Type | Content and purpose |
| --- | --- |
| `project_memory` | Project instructions, anchored in `AGENTS.md` |
| `ontology` | Structured project facts in `.anamnesis/ontology/` |
| `executable_hook` | Event-driven procedures, with native execution or documented fallbacks |
| `skill` | Reusable agent procedure with a `SKILL.md` entrypoint |
| `slash_command` | User-invoked procedure |
| `task_harness` | Reusable task contract under `.anamnesis/task-harnesses/` |

The test-backed [adapter parity matrix](../docs/ADAPTER-PARITY.md) is the
canonical mapping to tool surfaces. Claude Code has native hooks, skills and
commands. Codex has native skills and supported native hooks plus instruction
fallbacks; its slash-command capability uses instructions. Cursor uses
`AGENTS.md` and `.cursor/rules/*.mdc` fallbacks. Native hook installation and
runtime approval are separate concerns. Executable and agent-action surfaces
require `--allow-exec-adapters` when applying them.

## Implementation

- [Fragment schema](../cli/src/core/fragments.ts): discriminated capability union and validation.
- [Render contract](../cli/src/core/render.ts): `CapabilityRenderer.plan(capability, ctx)` returns declarative `RenderAction[]`; `RendererRegistry` selects by adapter and capability type.
- [Adapters](../cli/src/adapters/): tool-specific renderers.
- [Applier](../cli/src/core/applier.ts): managed region/file application and conflict handling.

A fragment can use common content while adapters choose native or fallback
surfaces. Unsupported native execution is not equivalent to missing content.
See [fragment authoring](../docs/FRAGMENT-AUTHORING.md) for source layouts,
`adapters_supported`, and side-effect declarations. Future capability ideas
belong in the [roadmap](../docs/ROADMAP.md), not the current schema.
