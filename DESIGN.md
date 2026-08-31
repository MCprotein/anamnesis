# Design

## Source of truth

- **Status:** Active
- **Last reviewed:** 2026-09-01
- **Product surfaces:** the human-readable terminal output of the `anamnesis`
  CLI, including help, lifecycle commands, diagnostics, Work and context
  workflows, trust inspection, benchmarks, and release/maintainer commands.
- **Evidence reviewed:** the 2026-09-01 `anamnesis status` screenshot supplied by
  the user; current `anamnesis status` and compact help output; `README.md`;
  `cli/src/core/tui.ts`; `cli/src/core/tui.test.ts`; the command reporters in
  `cli/src/index.ts`; the v1.16 command-UX history in `docs/ROADMAP.md`; and the
  safety and execution model in `docs/DESIGN.md`.
- **Scope boundary:** this file is the source of truth for product presentation
  and interaction decisions. `docs/DESIGN.md` remains the source of truth for
  system architecture, trust boundaries, storage, and execution behavior. A
  visual redesign must not change those contracts or reinterpret machine data.

Observed evidence: the shared renderer currently provides ANSI tone, titles,
sections, command rows, key-value rows, and wrapping, while high-volume
reporters still assemble most output directly. The default `status` output
shows healthy summaries alongside every Codex hook command, absolute key, hash,
and stale evidence record. This makes the result technically complete but gives
normal state, exceptions, provenance, and remediation almost equal visual
weight.

## Brand

**Personality:** calm, lucid, trustworthy, technically exact, and quietly
distinctive. Anamnesis should feel like a reliable memory instrument: it
restores orientation quickly and reveals exact evidence on demand.

**Trust signals:** plain-language verdicts; explicit counts; stable labels;
visible dry-run and write boundaries; commands that can be copied verbatim;
clear distinction between installed, trusted, modified, unavailable, and
unknown states; and detailed provenance in verbose or JSON output.

**Memorable differentiator:** each result follows a compact **continuity
spine**: verdict first, exceptions second, actions last. A cyan status marker
and restrained left-edge rhythm make different commands feel related without
turning the terminal into a boxed dashboard.

**Avoid:** cyberpunk or neon styling, gradients, large ASCII logos, nested box
borders, decorative separators, emoji-dependent meaning, color-only status,
dashboard density, ambiguous celebratory copy, and exposing internal hashes or
absolute paths merely to make an output look technical.

## Product goals

### Goals

- Let a user understand whether the project is healthy within the first three
  lines.
- Make exceptions and their next safe action scannable without reading healthy
  implementation details.
- Give all command families a recognizable structure while preserving the
  distinctions between preview, mutation, diagnosis, evidence, and trust.
- Preserve exact, complete inspection through `--verbose` and stable
  machine-readable output through `--json`.
- Remain legible in narrow terminals, colorless terminals, redirected output,
  CI logs, and agent-driven execution.
- Achieve the redesign with the existing TypeScript runtime and no new package
  dependencies.

### Non-goals

- A full-screen application, alternate screen buffer, mouse interface, or
  continuously updating dashboard for ordinary commands.
- Hiding warnings, failures, trust boundaries, write effects, or the evidence
  needed to diagnose them.
- Redesigning the underlying command taxonomy, domain models, JSON schemas,
  exit codes, safety policies, or architecture.
- Pixel-perfect alignment that breaks under localization, long paths, or small
  terminal widths.

### Success signals

- A default healthy `status` fits in roughly one terminal viewport at 80 rows
  and does not print per-hook commands, keys, hashes, or per-evidence histories.
- Every warning or failure rendered in compact mode has a reason and, when an
  action exists, one safe next command.
- `--verbose` can expose all detail that compact mode intentionally suppresses.
- `--json` is ANSI-free, contains no human-only decoration, and retains its
  existing structured contract.
