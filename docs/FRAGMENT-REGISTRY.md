# Fragment Registry Design

Status: v1.0 design accepted; remote registry implementation deferred
post-v1.0. See `docs/REGISTRY-V1-DECISION.md`.

## Goal

The fragment registry lets anamnesis discover reusable context, ontology, and
adapter fragments beyond the built-in local library without weakening the two
core guarantees:

- A project still records installed state in `Agentfile`.
- `init`, `update`, and `doctor` remain dry-run friendly and preserve user
  edits, managed-region ownership, and adapter safety gates.

The registry is not a source-code package manager. It distributes agent
configuration fragments: project memory snippets, static ontology slices,
adapter surfaces, optional executable hooks, and metadata that helps the CLI
suggest the right fragment for a project.

## Non-Goals

- No automatic installation from a remote registry without an explicit user
  action.
- No remote code execution during discovery, version checks, or diagnostics.
- No hosted service requirement for local or bundled fragments.
- No Agentfile v1 shape change for basic installed fragments. Registry
  metadata may be added later, but `fragments[].id` and `fragments[].version`
  must keep working for existing projects.
- No deep dependency solver in v0.9. Version selection stays intentionally
  small until real registry usage proves a need.

## Model

The registry has three layers:

1. **Registry index**: a signed or checksum-addressed catalog of fragment ids,
   versions, compatibility, discovery hints, and archive locations.
2. **Fragment archive**: an immutable archive containing the same layout as a
   local `fragments/<id>/` directory.
3. **Local cache**: a content-addressed copy under the user's anamnesis cache,
   verified before use and treated as read-only input to `init` / `update`.

The built-in package remains a registry source named `builtin`. A remote
source is additive and should be resolved into the same in-memory
`FragmentDefinition` shape used by the current loader.

## Registry Index

The first index format should be boring YAML or JSON. YAML is easier for human
review; JSON is easier for strict parser tests. The CLI may support both later,
but the canonical published index should be JSON for stable signatures.

Example:

```json
{
  "schema_version": "anamnesis.registry.v1",
  "registry_id": "official",
  "generated_at": "2026-05-04T00:00:00Z",
  "base_url": "https://registry.anamnesis.dev",
  "fragments": [
    {
      "id": "prisma",
      "namespace": "official",
      "name": "Prisma",
      "description": "Prisma ORM operational guidelines and schema drift checks.",
      "license": "MIT",
      "homepage": "https://github.com/MCprotein/anamnesis",
      "source": "https://github.com/MCprotein/anamnesis/tree/main/fragments/prisma",
      "latest": 2,
      "versions": [
        {
          "version": 2,
          "released_at": "2026-05-03T00:00:00Z",
          "anamnesis": { "range": ">=0.7.0 <1.0.0" },
          "tools": ["claude-code", "codex", "cursor"],
          "capabilities": [
            "project_memory",
            "ontology",
            "executable_hook"
          ],
          "ontology": {
            "static": true,
            "bootstrap": true,
            "enrichment_skill": true
          },
          "archive": {
            "url": "fragments/prisma/2/prisma-2.tgz",
            "sha256": "TO_BE_FILLED_BY_PUBLISHER",
            "size_bytes": 12345
          },
          "signature": {
            "mode": "planned",
            "ref": "fragments/prisma/2/prisma-2.tgz.sig"
          }
        }
      ],
      "discovery": [
        {
          "rule_id": "prisma",
          "trigger": "any: [package_json_has: \"@prisma/client\", file_exists: prisma/schema.prisma]",
          "reason": "Prisma schema drift is a frequent source of deploy failures."
        }
      ]
    }
  ]
}
```

Required index fields:

| Field | Meaning |
|---|---|
| `schema_version` | Registry index schema. First version: `anamnesis.registry.v1`. |
| `registry_id` | Stable source id such as `official`, `local`, or a user-defined alias. |
| `generated_at` | ISO timestamp for diagnostics and cache freshness. |
| `fragments[].id` | Fragment id used by Agentfile and the local loader. |
| `fragments[].namespace` | Publisher namespace. `official/prisma` and `team/prisma` may coexist in a future UI, but current Agentfile still stores the resolved id. |
| `fragments[].latest` | Highest stable integer fragment version in this registry. |
| `versions[].version` | Integer fragment version matching `fragment.yaml`. |
| `versions[].anamnesis.range` | CLI compatibility range. |
| `versions[].archive.url` | Relative or absolute immutable archive URL. |
| `versions[].archive.sha256` | Required before install or update can use the archive. |

Optional index fields:

| Field | Meaning |
|---|---|
| `tools` | Adapter surfaces the fragment is expected to support. Diagnostics only; the archive `fragment.yaml` remains authoritative. |
| `capabilities` | High-level capability summary for search and docs. |
| `ontology` | Whether static slices, Layer A bootstrap, or Layer B enrichment are available. |
| `discovery` | Rulebook-compatible suggestions. These are suggestions, not install authority. |
| `signature` | Placeholder for the signing design. v0.9 signing work owns the exact format. |

## Fragment Archive

An archive must unpack to exactly one top-level directory:

```text
<id>/
  fragment.yaml
  content/
  adapters/
  .versions/
  README.md
```

Rules:

- `fragment.yaml` is authoritative after the archive checksum is verified.
- `id` and `version` in `fragment.yaml` must match the selected index entry.
- Paths must stay inside the archive root after normalization. Reject absolute
  paths, `..` escapes, symlink escapes, device files, and executable surprises
  outside declared adapter files.
- Archives are immutable. A registry must publish a new fragment version for
  any content change.
