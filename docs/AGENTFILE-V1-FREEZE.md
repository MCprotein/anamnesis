# Agentfile V1 Freeze

Status: v1.0 freeze decision.

The Agentfile v1 surface is stable enough to freeze with one implementation
tightening: unknown fields are rejected instead of silently stripped. This
prevents future source/trust/sync metadata from disappearing during
parse/stringify/update flows.

## Frozen Surface

The v1 schema is:

- discovery order: `Agentfile`, `agentfile.yaml`, `agentfile.yml`,
  `.anamnesis/agentfile.yaml`; exactly one may exist
- top-level `version: 1`
- `project.name`
- optional `project.description`
- optional `project.scopes[]`
- `tools[]`: `claude-code`, `codex`, `cursor`
- `fragments[]`: `id`, `version`, optional `params`, optional `adapters`,
  optional `pinned`
- optional `declined[]`: `id`, optional `reason`, optional `declined_at`
- optional `settings`
- optional `overrides`

Parser behavior is strict. Unknown fields at the top level or inside nested
objects are invalid.

## Frozen Field Decisions

### `settings.commit_on_apply`

Decision: keep as a v1 reserved no-op field.

Rationale:

- Existing compatibility fixtures and historical Agentfiles may include it.
- The CLI must not auto-commit from this setting in v1.
- Removing it now would require a migration for little user value.

Contract:

- Parser accepts the boolean field and defaults it to `false` when `settings`
  is present.
- Commands ignore it.
- Documentation calls it reserved.
- Any future commit automation must use a new explicit UX and cannot silently
  activate this field.

### `overrides.*.locked`

Decision: keep as a v1 ownership hint, not a hard update lock.

Rationale:

- Current safety is enforced by manifest drift detection and user-modified
  preservation.
- Silently changing `locked: true` into a hard lock would alter existing
  behavior.

Contract:

- Parser accepts `locked`.
- `update` does not treat it as an absolute write prohibition.
- `doctor` / repair docs may use it as context for human review.
- A future hard lock needs a new field or a schema migration.

### `declined_at`

Decision: keep as an optional string.

Rationale:

- Historical values may be free-form.
- ISO 8601 remains recommended, but parser-level date validation would create
  avoidable migration churn.

### `fragments[].source`

Decision: not part of Agentfile v1.

Rationale:

- Registry and signing docs define source/trust metadata, but no remote
  registry implementation has shipped.
- Existing v1 parsers now reject unknown fragment fields, so adding `source`
  later requires a schema migration or v2.
- Until then, registry source state belongs in cache/manifest metadata, not
  Agentfile.

### Generic `sync` Settings

Decision: no `sync` field in Agentfile v1.

Rationale:

- Remote sync is intentionally deferred.
- The project must not imply upload of handoff, ontology, AGENTS.md, or
  Agentfile state.

## Strict Unknown-Field Policy

Agentfile v1 rejects unknown keys in:

- top-level object
- `project`
- `project.scopes[]`
- `project.scopes[].overrides`
- `fragments[]`
- `fragments[].adapters`
- `declined[]`
- `settings`
- `overrides`
- `overrides.regions[]`
- `overrides.files[]`

`params` remains open-ended by design. Fragment-specific param validation is a
library-aware diagnostic, not a parser-level check.

## Migration Impact

No built-in migration is required for v1.0 if the project keeps the decisions
above:

- `commit_on_apply` stays accepted as reserved.
- `locked` stays accepted as ownership metadata.
- `source` is not added to v1.
- `sync` is not added to v1.

The existing `anamnesis migrate agentfile` skeleton remains the migration
surface for future schema versions, but v1.0 does not need a destructive
pre-freeze transform.

## Compatibility Evidence

Compatibility fixtures cover:

- historical Claude Code-only managed projects
- current all-adapter single-scope projects
- multi-scope pinned projects with scope-level fragment changes

Parser tests now also cover unknown-field rejection so future metadata cannot
be silently dropped.

## Post-v1 Evolution

After v1.0:

- field removals require a schema version bump and migration
- field meaning changes require a schema version bump and migration
- new Agentfile fields require a schema version bump unless the parser policy
  is deliberately changed with compatibility tests
- registry source metadata should be added only through the registry/signing
  migration plan
- remote sync metadata should stay out of Agentfile until privacy/trust
  design exists
