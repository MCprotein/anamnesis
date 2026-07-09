# Command UX Consolidation Plan

Status: planned for v1.16.

## Problem

The CLI grew by adding useful lifecycle surfaces one by one. The current
top-level help now exposes core project commands, maintainer release gates,
benchmark harnesses, evidence tools, migration helpers, and low-level context
subcommands in the same list.

Observed v1.15 state:

- `anamnesis --help` prints the full command catalog and every flag group in
  one long plain-text screen.
- Core user tasks (`init`, `update`, `status`, `doctor`, `upgrade`) compete
  visually with maintainer tasks (`release`, `dogfood`, `hooks`, `benchmark`).
- Several commands are implementation surfaces that should remain available
  but should not be the first thing a new user sees.
- Reporter output is hand-written `console.log` blocks, so status, doctor,
  benchmark, context, and upgrade commands do not share a consistent visual
  system.
- Project detection is still biased toward known code stacks. Unknown tools,
  document-heavy repositories, design assets, specs, notebooks, and other
  non-code work products need a first-class discovery path without creating a
  pile of new top-level commands.

## Goals

1. Make the common path obvious:
   `init`, `update`, `status`, `doctor`, `upgrade`, and `context`.
2. Keep advanced and maintainer commands available without crowding default
   help.
3. Consolidate related command flows through guided defaults and aliases
   instead of adding more top-level verbs.
4. Add a shared terminal UI layer with color, grouped sections, readable
   status labels, stable plain output, and unchanged JSON output.
5. Let `init` and `update` detect project-local tools and artifact types, then
   propose reviewed local context/fragments from those signals.

Non-goals:

- Do not remove existing public commands in v1.16.
- Do not make color the only source of meaning.
- Do not auto-apply generated local fragments or semantic context.
- Do not add a database, network service, or remote sync surface.

## Command Surface Target

Default visible commands should be grouped by user intent:

| Group | Visible command | Role |
|---|---|---|
| Start | `anamnesis` | Guided first-run / next-action screen |
| Start | `anamnesis init` | First project adoption, detection, and reviewed install |
| Maintain | `anamnesis apply --dry-run` | Preview project-managed changes |
| Maintain | `anamnesis apply` | Apply reviewed project-managed changes |
| Compatibility | `anamnesis update` | Deprecated compatibility command for older scripts and docs |
| Maintain | `anamnesis status` | Current installed state and drift summary |
| Maintain | `anamnesis doctor` | Problems, repair guidance, optional append evidence |
| Maintain | `anamnesis upgrade` | Package upgrade plus project apply guidance |
| Retrieve | `anamnesis context` | Index/query/resume/preamble namespace |
| Handoff | `anamnesis handoff` | Handoff draft/close/deprecate namespace |

Advanced commands stay callable but move out of default help:

| Advanced surface | Default UX decision |
|---|---|
| `benchmark ...` | Hide behind `anamnesis benchmark --help` and release docs. |
| `release check` | Keep maintainer-only; prefer npm release runner docs. |
| `dogfood check` | Keep maintainer-only; show in release/development docs. |
| `hooks summary` | Keep evidence tool; do not show in first-run help. |
| `migrate agentfile` | Show only when an Agentfile migration is relevant. |
| `ontology bootstrap` | Keep as advanced; normal users get it through `init`/`apply`. |
| `gc` | Keep as explicit cleanup command; surface through `doctor` recommendations. |
| `promote` | Keep as fragment-authoring command, not default project UX. |

Compatibility policy:

- Existing commands keep working through at least one minor release after the
  new UX ships.
- Deprecated spellings print a short "same as" line and the preferred command.
- Scripts use `--json` or explicit subcommands; those outputs must remain
  stable.
- `--help --all` or an equivalent advanced help mode can expose the full
  command catalog for maintainers.

## Naming Model

The product should use different verbs for the two operations users confuse
most:

| User intent | Preferred wording | Existing command compatibility |
|---|---|---|
| Install a newer anamnesis package/CLI | CLI upgrade | `anamnesis upgrade` |
| Preview changes to the current project | Project apply preview | `anamnesis apply --dry-run` |
| Write the reviewed project changes | Project apply | `anamnesis apply` |
| Older compatibility path | Deprecated project update | `anamnesis update` / `anamnesis update --apply` |

Rationale:

- `upgrade` and `update` are too visually and semantically close for a tool
  whose normal workflow uses both.
