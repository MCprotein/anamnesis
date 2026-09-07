# Instruction efficiency audit

Run `anamnesis context audit-instructions` when investigating instruction cost,
repeated work or unexpected stopping. Add `--json` for exact file/region locations,
recorded fragment versions, hashes, drift, duplicate references and recommendations.
The normal output is a short summary. This command is explicit and read-only: it
is not installed in a hook, does not invoke a model and does not apply changes.

The audit inventories project-root `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`,
`.cursorrules`, Markdown files registered as managed regions, and local instructions
under `.codex/{skills,agents}`, `.claude/{skills,agents,commands}` and `.cursor/rules`.
It does not scan home directories, source trees, dependencies, transcripts or Work
prompt storage. Unregistered nested instructions, ancestor/global rules, hook
configuration and dynamically injected context remain outside this inventory.
A project with an unconventional instruction path should be reviewed separately.

Reads are bounded to 256 instruction files, 2,048 directory entries, depth 8,
1 MiB per file and 8 MiB total (including manifest input). Symbolic links and
nonregular files are skipped. Limits, invalid manifests/regions and read failures
produce a partial-report warning. `complete` describes this declared disk scope,
not completeness of a client's actual prompt. Treat the audit as a diagnostic of
a stable local tree, not a security sandbox against concurrent filesystem changes.

## Interpret candidates before changing instructions

- **Recorded ownership** means a manifest entry matches the region identity and
  version. It does not grant edit permission. Outside text in mixed files remains
  user/other-owned; markers without matching provenance remain unverified.
- **Literal duplicates** are identical multiline paragraphs of at least 160
  characters, with source line references. This is not semantic conflict detection.
  Repetition across clients may be required because each client loads a different
  surface. The audit intentionally reports candidates rather than defects.
- **Native/fallback pairs** can support older Codex discovery paths. Preserve the
  fallback unless equivalent client behavior is demonstrated. Change fragment or
  renderer sources, inspect generated diffs, and retain executable-adapter gates.
- **Stop scope candidates** require reading the whole procedure and its caller.
  A standalone orientation/handoff request may correctly end the turn. An
  auxiliary checkpoint should continue its authorized parent task. A matching
  phrase alone does not prove a bug.

Use each exact reference to review the source once, then propose the smallest
change with its ownership, invocation condition and protected behavior. Preserve
user, OMX and other tools' instructions. Do not automatically remove safety
checks, change permissions/model/reasoning settings, or rewrite all AGENTS.md.

## Verify savings separately

Instruction bytes are measured UTF-8 disk bytes. They are **not** token estimates,
actual prompt loading, cache misses, cost or elapsed time. The audit itself adds
no ongoing prompt scanning, but running it still has a one-time cost.

For an instruction change, freeze source and harness versions, tools, permissions,
model and reasoning effort. Use counterbalanced baseline/candidate runs with
separate development and held-out tasks. First require correct completion,
requirement retention, scope and safety behavior; then measure total tokens
(including children/retries), tool calls, unnecessary questions, elapsed time and
observed cache metrics. Separate cold/warm observations and experimental context
management. Keep failures and negative results. Do not tune against held-out cases
or generalize a disk reduction into an agent-performance claim.

For test cleanup, retain a witness for each protected behavior. Measure the same
runner, machine and worker policy; compare elapsed suite time as well as expensive
individual tests. Parallel file durations are not additive. Reducing test count
alone is not an improvement and does not reduce model inference tokens by itself.
