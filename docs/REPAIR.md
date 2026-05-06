# Repair Workflow

Use this when an existing managed project is not clean after an anamnesis
upgrade, adapter expansion, or manual edit.

## Default Loop

```bash
anamnesis status
anamnesis doctor
anamnesis update --dry-run --allow-exec-adapters
```

If the dry-run is acceptable:

```bash
anamnesis update --apply --allow-exec-adapters
anamnesis doctor
```

`update --apply` backs up files before updating them. Backups live under
`.anamnesis/backups/<timestamp>/`, and `settings.backup_retention` controls how
many backup directories are kept.

## User-Modified Managed Files

`user-modified` means the file or region differs from the last content
anamnesis applied. anamnesis preserves it and skips the library update for that
target.

Use this sequence:

1. Run `anamnesis update --dry-run --allow-exec-adapters`.
2. Compare the current file with the planned content in the dry-run output.
3. If the local edit is intentional, keep it and accept the warning.
4. If the library version should win, manually merge the wanted library content
   into the file, then re-run `anamnesis update --apply --allow-exec-adapters`.

Do not expect `update` to overwrite user-modified files automatically.

## Missing Hook Registration

If `doctor` reports a `.claude/settings.json` hook registration is missing:

```bash
anamnesis update --apply --allow-exec-adapters
anamnesis doctor
```

If the hook file itself is `user-modified`, review or merge that file first.
anamnesis only registers hooks it owns through `create`, `update`, or `noop`
planned changes.

If `doctor` reports missing Codex native hook config, use the same update
command. anamnesis merges `.codex/config.toml` and `.codex/hooks.json`
structurally and preserves non-anamnesis hook entries.

If `status` shows Codex hook ownership warnings or `doctor` reports
`codex-hook-ownership-warning`, inspect `.codex/hooks.json` before deleting
anything. User, plugin, and OMX entries are allowed to coexist with anamnesis
entries. Repair only duplicated commands, malformed matcher entries, or older
anamnesis-managed commands that use relative project paths; then re-run
`anamnesis doctor`.

## Partial Adapter Install

If a project was installed for one agent and later needs all supported agents,
edit `Agentfile.tools`:

```yaml
tools:
  - claude-code
  - codex
  - cursor
```

Then run:

```bash
anamnesis update --dry-run --allow-exec-adapters
anamnesis update --apply --allow-exec-adapters
anamnesis status
```

If a fragment has `adapters: { cursor: false }` or a similar override, that
fragment intentionally will not render for that adapter.

## Stale Agentfile Versions

When `status` reports `update-available`, run:

```bash
anamnesis update --dry-run --allow-exec-adapters
```

If a fragment is pinned, it will not bump automatically. Use:

```bash
anamnesis update --dry-run --bump-pinned --allow-exec-adapters
anamnesis update --apply --bump-pinned --allow-exec-adapters
```

Pinned bumps should be reviewed because they intentionally move a previously
held fragment version.

## Stale Active Handoff

If `status` or `doctor` reports stale `.anamnesis/handoff/active.md`, update the
active handoff index so open tasks point at existing current archives. Remove
completed or superseded entries from open sections.

Run `anamnesis status` again. The `active-handoff` continuity check should pass.

## Ontology Gaps

For missing or stale deterministic Layer A facts:

```bash
anamnesis ontology bootstrap --dry-run
anamnesis ontology bootstrap
```

Then ask the active agent to run `/ontology-enrich` so Layer B semantic context
is appended to the matching `.enriched.yaml` files.

## When Not To Repair Automatically

Stop and review manually when:

- the planned update would replace hand-authored operational instructions;
- a hook file differs because the team intentionally customized it;
- an Agentfile field is unclear after schema changes;
- a migration dry-run shows formatting churn you do not want to accept.

The safe default is to preserve user edits, update only reviewed managed
surfaces, and re-run `doctor` until remaining warnings are intentional.
