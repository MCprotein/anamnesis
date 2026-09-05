---
description: Prepare a handoff document so the next agent (or session) can resume without context loss
---

Capture the current task state in a structured handoff file. The next agent — could be a fresh Claude session, Codex, Cursor, or anything else reading AGENTS.md and `.anamnesis/handoff/` — will load it on session start and pick up where you left off.

## Invocation contract

- If the user explicitly requests `/handoff-prepare` as the standalone task, create the handoff, report the result, and stop.
- If this procedure is invoked as an auxiliary checkpoint during an active task, create the handoff and then continue the original task. The checkpoint does not broaden the user's request or authorize additional work.
- A hook or reminder that merely suggests `/handoff-prepare` does not invoke this procedure and must not create or update handoff files automatically.

## When to invoke

- Token usage approaching the limit and you might lose conversation memory
- About to switch tools (Claude → Codex, etc.) for cost or capability reasons
- Stopping work mid-task and resuming later
- User explicitly asks for a handoff

## Steps

1. **Determine current task context.** What was the user trying to accomplish overall? What's the immediate sub-step?

2. **Identify completed work.**
   - `git log --oneline -10` to see recent commits
   - Note which commits belong to this task vs unrelated chores

3. **Identify in-flight work.**
   - `git status` for uncommitted changes
   - For each modified/added file: what change, why

4. **Capture significant decisions made in this session.**
   - Choices the next agent needs to know (X over Y, rationale, constraints discovered)

5. **List open questions or blockers.**
   - Items waiting on user input, external systems, or earlier dependencies

6. **Write the archived handoff file** to `.anamnesis/handoff/<ISO-timestamp>.md` (filesystem-safe timestamp, colons replaced by `-`, e.g., `.anamnesis/handoff/2026-04-27T12-34-56Z.md`). Create the directory if missing.

   Use exactly this structure:

   ```markdown
   ---
   created: <ISO-8601 UTC timestamp>
   agent: <claude-code | codex | cursor | unknown>
   git_ref: <git rev-parse HEAD output>
   ---

   # Handoff — <one-line task summary>

   ## Goal
   <2–3 sentences on the overall objective>

   ## Done so far
   - <bullet> (commit <sha>)
   - <bullet> (uncommitted, in <file>)

   ## In flight
   - <file>: <intent — what change, why>
   - <decision being deliberated>: <options under consideration>

   ## Decisions
   - <decision>: <rationale>

   ## Open questions / blockers
   - <item>

   ## Next steps
   1. <action>
   2. <action>
   ```

7. **Update the active handoff index** at `.anamnesis/handoff/active.md`.
   This file is the compact multi-task map that gets injected first on
   session start. Read the existing file if present and preserve user-owned
   wording, custom sections, unrelated entries, and still-valid tasks. Add or
   update only the current task with a pointer to the archived handoff. When
   exact evidence proves an existing active entry is complete, move its summary
   to `Recently completed` or leave the history intact rather than erasing it.
   If it is ambiguous whether an entry belongs to the current task or remains
   active, ask the user before changing that entry.

   Use this structure:

   ```markdown
   ---
   updated: <ISO-8601 UTC timestamp>
   agent: <claude-code | codex | cursor | unknown>
   git_ref: <git rev-parse HEAD output>
   ---

   # Active handoff index

   ## Current focus
   - <task summary> — archive: `.anamnesis/handoff/<ISO-timestamp>.md`

   ## Active tasks
   - [in-flight] <task summary> — next: <next action> — archive: `<relative path>`
   - [blocked] <task summary> — blocker: <blocker> — archive: `<relative path>`

   ## Recently completed
   - <task summary> — completed in <commit sha or note>
   ```

   Keep `active.md` concise. Put detailed reasoning in the archived file,
   not in the index.

8. **Confirm to the user**: print both relative paths written and a
   1-line summary of what they captured.

9. **Return according to the invocation contract.** Stop after reporting an
   explicit standalone handoff request. For an auxiliary checkpoint, resume the
   original active task without expanding its scope.

## Quality bar

- **Specific over generic** — "edit `cli/src/core/applier.ts:planRegion` to handle Y" beats "fix the applier".
- **Cite file paths and commit shas** — the next agent shouldn't have to grep to find context.
- **Mention rejected alternatives** — saves the next agent re-exploring dead ends.
- **Don't over-explain** — the next agent has the codebase. They need *intent*, not full re-derivation.

If the session is too short or trivial for a useful handoff (e.g., just a one-line fix already committed), say so plainly and skip writing — empty handoffs pollute future sessions.