- Snapshot tests cover representative 48-, 80-, and 120-column layouts, color
  and no-color output, Unicode and ASCII markers, TTY and non-TTY behavior, and
  compact/verbose/JSON parity.
- Users can distinguish success, warning, failure, partial, blocked, dry-run,
  and unknown without relying on hue.

## Personas and jobs

### Project maintainer

Runs `status`, `doctor`, `apply`, and `upgrade` locally. They need an immediate
health verdict, a short explanation of exceptions, and confidence about whether
the next command will inspect or write.

### AI coding agent operator

Uses Anamnesis across Claude Code, Codex, Cursor, OMX, and linked worktrees.
They need exact trust and continuity state without internal runtime detail
crowding out the actionable result.

### Automation and CI author

Pipes output, captures logs, and consumes `--json`. They need deterministic,
non-interactive, ANSI-free output and stable exit behavior rather than visual
chrome.

### Contributor and release maintainer

Runs benchmarks, dogfood checks, release gates, and migration diagnostics. They
need denser evidence and provenance, but still benefit from a verdict-first
summary and consistent failure formatting.

Common jobs are: orient quickly, find drift, preview changes, apply reviewed
changes, diagnose a failed invariant, inspect or approve trust explicitly,
resume Work, compare measured results, and copy the next safe command.

## Information architecture

The CLI is command-driven rather than route-driven. Global navigation remains
the existing command hierarchy and progressive help disclosure.

### Command families

1. **Start and lifecycle:** bare `anamnesis`, `init`, `apply`, `upgrade`, and
   `projects`. Lead with mode (`preview` or `apply`), planned/written counts,
   protected or skipped work, then next verification.
2. **Health and repair:** `status`, `doctor`, `release check`, and `dogfood`.
   Lead with project health, render only exceptions in detail, then the safest
   repair or verification commands.
3. **Continuity and knowledge:** `work`, `handoff`, `context`, and `ontology`.
   Lead with the selected scope or Work, progress/freshness, blockers, and the
   next retrieval or transition action.
4. **Trust and integrations:** `hooks` and tool-specific trust commands. Keep
   registration separate from runtime trust; emphasize `modified`,
   `untrusted`, `unknown`, and linked-worktree discrepancies. Commands, keys,
   hashes, and source paths are verbose details unless directly relevant to an
   exception or approval preview.
5. **Evidence and maintenance:** `benchmark`, `release`, `migrate`, `promote`,
   and the full command catalog. Lead with PASS/FAIL or readiness, show primary
   measures and gates, then artifacts and provenance.

### Content hierarchy for human output

Every completed command uses this order when the concepts apply:

1. **Verdict:** product name/command, target scope, semantic state, and up to
   three decisive metrics.
2. **Exceptions:** errors, warnings, blocked or partial work, modified trust,
   skipped writes, and unknown state. Healthy detail is collapsed into counts.
3. **Actions:** one recommended next command, followed only by materially
   different alternatives.
4. **Details:** shown by default only when required to understand an exception;
   otherwise available through `--verbose` or `--json`.

Empty sections are omitted. A successful command should not print an
`Attention` section merely to say there are no issues.

### Output modes

- **Human compact (default):** verdict, decisive summaries, exceptions, and
  actions. Optimized for a person reading a TTY and remains valid plain text
  when redirected.
- **Human verbose (`--verbose`):** the compact hierarchy plus full sources,
  commands, keys, hashes, evidence histories, file lists, and diagnostic
  provenance. Verbose changes disclosure, not truth or exit status.
- **Machine (`--json`):** structured data only. No title, prose, ANSI, spinner,
  terminal hyperlink, alignment padding, or Unicode decoration. Where a command
  already supports JSON, redesign work preserves field names and semantics.

`--json` and `--verbose` should not silently combine two formats. If both are
accepted for compatibility, JSON remains authoritative and `--verbose` may
only request documented additional fields; otherwise the CLI should return a
clear usage error.

## Design principles

