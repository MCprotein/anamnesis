# Switching Scenarios

v0.7 treats agent switching as an ordered 3x3 matrix. Same-agent rows are
included because "close and reopen the same tool" has the same continuity
requirement as switching tools: the next session should resume from
`.anamnesis/handoff/active.md` plus the referenced archive without a user
re-brief.

The table below is generated from `cli/src/adapters/switching.ts` and locked
by `cli/src/adapters/switching.test.ts`.

<!-- switching-scenarios:matrix:start -->
| # | From | To | Prepare surface | Resume surface | Expectation |
|---:|---|---|---|---|---|
| 1 | Claude Code | Claude Code | native `.claude/commands/handoff-prepare.md` | SessionStart `.claude/hooks/inject-handoff.sh` | same-agent restart still resumes from active handoff state |
| 2 | Claude Code | Codex | native `.claude/commands/handoff-prepare.md` | native `.codex/hooks.json` SessionStart wrapper + `AGENTS.md` fallback | target agent resumes without a user re-brief |
| 3 | Claude Code | Cursor | native `.claude/commands/handoff-prepare.md` | `AGENTS.md` session-start handoff procedure | target agent resumes without a user re-brief |
| 4 | Codex | Claude Code | `AGENTS.md` `/handoff-prepare` command region | SessionStart `.claude/hooks/inject-handoff.sh` | target agent resumes without a user re-brief |
| 5 | Codex | Codex | `AGENTS.md` `/handoff-prepare` command region | native `.codex/hooks.json` SessionStart wrapper + `AGENTS.md` fallback | same-agent restart still resumes from active handoff state |
| 6 | Codex | Cursor | `AGENTS.md` `/handoff-prepare` command region | `AGENTS.md` session-start handoff procedure | target agent resumes without a user re-brief |
| 7 | Cursor | Claude Code | `.cursor/rules/handoff-prepare-cmd.mdc` fallback rule | SessionStart `.claude/hooks/inject-handoff.sh` | target agent resumes without a user re-brief |
| 8 | Cursor | Codex | `.cursor/rules/handoff-prepare-cmd.mdc` fallback rule | native `.codex/hooks.json` SessionStart wrapper + `AGENTS.md` fallback | target agent resumes without a user re-brief |
| 9 | Cursor | Cursor | `.cursor/rules/handoff-prepare-cmd.mdc` fallback rule | `AGENTS.md` session-start handoff procedure | same-agent restart still resumes from active handoff state |
<!-- switching-scenarios:matrix:end -->

## What Is Tested

For every ordered pair:

- The source adapter has a `/handoff-prepare` surface that points at
  `.anamnesis/handoff/active.md` and timestamped archives.
- The target adapter has a resume surface for loading `active.md` and the
  referenced archive. Claude Code uses native SessionStart injection, Codex
  uses native SessionStart when exec adapters are installed plus an AGENTS
  fallback, and Cursor uses the `AGENTS.md` session-start procedure.
- `status` accepts a current active handoff for that scenario.
- `status` and `doctor` reject stale active handoff state when `active.md`
  does not reference the newest archive.

This is still user-facing parity, not identical UI. Claude Code and Codex can
inject handoff context automatically at SessionStart when their native hook
surfaces are installed. Cursor relies on the agent following the installed
`AGENTS.md` startup procedure.
