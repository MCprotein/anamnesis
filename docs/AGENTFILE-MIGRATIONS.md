# Agentfile Migration Design

This document defines the current behavior of `anamnesis migrate agentfile`.
The supported target is Agentfile v2. The built-in `v1-to-v2-work-policy`
migration changes `version: 1` to `version: 2`, preserving existing field
values. It does not add or enable Work policies or prompt capture. V2 permits
those optional settings; existing projects without them retain legacy-off behavior.

The original v1.0 freeze needed no transform. That historical decision is
recorded in [AGENTFILE-V1-FREEZE.md](AGENTFILE-V1-FREEZE.md).

## Goal

Agentfile migrations let existing projects survive schema adjustments
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
- next recommended command: `anamnesis migrate agentfile --apply` when a
  dry-run has changes available, otherwise `anamnesis doctor`.

JSON output should expose the same fields without relying on terminal wording:

```json
{
  "agentfilePath": "Agentfile",
  "currentVersion": 1,
  "targetVersion": 2,
  "applied": false,
  "changed": true,
  "migrations": [
    { "id": "v1-to-v2-work-policy", "title": "Upgrade Agentfile schema to v2", "fromVersion": 1, "toVersion": 2 }
  ],
  "backupPath": null,
  "nextCommand": "anamnesis migrate agentfile --apply"
}
```

## Preservation Rules

When no migration is needed, the original text is preserved byte-for-byte.
A real migration parses and reserializes YAML: field values are preserved, but
comments and formatting may change. Inspect the dry-run diff before applying.
Unknown fields are rejected by the source-version parser, not silently preserved
or stripped. Downgrades and unsupported target versions are rejected.

Field-specific compatibility rules:

- `fragments[].adapters`: preserve the stable field. It now has parser,
  render, and diagnostic semantics.
- `overrides.regions[].locked` and `overrides.files[].locked`: treat as
  ownership metadata, not hard update locks. If hard locks are needed before
  v1.0, implement them explicitly or add a new field rather than changing the
  current meaning silently.
- `settings.commit_on_apply`: keep as a v1 reserved no-op. If removed in a
  later schema, migration must delete only this key and preserve the rest of
  `settings`.
- `declined_at`: keep as a parser-level string. ISO 8601 remains recommended,
  but migration should not rewrite historical values merely for formatting.
- Unknown fields: v1 rejects unknown fields instead of silently stripping
  them. Future metadata such as `fragments[].source` needs a schema version
  bump or explicit parser-policy change with compatibility tests.

## Shipping Evidence

The current command is covered by `cli/src/commands/migrate.test.ts`:

- dry-run leaves Agentfile, manifest, and managed files untouched;
- `--apply` writes a backup and the migrated Agentfile;
- repeated `--apply` is a no-op;
- no-op migrations preserve original text; real transforms expose serialized
  output in the dry-run diff;
- unknown or unsupported schema versions produce actionable errors;
- migration does not run renderers or create adapter files;
- the CLI and JSON outputs expose the next recommended command;
- `doctor` can run after migration and report any remaining repair work.

## Apply/update boundary

`anamnesis apply` and `anamnesis update` check the migration plan before
rendering. If it changes the Agentfile, they stop and direct the user to
`anamnesis migrate agentfile --apply`. Migration itself never renders
adapters; run the normal project apply workflow afterward.

Implementation: `cli/src/commands/migrate.ts` and `cli/src/commands/update.ts`.