- `apply` is clearer for the side-effecting project write step because it
  matches what the command actually does: apply the reviewed plan to local
  project files.
- `apply --dry-run` keeps preview explicit without reusing the confusing
  `update` verb.
- The compatibility commands `anamnesis update` and `anamnesis update --apply`
  keep working for existing users and scripts, but they print a deprecation
  warning that points to `apply --dry-run` and `apply`.

Target output vocabulary:

```text
Anamnesis Upgrade
  CLI package     1.15.0 -> 1.16.0
  Project state   update plan available

Next
  1. anamnesis upgrade --apply
  2. anamnesis apply --dry-run --allow-exec-adapters
  3. anamnesis apply --allow-exec-adapters
```

## Consolidation Map

| Current flow | Preferred user-facing flow | Notes |
|---|---|---|
| `upgrade plan`, `upgrade choose`, `upgrade apply-choice <id>` | `upgrade` by default, with guided choices when interactive | Keep subcommands for scripts and tests. |
| `update` / `update --apply` | `apply --dry-run` / `apply` | Keep update as deprecated compatibility; print a warning with the preferred command. |
| `context index/query/diagnose/resume/subagent-preamble` | `context` namespace summary plus subcommand help | Default `context` should explain the retrieval model and next commands. |
| `ontology bootstrap` | `init` / `apply` automatic bootstrap plus `doctor` repair hint | Advanced direct command remains for scoped repair. |
| `gc --dry-run` | `doctor` reports cleanup pressure, then points to `gc --dry-run` / `gc --apply` | Avoid accidental deletion from generic commands. |
| `hooks summary`, `dogfood check`, `benchmark ...` | Maintainer/development surfaces | Keep out of first-run and basic help. |
| Future `discover` / `fragment draft` ideas | Fold into `init` and `update` | Do not add standalone discovery commands unless dogfood proves they are needed. |

## Adaptive Project Detection

The next detection layer should be generic before it is framework-specific.
`init` and `update` should scan the project and classify signals into a
workspace profile:

| Signal class | Examples | Output |
|---|---|---|
| Known stack | `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `k8s/` | Existing fragment suggestions. |
| Unknown tool | lockfiles, config files, task runners, CLIs in scripts | Reviewed local-fragment draft candidate. |
| Artifact workspace | `docs/`, `specs/`, `*.drawio`, `*.fig`, notebooks, datasets | Artifact continuity notes and review prompts. |
| Agent surface | `AGENTS.md`, `CLAUDE.md`, `.codex/`, `.cursor/` | Existing adapter-surface diagnostics. |
| Verification surface | test scripts, build scripts, Makefile, CI workflows | Task harness / verification command suggestions. |

Important boundary:

- The CLI can deterministically discover files and propose structure.
- The active agent writes semantic explanations only through reviewed
  agent-facing workflows.
- Generated local fragments must be project-local drafts first. They are not
  promoted into the bundled library unless `promote` is explicitly used.

Preferred local-fragment flow:

1. `anamnesis init --dry-run` or `anamnesis apply --dry-run` prints detected
   workspace profile signals.
2. Supported stacks use existing fragments.
3. Unsupported but meaningful signals produce a reviewed local-fragment draft
   plan, not an auto-applied write.
4. Applying the reviewed plan creates project-local managed context,
   ontology/source pointers, and optional skills for the detected artifact
   class.
5. `status` and `doctor` report whether the local draft is installed, stale,
   or ready to promote.

## Terminal UI Plan

Add a small shared terminal UI layer under `cli/src/ui/` before rewriting
individual reports.

Required modules:

- `color.ts`: ANSI styling with `NO_COLOR`, `FORCE_COLOR`, `--no-color`, TTY,
  and CI detection.
- `theme.ts`: semantic colors for `ok`, `warn`, `fail`, `info`, `skip`,
  paths, commands, and muted details.
- `blocks.ts`: headers, summaries, check lists, key/value rows, tables,
  next-step blocks, and warnings.
- `wrap.ts`: width-aware wrapping for long paths and repair messages.
- `snapshot.ts` or test helpers: normalize ANSI for snapshots.

Output principles:

- One command header, one verdict, then grouped details.
- First screen answers "is this okay?" and "what should I do next?".
- The layout should be closer to modern agent CLIs: strong section headers,
  dim secondary text, cyan commands/paths, green ok states, yellow warnings,
  red failures, and aligned columns instead of long undifferentiated prose.
- Details are grouped and capped; use `--verbose` for long lists.
- Paths are dimmed, commands are highlighted, warnings/errors stand out.
- `--json` stays machine-readable and never receives ANSI styling.
- Color improves scanning but labels like `[ok]`, `[warn]`, and `[fail]`
  remain visible in plain mode.

Example target shape:

```text
Anamnesis Doctor
Project: anamnesis
Verdict: [ok] ready

