# Agentfile Schema Audit

Deprecated: historical v0.8 audit. Current guidance lives in
`specs/agentfile.md`, `docs/AGENTFILE-V1-FREEZE.md`, and
`docs/AGENTFILE-MIGRATIONS.md`.

This is the v0.8 audit log for deciding what can become stable in v1.0.
The implementation source of truth is `cli/src/core/agentfile.ts`; the human
schema reference is `specs/agentfile.md`.

## Current V1 Surface

Stable candidates:

- Discovery order: `Agentfile`, `agentfile.yaml`, `agentfile.yml`,
  `.anamnesis/agentfile.yaml`; exactly one may exist.
- Top-level `version: 1`.
- `project.name`, optional `project.description`, and optional
  `project.scopes`.
- `tools`: `claude-code`, `codex`, `cursor`.
- `fragments[]`: `id`, `version`, optional `params`, optional per-adapter
  boolean overrides, optional `pinned`.
- `project.scopes[]`: `path`, optional `extends`, optional `overrides.tools`,
  `overrides.fragments_add`, and `overrides.fragments_remove`.
- `declined[]`: `id`, optional `reason`, optional `declined_at`.
- `settings`: `ontology_file`, `agents_md_path`, `claude_md_path`, and
  `backup_retention`.
- `settings.commit_on_apply` remains parser-supported for compatibility, but
  is a v1 reserved no-op because no command auto-commits.
- `overrides.regions[]` and `overrides.files[]` as user-ownership hints, not
  hard update locks.
- Parser-level strictness: unknown fields are rejected rather than silently
  stripped, except inside `params`.

Compatibility fixtures are locked in
`cli/src/core/agentfile.compat.test.ts` for:

- historical Claude Code-only managed projects;
- current all-adapter single-scope projects;
- multi-scope projects with pinned fragments and scope overrides.

## Implementation Notes

Defaults are applied only when the optional parent object exists. For example,
`settings.backup_retention` defaults to `10` when `settings` is present, while
`settings` itself remains absent when omitted.

Parser-level validation currently covers syntax, required fields, supported
tool names, duplicate root fragment IDs, duplicate declined IDs, duplicate
scope paths, unknown scope parents, and self-extension.

Library-aware validation is intentionally outside `parseAgentfile` today. The
following checks need library/project context and are enforced or diagnosed by
commands such as `status`, `doctor`, `init`, and `update`:

- whether a fragment ID exists in the loaded library;
- whether a pinned version exists in the fragment archive;
- whether installed versions lag behind library-current versions;
- whether a declined entry is still active or stale;
- whether a scope path exists on disk;
- whether fragment params are declared by the fragment;
- whether a fragment's required params are present.

`specs/agentfile.md` now separates parser-level hard errors from
library/project-aware command diagnostics.

`fragment.adapters` is now a first-class render gate for existing projects:
`false` skips that fragment for the selected adapter in `update` and `doctor`,
while missing keys and `true` mean enabled. Capability-level
`adapters_supported` remains narrower than the fragment-level override. The
current contract deliberately does not delete previously generated managed
files when an adapter is later disabled; cleanup belongs to the repair/migrate
workflow.

## V1 Freeze Decisions

- `overrides.regions` and `overrides.files` are frozen as ownership hints. If
  future hard update locks are needed, implement them explicitly or add a new
  field instead of silently changing the current hint semantics.
- `settings.commit_on_apply` is frozen as a reserved no-op. The parser accepts
  it for compatibility, but commands must not auto-commit because of it.
- `declined_at` remains a parser-level string with ISO 8601 recommended, so
  historical free-form values stay valid.
- `fragments[].source` is not part of v1. Registry source/trust metadata stays
  in cache or manifest metadata until a future schema migration.
- Generic `sync` settings are not part of v1. Remote handoff/ontology sync
  needs a separate privacy and trust design.
- No built-in Agentfile migration is required for v1.0 under these decisions.
  The available `anamnesis migrate agentfile` command remains the future
  migration surface.
- Partial `fragment.adapters` maps are now parser-supported and covered by
  compatibility fixtures. Root fragments and scope `fragments_add` entries are
  covered by render-path tests. Unknown adapter keys remain invalid.
- Unknown fields are now parser-level errors across the v1 object graph,
  except `params`.

The final freeze record is `docs/AGENTFILE-V1-FREEZE.md`.

## Post-Freeze Maintenance

1. Keep compatibility fixtures append-only as new sanitized fixture shapes are
   dogfooded.
2. Add any future schema field through a version bump or an explicit parser
   policy change with compatibility tests.
3. Use `anamnesis migrate agentfile` for destructive or semantic schema
   changes after v1.0.