- `.versions/<version>/fragment.yaml` may be included for pinned-project
  compatibility, but the selected archive's current `fragment.yaml` still
  defines the version being installed.

## Discovery

Discovery should merge local and registry suggestions without changing the
current rulebook contract:

1. Load built-in `rulebook.md` and built-in fragments.
2. Load enabled registry indexes from the user or project config.
3. Evaluate built-in and registry `discovery` rules against the project.
4. Show suggestions with source, version, reason, trust state, and capability
   summary.
5. Write only the user's selected fragments to `Agentfile`.

Registry discovery rules should use the existing trigger language first:

- `package_json_has`
- `file_exists`
- `dir_exists`
- `pyproject_has`
- `any_yaml_contains`
- `all`
- `any`

New trigger expressions should be added only when they can be evaluated
without executing project code.

## Version Selection

Initial install:

- Select the highest stable version compatible with the current CLI.
- Do not select prerelease or yanked versions unless the user explicitly names
  them.
- If multiple registry sources provide the same id, prefer built-in fragments,
  then project-pinned sources, then user-configured remote sources. Ambiguous
  remote matches should be shown to the user rather than auto-selected.

Update:

- `fragments[].pinned: true` keeps the installed version until
  `update --bump-pinned`.
- Unpinned fragments may update to the highest compatible version from the
  same resolved source.
- Moving a fragment from one source to another is a migration, not a normal
  update.
- If a version is yanked after installation, `status` and `doctor` should warn
  but not remove local managed files.

Compatibility:

- Registry versions use the current integer `fragment.yaml` version.
- CLI compatibility uses semver ranges over the anamnesis package version.
- Fragment dependency constraints stay exact ids plus minimum integer versions
  until the dependency-resolution cross-cutting item is pulled into a release.

## Trust Boundaries

Discovery is passive:

- Fetching or reading an index does not install anything.
- Evaluating discovery rules reads project files only.
- No registry script, hook, or adapter file is executed.

Install and update are explicit:

- Remote archives are downloaded only after the user selects a fragment or
  asks to update installed fragments from that source.
- The archive checksum must match the index before unpacking.
- The unpacked `fragment.yaml` must parse with the same schema as local
  fragments.
- Rendering executable adapter surfaces still requires
  `--allow-exec-adapters`.
- `update` keeps dry-run default behavior. A remote source can affect the plan,
  but not the filesystem, without `--apply`.

Signing is specified separately in
[`docs/FRAGMENT-SIGNING.md`](FRAGMENT-SIGNING.md):

- v0.9 registry design requires checksums.
- v0.9 signing design decides signature artifacts, key identity, rotation,
  revocation, unsigned local-fragment migration, and local trust policy.
- Until signing ships, the official registry may be useful for design and
  preview flows, but executable remote fragments should remain opt-in and
  visibly marked as unsigned.

## Cache

Suggested cache layout:

```text
$XDG_CACHE_HOME/anamnesis/
  registries/<registry-id>/index.json
  archives/sha256/<first-two>/<sha256>.tgz
  unpacked/sha256/<sha256>/
```

Rules:

- Cache keys are content hashes, not mutable URLs.
- A failed verification deletes the downloaded archive.
- `doctor` can report stale indexes, missing cached archives, and checksum
  mismatches.
- `update` should work offline for already cached installed versions.
- Clearing the cache must not modify project `Agentfile`, manifest, managed
  regions, or handoff state.

## Agentfile Recording

Agentfile v1 does not record registry source metadata. The minimum compatible
record remains:

```yaml
fragments:
  - id: prisma
    version: 2
```

Future source metadata is not a transparent v1 addition because strict v1
parsers reject unknown fragment fields. Adding a shape like this requires a
schema migration, a later schema version, or an explicit parser-policy change
with compatibility tests:

```yaml
fragments:
  - id: prisma
    version: 2
    source:
      registry: official
      namespace: official
      digest: sha256:...
```

Before adding this field, `docs/AGENTFILE-MIGRATIONS.md` must define how older
projects are preserved and how source moves are represented. Until then,
registry source state belongs in local manifest/cache metadata, not Agentfile
v1.

## CLI Surface

Candidate commands:

```bash
anamnesis registry list
anamnesis registry add official https://registry.anamnesis.dev/index.json
anamnesis registry refresh
anamnesis fragment search prisma
anamnesis fragment inspect official/prisma@2
```

Do not add these until the signing/checksum design is complete. The first
implementation can be read-only search plus `init` suggestions; remote
`update --apply` can wait if safety evidence is thin.

## V1.0 Decisions

- Agentfile v1 does not include `fragments[].source`.
- Built-in and local-library fragments remain the only installable fragment
  sources in v1.0.
- Remote registry commands, archive download, cache, checksum verification,
  and source migration are post-v1.0 implementation work.
- The registry design must not weaken dry-run behavior, local-library safety,
  or executable-adapter permission gates.

## Open Decisions

- Whether official fragments should move out of the npm package or remain
  bundled forever with the registry as an extension path.
- Whether remote archives may contain executable hooks before signatures are
  fully enforced.
- Whether registry discovery rules live inside the main index or in a separate
  rulebook file per registry.
- Whether namespaces become user-facing ids (`official/prisma`) or only
  conflict-resolution metadata.

## Acceptance Criteria

- A future implementer can build index parsing, archive fetch, checksum
  verification, cache storage, and suggestion display without changing the
  current fragment loader schema.
- Existing built-in and local-library flows keep working with no network.
- Users can tell which source a suggestion came from before installing it.
- No remote content can execute during discovery or dry-run planning.
- Any field that could affect Agentfile stability points to a migration or
  later schema version before implementation.
