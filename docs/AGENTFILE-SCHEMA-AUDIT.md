# Agentfile Schema Audit

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
- `settings`: `ontology_file`, `agents_md_path`, `claude_md_path`,
  `commit_on_apply`, and `backup_retention`.
- `overrides.regions[]` and `overrides.files[]` as user-ownership hints.

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

`specs/agentfile.md` currently lists some of these context-aware checks under
general validation. v0.8 should clarify that distinction before v1.0.

## V1 Freeze Risks

- `fragment.adapters` is parsed but not yet consistently used as a first-class
  per-fragment adapter override in every render path. Freeze only after its
  semantics are either fully implemented or explicitly deferred.
- `overrides.regions` and `overrides.files` are documented as lock controls,
  but current write protection primarily comes from manifest drift detection.
  Freeze only after the lock semantics are implemented, renamed, or removed.
- `settings.commit_on_apply` is parsed and documented, but commit automation
  is not a current command behavior. Freeze only after deciding whether this
  field stays, moves, or becomes a future-reserved setting.
- `declined_at` is a plain string. That is flexible, but v1.0 should decide
  whether to require ISO dates or keep free-form historical values valid.
- Schema evolution docs mention `anamnesis migrate agentfile`, but the command
  does not exist yet. v0.8 should define the migration command before the
  schema is frozen.
- Partial `fragment.adapters` maps are now parser-supported and covered by
  compatibility fixtures. Unknown adapter keys remain invalid.

## V0.8 Recommendations

1. Update `specs/agentfile.md` to separate parser-only validation from
   library/project-aware diagnostics.
2. Decide the fate of `fragment.adapters`, `overrides.*.locked`, and
   `settings.commit_on_apply`.
3. Add `anamnesis migrate` design before any schema v2 work.
4. Keep compatibility fixtures append-only as new sanitized fixture shapes are
   dogfooded.
