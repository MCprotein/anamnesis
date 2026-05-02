# capabilities

The **intermediate representation (IR)** that sits between tool-agnostic content and tool-specific adapters.

Each capability is a semantic unit with a **rendering contract** — "given this content + params, render it into this tool's native surface."

## The five capabilities (v0.1)

| Capability | What it represents | CC native | Codex native | Cursor native (v0.2+) |
|---|---|---|---|---|
| `project_memory` | Always-loaded free-form context | `AGENTS.md` + `CLAUDE.md` entrypoint | `AGENTS.md` | `.cursor/rules/*.mdc (alwaysApply)` |
| `ontology` | Structured reference, consulted on demand | SessionStart hook injection | `AGENTS.md` instruction pointing to file | `rules` instruction |
| `executable_hook` | Event-driven automation | `.claude/hooks/` + `settings.json` | git hook + LLM instruction (best-effort) | git hook + LLM instruction |
| `skill` | Reusable work procedure | `.claude/skills/<name>/SKILL.md` | `AGENTS.md` section (fallback) | `rules` (fallback) |
| `slash_command` | User-invoked command | `.claude/commands/*.md` | — (not supported) | — (not supported) |

- ✅ native: tool runs the capability automatically
- 🟡 best-effort: rendered as instruction/fallback mechanism
- ❌: unsupported, recorded in `limitations.md`

## Why an IR?

Without an IR, fragments would couple tightly to one tool's surface (e.g., all prisma fragments would be hardcoded to `.claude/hooks/`). The IR decouples **what a fragment wants to do** from **how a specific tool achieves it**, so adding new tool adapters (Cursor, Aider, Windsurf, …) doesn't require rewriting every fragment.

See `docs/DESIGN.md` §4.1–4.2 for the full rationale.

## Planned v0.2+ additions

- `scoped_rule` — Cursor-native glob-matched rule injection (equivalent on CC via nested `CLAUDE.md`)
- `pre_commit_check` — specialized form of `executable_hook` targeting git lifecycle only

## Implementation

Capability rendering contracts will be implemented as TypeScript modules under `cli/src/capabilities/` during v0.1 build. Each capability exports:

- `validate(input)` — check content and params
- `render(input, adapter)` — produce adapter-specific output files
- `regionId(input)` — deterministic id for manifest tracking