1. **Verdict before inventory.** Start with what the state means, not a dump of
   what was inspected.
2. **Exceptions earn detail.** Healthy subsystems collapse to a count; an
   exception expands with reason, scope, and action.
3. **Action completes diagnosis.** When recovery is known, pair the problem
   with one copyable command and label whether it previews or writes.
4. **Progressive disclosure preserves rigor.** Compact output reduces reading,
   while verbose and JSON retain complete evidence.
5. **Safety state is visual state.** `dry-run`, `write`, `blocked`, `skipped`,
   `modified`, and `unknown` must be unmistakable and never reduced to color.
6. **Terminal-native, not terminal-theatrical.** Prefer stable lines and small
   semantic markers over panels, cursor tricks, and full-screen interaction.
7. **Same facts, different presentation.** Compact, verbose, no-color, and JSON
   views derive from one presentation model rather than independent business
   logic.
8. **Density follows the job.** Daily health commands are terse; maintainer
   evidence commands may be dense but still use the same hierarchy.

The principal tradeoff is completeness versus orientation. Compact mode favors
orientation and delegates full provenance to verbose/JSON without suppressing
any exception that can change safety, correctness, trust, or the next action.

## Visual language

### Color

Use semantic terminal roles rather than hard-coded colors in reporters:

| Role | Default ANSI family | Use |
| --- | --- | --- |
| `accent` | cyan | brand marker, section labels, selected scope |
| `success` | green | ready, trusted, clean, pass, completed |
| `warning` | yellow | modified, stale, partial, attention |
| `danger` | red | error, failed, invalid, blocked write |
| `command` | magenta | copyable commands and code-like identifiers |
| `muted` | dim/default | supporting metadata and provenance |

Color is reinforcement only. Every role must retain a word, marker, or label in
plain output. `NO_COLOR` and `ANAMNESIS_NO_COLOR` disable color even when a
force-color variable is present. Non-TTY output is uncolored by default.

### Typography

The terminal font belongs to the user. Create hierarchy with concise wording,
weight where supported, whitespace, and alignment—not font assumptions.
Use sentence case for section labels and verdict copy. Commands, paths, hashes,
event names, and stable identifiers keep their exact casing. Avoid all-caps
paragraphs; uppercase is reserved for compact exceptional badges such as
`MODIFIED` only when it improves scanning.

### Spacing

Use a four-step rhythm: no indent for the verdict, two spaces for primary rows,
four spaces for supporting detail, and six spaces only for wrapped continuations.
Use one blank line between major sections, none between tightly related metric
rows, and never stack multiple blank lines. Alignment is local to one small
group and must not create excessive gaps when a label is long.

### Shape and elevation

Terminal output has no simulated elevation. Avoid enclosing the whole result in
a border. A short marker (`●`, `!`, `×`, `○`) and indentation form the continuity
spine. Use thin dividers only in genuinely dense comparison output and omit
them in narrow or non-TTY modes.

### Motion

Static output is the baseline. A spinner or live progress line is permitted
only for a long-running TTY operation when total duration is unknown; it must
resolve to a durable final line, honor reduced-motion/CI conditions by avoiding
animation, and never appear in redirected or JSON output. Do not animate
`status`, `doctor`, or other read-only commands that already complete quickly.

### Imagery and iconography

No image assets or large logos are required. Unicode markers are optional
enhancement:

| Meaning | Unicode | ASCII fallback |
| --- | --- | --- |
| ready/success | `●` or `✓` | `OK` |
| warning/attention | `!` | `WARN` |
| failure/blocked | `×` | `ERROR` |
| unknown/inactive | `○` | `UNKNOWN` |
| next action | `›` | `>` |

Do not use emoji whose width or rendering varies materially across terminals.

## Components

Components are renderer primitives, not new domain objects. Their content must
be populated from existing command results or a thin shared presentation model.

### App header

