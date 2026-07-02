# Handoff Lifecycle

Status: planned v1.8 design. Current shipped behavior is limited to
`/handoff-prepare`, compact SessionStart injection, Stop-time reminders, and
stale-pointer diagnostics.

## Goal

Handoff exists so a new session or a different agent can continue current work
without the user re-briefing the project. It should preserve active intent,
decisions, open questions, and next steps while keeping startup context small.

anamnesis should keep handoff state as repo-local markdown artifacts with
explicit lifecycle metadata, source pointers, and retention rules.

## Current Behavior

Today, handoff is agent-authored:

- `/handoff-prepare` writes `.anamnesis/handoff/active.md` and a timestamped
  archive under `.anamnesis/handoff/<ISO-timestamp>.md`.
- Claude Code and Codex SessionStart surfaces inject a compact active-task
  summary plus source pointers by default.
- `ANAMNESIS_SESSION_CONTEXT_MODE=full` remains a compatibility/debug escape
  hatch for full file-body injection.
- Stop hooks warn when dirty work is newer than the latest handoff, but they
  do not automatically create a finalized handoff.
- `status`, `doctor`, and `context diagnose` detect missing/stale archive
  pointers and malformed active handoff structure.

Current limitations:

- `active.md` can become semantically stale even when its archive pointer is
  structurally valid.
- Timestamped archives are not lifecycle-managed by `anamnesis gc` yet.
- Completed tasks rely on the departing agent to remove or close active
  entries.

## Lifecycle Tiers

Future handoff automation should classify artifacts into four tiers.

| Tier | Meaning | Startup behavior | Retention behavior |
|---|---|---|---|
| `hot` | Current focus in `active.md` | Inject compact summary and source pointer | Keep until closed or superseded |
| `warm` | Recent or active-referenced archive | Inject source pointer only | Keep by recent count and active refs |
| `cold` | Older completed archive with possible reference value | Do not inject | Keep only for bounded query/resume lookup |
| `deprecated` | Superseded, too old, or semantically stale archive | Never inject | Report as cleanup candidate |

`delete-candidate` is not a lifecycle tier. It is a GC recommendation for
deprecated archives that exceed retention count, age, or disk budget.

## Storage Model

Do not add a separate always-on storage backend for handoff.

Preferred storage:

- `active.md` remains the small current-work index.
- Timestamped markdown archives remain the durable detailed record.
- Frontmatter carries lifecycle metadata such as `handoff_status`,
  `closed_at`, `superseded_by`, `last_referenced_at`, and `retention_tier`
  when the field becomes implemented.
- `.anamnesis/context/index.jsonl` may index handoff pointers and short
  snippets because it is regenerable and safe to delete.

Source markdown remains authoritative. Any index is retrieval support, not the
memory source of truth.

## Automation Shape

The safe path is auto-draft plus agent finalization:

1. A Stop-time or explicit command path gathers git state, recent commits,
   changed files, current `active.md`, latest archive, and runtime evidence.
2. The CLI can produce a draft handoff skeleton without model interpretation.
3. The active agent fills or confirms decisions, blockers, rejected options,
   and next steps.
4. Finalization updates `active.md` and writes one archive.

Fully automatic finalization should be avoided unless the task has no semantic
state worth preserving. Bad automatic summaries pollute future sessions and
increase retrieval noise.

## Retention Policy

Planned GC behavior:

- Preserve all archives referenced by hot active entries.
- Preserve the newest warm archives up to a small count budget.
- Move old completed archives to cold by metadata before recommending
  deletion.
- Mark archives deprecated when they are superseded, too old, detached from
  active work, or point at a git state that has clearly moved on.
- Report candidates through `anamnesis gc --dry-run` before any deletion.
- Never silently delete user-authored handoff files in the first shipped
  implementation.

Default budgets should be conservative and documented before `--apply` exists.

## Token Budget

Lifecycle management should reduce startup token pressure:

- Hot: inject a short current-focus summary.
- Warm: inject only file pointers, sizes, and dates.
- Cold: exclude from SessionStart; retrieve on demand through context query or
  resume.
- Deprecated: exclude from SessionStart and normal resume bundles.

Full archive injection remains opt-in debug behavior only.

## Diagnostics

Future diagnostics should add semantic freshness checks beyond today's
structural checks:

- `active.md` references a git ref far behind the current HEAD while the
  worktree is clean.
- Open active entries mention files or docs that no longer exist.
- Recently completed entries remain under `Current focus` or `Active tasks`.
- A newer archive closes or supersedes an older active entry.
- Archive count or bytes exceed the configured handoff budget.

Diagnostics stay advisory first. The repair path should suggest close,
refresh, deprecate, or GC preview actions instead of rewriting user state
without review.
