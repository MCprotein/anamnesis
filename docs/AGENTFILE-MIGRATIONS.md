# Agentfile Migration Design

This document defines the v0.8 design contract for future
`anamnesis migrate agentfile` work. The CLI skeleton is implemented with a
dry-run/apply/backup pipeline and no built-in schema transformations yet; this
is the behavior future migrations must preserve before the Agentfile schema is
frozen for v1.0.

## Goal

Agentfile migrations should let pre-1.0 projects survive schema adjustments
without losing user intent. A migration is a narrow, versioned transform of the
Agentfile itself. It does not render fragments, update managed regions, run
introspectors, publish packages, or modify adapter surfaces.

## Command Shape

```bash
anamnesis migrate agentfile          # dry-run by default
anamnesis migrate agentfile --apply  # write after backup
anamnesis migrate agentfile --json   # machine-readable plan/result
anamnesis migrate agentfile --to 2   # optional explicit target schema
```

Default behavior must be non-writing. This follows `update` and keeps
migrations reviewable.

## Safety Contract

- Discover the Agentfile with the same single-file discovery rule used by
  `readAgentfile`.
- Dry-run prints the planned migration list and a unified diff.
- `--apply` writes a backup before changing the file:
  `.anamnesis/backups/<timestamp>/Agentfile`.
- Applying the same migration twice must be a no-op.
- The command must preserve all known user-authored values unless a migration
  explicitly changes that field.
- The command must never auto-commit. Commit automation, if ever supported,
  belongs outside schema migration.
- The command must not run `init`, `update`, `doctor`, `ontology bootstrap`, or
  adapter renderers as a side effect.

## Migration Records

Each migration should be represented as a small typed record:

```ts
interface AgentfileMigration {
  id: string;
  fromVersion: number;
  toVersion: number;
  title: string;
  applies(raw: unknown): boolean;
  apply(raw: unknown): unknown;
}
```

`applies` must be specific enough to make the migration idempotent. A migration
that only normalizes optional fields inside the same schema version can keep
`fromVersion === toVersion`, but it still needs a stable `id` for reporting.

## Output

Human output should show:

- current schema version;
- target schema version;
- planned migration IDs and titles;
- whether the Agentfile would change;
- backup path when `--apply` writes;
- next recommended command, usually `anamnesis doctor`.

JSON output should expose the same fields without relying on terminal wording:

```json
{
  "agentfilePath": "Agentfile",
  "currentVersion": 1,
  "targetVersion": 2,
  "applied": false,
  "changed": true,
  "migrations": [
    { "id": "v1-remove-commit-on-apply", "title": "..." }
  ],
  "backupPath": null
}
```

## Preservation Rules

The first implementation can use the existing YAML parser for known v1 fields,
but v1.0 migration support should preserve comments and unknown forward fields
where practical. If exact comment preservation is not implemented, the dry-run
diff must make that formatting churn visible before `--apply`.

Field-specific guidance for current v0.8 risks:

- `fragment.adapters`: keep as a v1-stable candidate. It now has parser,
  render, and diagnostic semantics.
- `overrides.regions[].locked` and `overrides.files[].locked`: do not freeze
  as hard lock semantics until the write path enforces them. Migration may
  later rename these to explicit ownership metadata if hard locks are rejected.
- `settings.commit_on_apply`: treat as future-reserved unless commit
  automation is implemented before v1.0. If removed, migration must delete only
  this key and preserve the rest of `settings`.
- `declined_at`: keep as string unless v1.0 intentionally tightens it to ISO
  8601. If tightened, migration should only rewrite values that are already
  parseable dates.

## Test Requirements

Before shipping the command:

- dry-run leaves Agentfile, manifest, and managed files untouched;
- `--apply` writes a backup and the migrated Agentfile;
- repeated `--apply` is a no-op;
- comments/formatting behavior is covered by fixtures, even if the accepted
  behavior is "reformatted with visible diff";
- unknown or unsupported schema versions produce actionable errors;
- migration does not run renderers or create adapter files;
- `doctor` can run after migration and report any remaining repair work.

## Implementation Order

1. Add a migration registry and dry-run planner with no built-in migrations.
2. Add CLI plumbing for `anamnesis migrate agentfile`.
3. Add backup and apply support.
4. Add the first real migration only after the v0.8 audit decides whether
   `overrides.*.locked` or `settings.commit_on_apply` changes before v1.0.