One line containing `anamnesis`, the command or scope, and optional version in
muted text. It must not repeat a title already obvious from the verdict.

### Verdict

A required semantic marker plus a short state word and one plain-language
sentence. Variants: `ready`, `attention`, `failed`, `preview`, `applied`,
`partial`, `blocked`, `unknown`. A verdict may include at most three decisive
metrics on the following line.

### Metric strip

A compact group of two or three label/value pairs such as `46/46 managed`,
`5/5 trusted`, and `6/6 continuity`. At narrow widths it becomes one metric per
line. It is not a general-purpose table.

### Section label

Short sentence-case text such as `Attention`, `Changes`, `Checks`, or `Next`.
Include a count only when the count helps triage. Omit empty sections.

### Status row and badge

Pairs a semantic state with a subject and compact evidence. Badge variants use
both text and tone: `OK`, `WARN`, `ERROR`, `MODIFIED`, `SKIPPED`, `DRY RUN`,
`UNKNOWN`. Badges remain left-aligned and do not depend on fixed-width color
escapes.

### Exception item

Contains severity, concise title, reason, affected scope, and optional action.
The first line answers what is wrong; indented lines answer why and how to
recover. Similar exceptions may be grouped only when they share the same next
action.

### Action row

Uses a `Next` label, a copyable command, and a short effect label such as
`preview`, `writes managed files`, or `read-only`. One recommendation is
primary. Alternatives appear only when their consequences differ.

### Change list

For lifecycle commands, group entries under `Create`, `Update`, `Preserve`,
`Skip`, and `Block`. Default output shows counts plus exceptional paths;
verbose output lists every path. Dry-run and applied variants share the same
layout but use different verdicts and explicit effect copy.

### Evidence comparison

For benchmark and release output, show gate verdict, baseline/after values,
delta, and sample size. Right-align numeric columns only when the terminal is
wide enough; otherwise render labeled stacked rows. Never imply statistical
confidence not present in the result.

### Detail disclosure

Compact output ends with `Details: anamnesis <command> --verbose` only when
useful detail was actually hidden and the command supports it. Do not append
this advertisement to every successful command.

### Token ownership

Semantic tones, markers, indentation, spacing, visible-width measurement,
wrapping, terminal capability decisions, and component renderers belong in
`cli/src/core/tui.ts` or cohesive neighboring presentation modules. Command
reporters choose semantic variants and content; they do not own raw ANSI
sequences or reimplement wrapping. Domain commands and `--json` serializers do
not import presentation tokens.

## Accessibility

- **Target:** WCAG 2.2 AA principles where applicable to terminal content, with
  robust plain-text parity as the primary accessibility contract.
- **Color and contrast:** never encode state only by hue. Use standard ANSI
  families that respect the terminal theme rather than forcing RGB backgrounds.
  Do not place dim text where it contains a required action or failure reason.
- **Keyboard:** ordinary commands remain line-oriented and require no custom
  navigation. Interactive choosers must support documented number/id input,
  cancellation, EOF, and non-interactive alternatives; they must never trap
  focus or require a mouse.
- **Focus:** no focus concept is introduced for static output. If a future
  full-screen surface is added, it requires a separate design review and visible
  focus contract.
- **Semantics:** markers always accompany words; headings remain meaningful in
  stripped plain text; command effects are labeled; lists retain reading order.
- **Reduced motion and sensory safety:** disable animation outside an
  interactive TTY and when CI/non-interactive conditions are detected. Avoid
  flashing, rapid color changes, and repeated bells.
- **Screen readers and copy/paste:** avoid box-drawing grids for essential
  relationships, do not rely on cursor-positioned overlays, and keep commands
  contiguous on one logical line when possible.
- **International content:** wrapping and width calculations must handle ANSI
  escapes and Unicode display width safely. When reliable display-width support
  is unavailable without a dependency, prefer stacked layout and ASCII markers
  over brittle alignment.

