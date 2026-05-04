# Remote Sync Strategy

Status: v1.0 decision. No `anamnesis sync` command ships in v1.0.

## Decision

Do not add a top-level `anamnesis sync` command in v1.0.

Use explicit commands instead:

- `anamnesis update --dry-run` for local library/project lifecycle planning
- future `anamnesis registry refresh` for remote registry index refresh
- future `anamnesis fragment inspect/search` for remote fragment discovery
- future remote install/update only after registry, checksum, and signature
  verification are implemented

Rationale:

- "sync" is ambiguous. It could mean refresh registry indexes, download
  archives, apply fragment updates, upload handoff state, or synchronize
  context across machines.
- The current product promise is agent continuity inside a project, not remote
  state replication.
- Project context, ontology enrichment, and handoff files may contain private
  implementation details. Remote sync should not be introduced casually.
- The registry and signing designs already split passive discovery from
  explicit install/update. A broad `sync` command would blur that boundary.
- `update --dry-run` already covers local re-sync with the bundled or
  user-provided library while preserving edits.

## What Sync Must Not Mean

Before v1.0, `sync` must not mean:

- uploading `.anamnesis/handoff/` to a remote service
- uploading ontology, Agentfile, AGENTS.md, or local adapter surfaces
- applying remote fragment updates automatically
- executing hooks from remote fragments
- silently changing registry trust settings
- replacing `update --dry-run` as the review gate

Any future remote state feature needs a separate privacy and trust design.

## Explicit Command Model

Remote registry behavior should stay decomposed:

```bash
anamnesis registry list       # show configured registries
anamnesis registry refresh    # fetch and verify indexes only
anamnesis fragment search     # search verified metadata
anamnesis fragment inspect    # inspect one candidate and trust state
anamnesis update --dry-run    # plan project changes
anamnesis update --apply      # write only after review
```

This keeps each side effect visible:

| Command | Network | Filesystem writes | Project writes |
|---|---:|---:|---:|
| `registry refresh` | yes | registry cache only | no |
| `fragment search` | no, after cache | no | no |
| `fragment inspect` | no, after cache | no | no |
| `update --dry-run` | optional, if remote source enabled | cache only | no |
| `update --apply` | optional, if remote source enabled | cache plus backups | yes |

## Future `sync` Shape

If `anamnesis sync` is added after v1.0, it should be a convenience wrapper,
not a new behavior surface.

Allowed shape:

```bash
anamnesis sync --dry-run
```

Equivalent to:

1. refresh enabled registry indexes
2. verify cached metadata
3. run `update --dry-run`
4. print one combined plan

Rules:

- Dry-run by default.
- No project writes without `--apply`.
- No remote uploads.
- No executable adapter rendering without `--allow-exec-adapters`.
- No unsigned remote executable content.
- No trust-store mutation.

## Handoff and Ontology Sync

Handoff and ontology files are local project memory. They can include private
task state, architecture decisions, identifiers, service names, or operational
notes.

Before any remote handoff or ontology sync exists, the project needs:

- explicit opt-in storage target
- redaction model
- encryption/key ownership model
- retention/deletion model
- conflict resolution for concurrent agents
- clear separation from fragment registry sync

This is outside v0.9 and should not block v1.0.

## Agentfile Impact

No Agentfile field is needed for the v0.9 sync decision.

If a future registry source field is added, it belongs to the registry and
signing migration path described in:

- `docs/FRAGMENT-REGISTRY.md`
- `docs/FRAGMENT-SIGNING.md`
- `docs/AGENTFILE-MIGRATIONS.md`

Do not add a generic `sync` setting to Agentfile v1.

## Acceptance Criteria

- Users keep a clear distinction between local update, registry refresh, and
  project apply.
- Remote registry work can proceed without a broad `sync` command.
- No command implies remote upload of project context, ontology, or handoff
  data.
- Future `sync` can be added as a wrapper after the underlying safe commands
  exist.
