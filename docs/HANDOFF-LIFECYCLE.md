# Handoff Lifecycle

Status: in-progress v1.8 design. Current shipped behavior includes
`/handoff-prepare`, compact SessionStart injection, Stop-time reminders,
stale-pointer and semantic freshness diagnostics, and preview-only handoff
lifecycle reporting in `anamnesis gc --dry-run`. `anamnesis gc --apply`
does not delete handoff archives; they remain review-only.

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
  summary plus source pointers by default. They treat only `Current focus` and
  `Active tasks` archive links as startup-active and exclude closed, cold,
  deprecated, or superseded archives.
- `ANAMNESIS_SESSION_CONTEXT_MODE=full` remains a compatibility/debug escape
  hatch for full file-body injection, but only eligible active archives are
  expanded.
- Stop hooks warn when dirty work is newer than the latest handoff, but they
  do not automatically create a finalized handoff.
- `status`, `doctor`, and `context diagnose` detect missing/stale archive
  pointers, malformed active handoff structure, completed entries left in
  active sections, missing file pointers, inactive active-referenced archives,
  stale clean-worktree git refs, and handoff byte-budget pressure.
- `gc --dry-run` classifies handoff artifacts as hot, warm, cold, or
  deprecated, reports archive count and bytes, preserves active archive
  references, and lists review-only cleanup candidates.
- `gc --apply` may delete clean manifest-owned task harness candidates, but it
  still skips all handoff archive candidates and reports them as review-only.
- `handoff draft` gathers git ref, recent commits, touched files, latest
  evidence, active handoff, and latest archive into a draft markdown skeleton
  without updating `active.md` or writing a finalized archive.
- `handoff close` and `handoff deprecate` are preview-first lifecycle actions.
  With `--apply`, they update finalized archive frontmatter and remove matching
  active entries from `active.md`; they never delete archive files.

Current limitations:

- Timestamped archives are only lifecycle-previewed by `anamnesis gc`; apply
  mode intentionally leaves them on disk.
- Completed tasks rely on the departing agent to remove or close active
  entries, although diagnostics now warn when that cleanup was missed.

## Lifecycle Tiers

Handoff automation classifies artifacts into four tiers.

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

1. `anamnesis handoff draft` gathers git state, recent commits, changed files,
   current `active.md`, latest archive, and runtime evidence.
2. The CLI produces a draft handoff skeleton without model interpretation.
3. The active agent fills or confirms decisions, blockers, rejected options,
   and next steps.
4. Finalization updates `active.md` and writes one archive through
   `/handoff-prepare` or an equivalent agent-authored path.

## Close And Deprecate

Completed or superseded handoff work can be removed from startup summaries
without deleting historical archives:

- `anamnesis handoff close --archive <path>` previews marking a finalized
  archive `handoff_status: closed`, `retention_tier: cold`, and removing
  matching open entries from `active.md`.
- `anamnesis handoff deprecate --archive <path>` previews marking a finalized
  archive `handoff_status: deprecated` and `retention_tier: deprecated`.
- `anamnesis handoff deprecate --archive <path> --superseded-by <path>`
  previews `handoff_status: superseded` plus `superseded_by`.
- `--apply` is required for writes. Without it, commands only report the
  planned frontmatter and `active.md` changes.

Drafts under `.anamnesis/handoff/drafts/`, legacy `.anamnesis/handoff/draft.md`,
and `active.md` are rejected as lifecycle action targets.

Fully automatic finalization should be avoided unless the task has no semantic
state worth preserving. Bad automatic summaries pollute future sessions and
increase retrieval noise.

## Retention Policy

Preview GC behavior:

- Preserve all archives referenced by hot active entries.
- Treat only `Current focus` and `Active tasks` bullets as hot active
  references. `Recently completed` pointers are historical breadcrumbs, not
  startup or GC-protection references.
- Preserve the newest warm archives up to a small count budget.
- Classify old completed archives as cold when frontmatter marks them closed
  or when they fall outside the warm archive budget.
- Mark archives deprecated when frontmatter marks them deprecated,
  superseded, or points to `superseded_by`.
- Report cold/deprecated review candidates through `anamnesis gc --dry-run`.
- Never silently delete user-authored handoff files. Current `gc --apply`
  behavior leaves every handoff archive candidate review-only.

Default budgets are conservative: 5 warm archives, 90 cold days, and 524288
handoff bytes before review candidates are reported.

## Token Budget

Lifecycle management should reduce startup token pressure:

- Hot: inject a short current-focus summary.
- Warm: inject only file pointers, sizes, and dates.
- Cold: exclude from SessionStart; retrieve on demand through context query or
  resume.
- Deprecated: exclude from SessionStart and normal resume bundles.

Full archive injection remains opt-in debug behavior only and still respects
the lifecycle filter; closed, cold, deprecated, or superseded archive bodies
stay out of SessionStart.

## Diagnostics

Diagnostics include semantic freshness checks beyond structural pointer
validity:

- `active.md` references a git ref far behind the current HEAD while the
  worktree is clean.
- Open active entries mention files or docs that no longer exist.
- Recently completed entries remain under `Current focus` or `Active tasks`.
- An active entry still points at an archive marked closed, deprecated, or
  superseded.
- Archive count or bytes exceed the configured handoff budget.

Diagnostics stay advisory first. The repair path suggests close, refresh,
deprecate, or GC preview actions instead of rewriting user state without
review.