## Responsive behavior

Terminal width is a capability, not a device breakpoint. Render from visible
width after stripping ANSI.

### Narrow: 40–59 columns

- Stack every metric and label/value pair.
- Omit decorative dividers and alignment padding.
- Put action commands on their own line and wrap descriptions beneath them.
- Show only the affected filename when an absolute path is not essential;
  verbose mode may wrap the full path.
- Prefer ASCII markers if Unicode display width is uncertain.

### Standard: 60–95 columns

- Use one content column.
- Keep a small aligned label column up to a bounded width.
- Show up to three compact metrics on one line only when they fit without
  truncation.
- Wrap exception reasons and actions with a stable continuation indent.

### Wide: 96 columns and above

- Permit compact metric strips and bounded comparison tables.
- Do not stretch prose to fill the terminal or create multi-column reading
  order for diagnostics.
- Cap label and command columns; use remaining width for explanations.

The renderer must degrade safely when width is absent, invalid, or changes
between invocations. Use a conservative standard-width fallback. Never truncate
an identifier, hash, path, or command in a way that changes its meaning; stack
or wrap instead.

### TTY and non-TTY

- TTY: semantic color and Unicode may be used when capability checks allow.
- Non-TTY, pipe, CI, or `TERM=dumb`: plain, static, single-pass output; no ANSI,
  spinner, cursor movement, terminal links, or interactive prompt.
- Force-color settings may opt into ANSI for logs, but `NO_COLOR` remains the
  stronger explicit user preference.

## Interaction states

### Loading

Fast read-only commands print nothing until the final result. Long-running TTY
commands may show one restrained progress line with the current phase. JSON and
redirected modes emit only the final result.

### Empty

Explain what is absent and whether absence is healthy. Provide one next command
only when the user can or should populate the state. Avoid rendering empty
tables or headings.

### Success

Use a `ready`, `applied`, `trusted`, `clean`, or `passed` verdict with decisive
counts. Collapse healthy internals. Do not add a warning-colored section for
informational follow-up.

### Warning and partial

Use `attention` or `partial`, name what remains safe and what is incomplete,
and list each material exception with its next action. Stale optional evidence
must not visually outrank drift, modified trust, or failed continuity.

### Error and blocked

State what failed, what did not change, and whether rollback or backup exists.
Put the safest recovery action next. Preserve non-zero exit semantics. Never
bury a partial write or trust refusal below verbose detail.

### Disabled and skipped

Name the controlling flag, policy, or user choice. Distinguish an intentional
skip from an unavailable feature and a safety block.

### Unknown and unavailable

Do not style unknown as failure or success. State why the runtime could not
decide, what remains installed locally, and the manual or verbose inspection
path. This is especially important for unsupported Codex RPCs and linked
worktree discovery.

### Dry-run

The verdict and final action must both say `preview` or `dry run`; list planned
effects using future tense and finish with `No files changed.` Applying the plan
requires a separately copyable command.

### Offline or slow external service

Local diagnostics remain usable. Separate local truth from registry, GitHub,
or app-server availability, label the external check as unavailable or timed
out, and avoid presenting a network failure as local project corruption.

## Content voice

- Lead with the result: `Ready`, `Needs attention`, `Preview ready`, or
  `Blocked`.
- Use concise sentence case and concrete nouns. Prefer `5/5 Codex hooks trusted`
  to `Codex hooks appear to be okay`.
- Use `warning` for a recoverable concern, `error` for a failed invariant, and
  `unknown` when no reliable conclusion is possible.
- Preserve security distinctions: `registered` is not `trusted`,
  `--allow-exec-adapters` is not Codex runtime approval, and `managed` is not
  user-approved.
- Label side effects beside actions: `read-only`, `preview`, `writes`, or
  `publishes`.
- Use command names and stable identifiers verbatim. Avoid cute metaphors in
  errors, exclamation marks in routine success, and phrases such as `magic`,
  `just`, or `simply` that minimize safety decisions.