Checks
  [ok] managed surfaces       42 clean
  [ok] continuity             6/6 passed
  [warn] subagent evidence    stale by 9d

Next
  1. anamnesis benchmark subagent-injection --attempts 20 --write --append
  2. anamnesis status
```

Example project apply shape:

```text
Anamnesis Project Update
Project: anamnesis
Mode: preview
Verdict: [warn] 3 project writes available

Plan
  [update] AGENTS.md                    base@17 -> base@18
  [update] .codex/skills/load-context   stale generated surface
  [skip]   .claude/hooks                requires --allow-exec-adapters

Next
  1. review the diff above
  2. anamnesis apply --allow-exec-adapters
```

The actual terminal can color `[ok]` green, `[warn]` yellow, `[fail]` red,
commands cyan, and secondary paths dim gray. Plain mode keeps the same layout
without escape codes.

## Rollout

### Phase 1 - v1.16 command audit and help cleanup

- Add command taxonomy metadata: core, namespace, advanced, maintainer,
  deprecated alias.
- Replace the monolithic help screen with grouped default help.
- Add advanced help mode for full catalog output.
- Keep no-command guide concise, but make it visually structured.
- Update README lifecycle docs so users see the short path first.

### Phase 2 - v1.16 terminal UI foundation

- Add dependency-free ANSI/theme helpers or evaluate one tiny color dependency
  before adoption.
- Migrate `doctor`, `status`, `init`, `update`, and `upgrade` reporters first.
- Add plain/color snapshot tests.
- Add terminal-width tests for long path wrapping.

### Phase 3 - v1.16 guided consolidation

- Make bare namespace commands useful:
  - `anamnesis context`
  - `anamnesis handoff`
  - `anamnesis benchmark`
- Add `anamnesis apply` as the preferred project-write command and keep
  `anamnesis update` as a deprecated compatibility command.
- Make `upgrade` the preferred interactive/default path while preserving
  `upgrade plan`, `upgrade choose`, and `upgrade apply-choice`.
- Move maintainer commands out of first-run docs unless they are part of a
  release guide.

### Phase 4 - v1.17 adaptive workspace profiles

- Add generic workspace signal scanning to `init` and `update`.
- Report code, document, artifact, agent-surface, and verification signals.
- Draft reviewed local context/fragments from unknown-but-important signals.
- Teach `status` and `doctor` to report stale local workspace profiles.
- Add fixtures for doc-only, design-asset, notebook/data, and unknown-tool
  projects.

## Acceptance Criteria

- `anamnesis` no command remains under 35 visible lines.
- `anamnesis --help` shows grouped user-facing commands first and no longer
  dumps every advanced flag by default.
- `anamnesis --help --all` or equivalent still exposes the full catalog.
- Help and command output distinguish CLI upgrade, project apply preview, and
  project apply.
- `doctor`, `status`, `init`, `apply`, and `upgrade` have consistent headers,
  verdicts, status labels, next steps, and color/plain parity.
- `--json` outputs are byte-for-byte unaffected except for intentional schema
  additions covered by tests.
- Existing documented commands keep working.
- Unknown or non-code project signals are detected during `init`/`apply --dry-run`
  without adding a new top-level discovery command.
- Snapshot tests cover color enabled, color disabled, non-TTY/plain mode, and
  long-path wrapping.

## Risks

- Too much visual styling can make logs harder to paste into issues. Mitigate
  with stable plain output, `NO_COLOR`, and `--json`.
- Hiding advanced commands can make maintainers think features disappeared.
  Mitigate with `--help --all`, namespace help, and release docs.
- Auto-generated local fragments can overclaim semantics. Mitigate by keeping
  deterministic discovery separate from agent-reviewed semantic enrichment.
- Command aliases can confuse documentation. Mitigate with a clear deprecation
  table and one preferred command per user intent.
