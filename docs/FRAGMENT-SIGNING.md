# Fragment Signing and Checksum Design

Status: v1.0 design accepted; remote signing verification implementation
deferred post-v1.0. See `docs/REGISTRY-V1-DECISION.md`.

## Goal

Remote fragments can affect always-loaded agent instructions and may install
executable adapter surfaces. The signing and checksum contract must make
remote fragment use auditable and rejectable before any content reaches
`init`, `update`, or adapter rendering.

The design has three jobs:

- Prove archive integrity with required checksums.
- Prove publisher identity with signatures before default remote install.
- Preserve existing unsigned local and bundled fragments without forcing a
  breaking Agentfile migration.

## Policy Summary

| Source | Checksum | Signature | Default behavior |
|---|---|---|---|
| Built-in npm package fragments | npm package integrity | npm package provenance / package manager trust | Allowed as today |
| Project-local library via `--library` | local filesystem | none | Allowed; treated as local author input |
| Cached remote archive | required | required for default install/update | Allowed only after verification |
| Unsigned remote archive | required | missing | Preview-only by default; install requires an explicit unsafe override and cannot render executable adapter surfaces |
| Checksum mismatch | failed | irrelevant | Reject and delete downloaded archive |
| Signature mismatch | checksum may pass | failed | Reject; keep existing installed files untouched |

Checksums are mandatory for all remote archives. Signatures are mandatory for
normal remote install and update. Local fragments remain unsigned because they
are already inside the user's selected filesystem or npm package trust
boundary.

## Verification Artifacts

Registry index entries point at a fragment archive and a signed release
manifest.

```json
{
  "schema_version": "anamnesis.fragment-release.v1",
  "registry_id": "official",
  "namespace": "official",
  "fragment_id": "prisma",
  "version": 2,
  "archive": {
    "url": "fragments/prisma/2/prisma-2.tgz",
    "sha256": "hex-encoded-sha256",
    "size_bytes": 12345
  },
  "fragment_yaml_sha256": "hex-encoded-sha256",
  "anamnesis": {
    "range": ">=0.7.0 <1.0.0"
  },
  "capabilities": [
    "project_memory",
    "ontology",
    "executable_hook"
  ],
  "created_at": "2026-05-04T00:00:00Z",
  "yanked": false
}
```

The signature is detached from the archive and signs the canonical release
manifest bytes, not the mutable registry index. The release manifest binds:

- registry id
- namespace
- fragment id
- fragment version
- archive URL
- archive SHA-256
- unpacked `fragment.yaml` SHA-256
- CLI compatibility range
- capability summary
- yank state

The registry index may also be signed for freshness and tamper evidence, but
archive acceptance must not rely on the index signature alone. The archive
digest and release-manifest signature are the install gate.

## Trust Store

Trusted publishers are resolved from a local trust store:

```yaml
schema_version: anamnesis.trust.v1

registries:
  official:
    index_url: https://registry.anamnesis.dev/index.json
    keys:
      - id: official-2026-01
        algorithm: ed25519
        public_key: base64-public-key
        status: active
      - id: official-2027-01
        algorithm: ed25519
        public_key: base64-public-key
        status: staged
```

Rules:

- Official keys may be bundled with the npm package.
- User/team keys live in user config, not project managed regions.
- Do not use trust-on-first-use for the official registry.
- A key marked `revoked` rejects new installs and updates signed by that key.
- A key marked `retired` verifies historical cached artifacts but does not
  accept new release manifests.
- Key rotation requires an overlap window where both old and new keys verify
  the same release manifest series.

## Verification Pipeline

Remote install/update verification must run in this order:

1. Fetch registry index.
2. Validate index schema.
3. Select candidate version compatible with the current CLI.
4. Fetch release manifest and detached signature.
5. Verify the manifest signature against the registry trust store.
6. Fetch archive.
7. Verify archive SHA-256 and size.
8. Unpack into an isolated temp directory.
9. Reject path escapes, symlink escapes, device files, and unexpected archive
   roots.
10. Parse `fragment.yaml` with the existing fragment schema.
11. Verify `fragment.yaml` id and version match the release manifest.
12. Verify unpacked `fragment.yaml` SHA-256.
13. Move archive/unpacked content into the content-addressed cache.
14. Plan render actions exactly like local fragments.

Failures before step 13 leave no cache entry. Failures after step 13 still
leave project files untouched unless the user later runs an apply command that
passes all render and drift checks.

## Rejection Reasons

`status`, `doctor`, and future registry commands should use stable rejection
codes so automation can report them:

| Code | Meaning |
|---|---|
| `registry-index-invalid` | Index schema failed validation. |
| `registry-key-untrusted` | No trusted key exists for the manifest signer. |
| `registry-key-revoked` | Manifest signer key is revoked. |
| `manifest-signature-invalid` | Detached signature does not verify. |
| `manifest-archive-mismatch` | Index and signed manifest disagree on archive identity. |
| `archive-checksum-mismatch` | Downloaded archive digest differs from signed manifest. |
| `archive-path-escape` | Archive contains absolute paths, parent escapes, or symlink escapes. |
| `fragment-yaml-mismatch` | Parsed `fragment.yaml` id/version/hash differs from signed manifest. |
| `fragment-cli-incompatible` | Candidate version does not support the current CLI version. |
| `fragment-yanked` | Version is yanked for new installs. |
| `remote-exec-unsigned` | Unsigned remote content requested executable adapter rendering. |

## Unsigned Local Fragments

Existing projects already use unsigned fragments from two places:

- the bundled npm package
- a local filesystem library passed through `--library`

These remain valid. They should not be rewritten or marked broken when signing
support ships.

Migration behavior:

- Existing `Agentfile` entries with no source metadata are interpreted as
  `source: builtin-or-local`.
- `status` may show `signature: local-unsigned` as informational only.
- `doctor` must not warn for unsigned built-in or `--library` fragments.
- Moving an installed local fragment to a remote registry source requires an
  explicit migration plan because the source and trust boundary changed.
- A future `anamnesis migrate agentfile --apply` may add optional source
  metadata, but it must not be required for v1 compatibility.

## Unsigned Remote Fragments

Unsigned remote fragments are not equivalent to local fragments.

Default behavior:

- `fragment search` / `registry inspect` may show them as `unsigned`.
- `init` may show them only if the registry source is explicitly enabled.
- `init --apply` and `update --apply` reject them by default.
- `doctor` warns if an installed remote fragment has no accepted signature.
- Executable adapter rendering from unsigned remote archives is always
  rejected, even with `--allow-exec-adapters`.

An escape hatch may exist for early development:

```bash
anamnesis init --allow-unsigned-remote-fragments
```

If implemented, the flag should require a second explicit source selection
and print a warning in the plan. It should not be available through a project
managed region or fragment parameter.

## Executable Adapter Policy

Remote fragments can contain `executable_hook` capabilities. Verification
does not mean automatic execution.

Rules:

- Signed remote executable hooks still require `--allow-exec-adapters`.
- Unsigned remote executable hooks are rejected.
- Dry-run plans must label executable outputs with source and signature state.
- Existing drift protection still applies: user-modified generated hook files
  are not overwritten.
- Codex SessionStart wrappers and git-hook bridges require the normal
  executable-adapter path; Codex/Cursor fallback instructions for other hooks
  remain instructions unless a concrete executable bridge is installed.

## Yank and Revocation

Yanking a fragment version means:

- new installs reject the version by default
- updates do not move to that version
- existing installations keep working
- `status` and `doctor` warn with the reason if the signed manifest or index
  reports one

Revoking a key means:

- new installs and updates signed by that key are rejected
- cached artifacts signed before revocation are treated according to the trust
  store policy
- existing project files are not deleted
- a repair or migration flow should suggest a safe replacement when available

## Cache Integrity

The cache layout from `docs/FRAGMENT-REGISTRY.md` stays content-addressed.

Rules:

- The archive path is derived from the archive SHA-256.
- The unpacked path is derived from the same archive SHA-256.
- Reverification can run offline against cached manifest, signature, archive,
  and trusted keys.
- Cache cleanup never changes project files.
- A checksum mismatch deletes only the bad cache/download artifact.

## Agentfile Source Metadata

Signing does not require immediate Agentfile changes. If source metadata is
added after v1.0, it should be optional and migration-owned:

```yaml
fragments:
  - id: prisma
    version: 2
    source:
      registry: official
      namespace: official
      digest: sha256:...
      signature:
        key_id: official-2026-01
```

Open constraint: Agentfile v1 rejects unknown fragment fields. Adding this
shape therefore requires a schema migration or an explicit parser-policy
change with compatibility tests. Until then, registry source state can live in
the local manifest/cache metadata while Agentfile keeps `id` and `version`.

## Implementation Order

1. Add parser types and tests for release manifests and trust stores.
2. Add archive checksum verification and safe unpack tests.
3. Add signature verification behind a small internal interface.
4. Add read-only registry inspect/search output.
5. Add dry-run `init` suggestion integration.
6. Add remote install only after unsigned/exec rejection tests are in place.

## Acceptance Criteria

- Remote archives cannot be used without matching signed manifest checksums.
- The CLI can explain why a remote fragment was accepted or rejected.
- Existing unsigned local and bundled fragments remain valid.
- Executable remote fragments require both signature verification and the
  existing executable-adapter permission gate.
- No signing field forces an Agentfile v1 breaking change without an explicit
  migration plan.