- Do not narrate implementation effort. Human output explains project state and
  user choices.
- Default detail should answer `What state am I in?`, `What is exceptional?`,
  and `What should I do next?`—in that order.

## Implementation constraints

- **Framework:** Node.js and TypeScript CLI with the existing dependency-free
  `createTui` renderer. Do not add Ink, Blessed, Bubble Tea bindings, Chalk,
  Ora, cli-table, or another UI dependency for this redesign.
- **Architecture:** create shared presentation primitives and semantic view
  models, then migrate reporters. Do not move domain decisions, filesystem
  effects, trust resolution, or JSON serialization into the renderer.
- **Compatibility:** preserve command names, exit codes, stdout/stderr intent,
  `--json` schemas, dry-run behavior, environment switches, and existing safety
  gates. Default human wording and layout may change intentionally.
- **Modes:** introduce or normalize `--verbose` only where the default hides
  existing detail. Commands without verbose detail need not accept a no-op
  flag. `--json` stays machine-first and unstyled.
- **Color:** retain `NO_COLOR`, `ANAMNESIS_NO_COLOR`, `FORCE_COLOR`,
  `ANAMNESIS_FORCE_COLOR`, and `TERM=dumb` behavior. Explicit no-color takes
  precedence.
- **Performance:** rendering must remain synchronous, deterministic, and cheap
  relative to command execution. Do not probe the network or spawn a process to
  choose a layout.
- **Failure safety:** an inability to detect color, width, Unicode, or TTY
  capability falls back to plain stacked text. Presentation failure must not
  trigger writes or broaden trust.
- **Migration order:** establish renderer primitives and snapshots; migrate
  `status` and `doctor`; then lifecycle and trust commands; then Work/context;
  finally benchmark, release, and maintainer surfaces. A command is migrated
  only when compact, verbose where applicable, JSON, no-color, and width tests
  pass.
- **Testing:** use deterministic snapshots or complete string assertions for
  representative healthy, warning, error, partial, trust-modified, dry-run,
  and unavailable results at 48, 80, and 120 columns. Verify ANSI stripping,
  `NO_COLOR`, non-TTY output, ASCII fallbacks, wrapping, no semantic truncation,
  stdout/stderr routing, and JSON invariance.
- **Visual review:** capture before/after terminal output for at least `status`,
  `doctor`, `apply --dry-run`, and `hooks codex trust --dry-run` at standard and
  narrow widths. Review scanning order and information density in addition to
  test output.
- **Documentation:** update user-facing examples after output stabilizes. Keep
  `docs/DESIGN.md` focused on architecture and link to this file when terminal
  presentation decisions are relevant.

## Open questions

- [ ] **Unicode override — owner: CLI maintainer.** Decide whether capability
  detection plus automatic ASCII fallback is sufficient for the first release,
  or whether a global `--unicode auto|always|never` option is required. Impact:
  public CLI surface and snapshot matrix.
- [ ] **Verbose flag scope — owner: CLI maintainer.** Confirm whether
  `--verbose` becomes a global parser option or is added only to migrated
  reporters that suppress existing detail. Impact: help text, compatibility,
  and consistent discovery.
- [ ] **Stdout/stderr normalization — owner: CLI maintainer.** Inventory current
  reporter routing before moving warnings or progress to stderr. Impact: shell
  scripts may depend on current streams even when no documented contract exists.
- [ ] **Live progress threshold — owner: product maintainer.** Define the
  measured duration at which lifecycle, benchmark, or release commands earn a
  spinner/progress line. Impact: motion behavior and CI/TTY test coverage; it
  does not block the static redesign.
- [ ] **Wide benchmark tables — owner: benchmark maintainer.** Confirm the
  minimum columns and measures that deserve a table instead of stacked rows.
  Impact: benchmark density only; it does not block `status` and `doctor`.
