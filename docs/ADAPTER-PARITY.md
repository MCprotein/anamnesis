# Adapter Parity Matrix

v0.7 tracks **user-facing parity**, not identical native UI. Claude Code,
Codex, and Cursor expose different primitives, so a capability can be native
on one adapter and a fallback on another while still preserving the same user
outcome.

Status terms:

- `native`: the target tool has a first-class surface for the capability.
- `fallback`: anamnesis renders explicit files or instructions that let the
  agent produce the same user-facing result, but the tool does not provide the
  same native primitive.

The table below is generated from the canonical fixture in
`cli/src/adapters/parity.ts` and locked by `cli/src/adapters/parity.test.ts`.

<!-- adapter-parity:matrix:start -->
| Capability | Purpose | Claude Code | Codex | Cursor |
|---|---|---|---|---|
| `project_memory` | Always-loaded project context and operating rules | **native**<br>`AGENTS.md` region plus `CLAUDE.md` entrypoint<br>tested: continuity acceptance, claude_md renderer | **native**<br>`AGENTS.md` region<br>tested: continuity acceptance, codex registry | **native**<br>`AGENTS.md` region read by Cursor<br>tested: continuity acceptance, cursor registry |
| `ontology` | Structured project facts and ontology slices | **native**<br>`.anamnesis/ontology/*.yaml` plus SessionStart injection<br>tested: continuity acceptance, dogfood check | **native**<br>`.anamnesis/ontology/*.yaml` plus native SessionStart wrapper when exec adapters are allowed; `AGENTS.md` fallback remains<br>tested: continuity acceptance, codex native hook tests | **fallback**<br>`.anamnesis/ontology/*.yaml` plus Cursor rules<br>tested: continuity acceptance, dogfood check |
| `executable_hook` | Event-triggered automation and operational reminders | **native**<br>`.claude/hooks/*.sh` registered in `.claude/settings.json`<br>tested: continuity acceptance, hook renderer tests | **fallback**<br>native SessionStart wrapper for base continuity hooks; `AGENTS.md` hook region plus optional Git pre-commit bridge for other hook events<br>tested: codex native hook tests, codex fallback tests | **fallback**<br>`.cursor/rules/*.mdc` instruction fallback<br>tested: cursor MDC tests, registry coverage |
| `skill` | Reusable agent procedure | **native**<br>`.claude/skills/<name>/SKILL.md`<br>tested: continuity acceptance, skill renderer tests | **fallback**<br>`AGENTS.md` skill region<br>tested: continuity acceptance, codex fallback tests | **fallback**<br>`.cursor/rules/<name>.mdc`<br>tested: continuity acceptance, cursor MDC tests |
| `slash_command` | User-invoked command procedure | **native**<br>`.claude/commands/<name>.md`<br>tested: continuity acceptance, slash command renderer tests | **fallback**<br>`AGENTS.md` command region<br>tested: continuity acceptance, codex fallback tests | **fallback**<br>`.cursor/rules/<name>-cmd.mdc`<br>tested: continuity acceptance, cursor MDC tests |
<!-- adapter-parity:matrix:end -->

## Reading The Matrix

This matrix does not mean every fragment renders every capability on every
adapter. A fragment can still restrict a particular capability with
`adapters_supported` when that behavior would be misleading outside one tool.
The matrix means the adapter has a tested rendering strategy when a capability
is allowed for that adapter.

Known implications:

- Claude Code has the richest native surface today: hooks, slash commands,
  skills, and SessionStart ontology injection are first-class.
- Codex now has a native SessionStart continuity path for ontology and
  handoff injection when executable adapters are allowed. Other Codex hook
  events, commands, and skills still keep explicit fallback surfaces because
  the user-facing goal is continuity, not identical UI.
- If a future adapter cannot preserve project memory, ontology access, or
  handoff continuity, it should be marked as unsupported instead of silently
  rendering partial instructions.
