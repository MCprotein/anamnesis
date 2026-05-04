# Registry and Signing V1 Decision

Status: v1.0 decision.

anamnesis will not ship remote fragment registry installation or signature
verification in v1.0. The design stays accepted, but implementation moves to a
post-v1.0 release so the stable Agentfile and local-library safety contract do
not absorb an under-tested remote trust boundary.

## Decision

v1.0 supports:

- built-in fragments bundled in the npm package;
- project-local or user-selected local libraries via existing CLI paths;
- `promote` for turning local project files into reusable local fragments;
- registry and signing design documentation for future implementation.

v1.0 does not support:

- `anamnesis registry ...` commands;
- remote fragment search, inspect, install, or update;
- remote archive download, cache, checksum, or signature verification;
- `fragments[].source` metadata in Agentfile v1;
- unsigned remote fragment install escape hatches;
- executable adapter rendering from any remote source.

## Rationale

- Agentfile v1 is now strict and does not include `fragments[].source`; adding
  source/trust metadata requires a schema migration or later schema version.
- Remote fragments can affect always-loaded agent instructions and executable
  adapter surfaces, so checksums, signatures, safe archive unpacking, trust
  stores, revocation, and rejection diagnostics must ship together.
- The current product goal is continuity across agents through local,
  inspectable context, ontology, and handoff surfaces. A partial remote
  registry is not required to make that v1.0 promise true.
- Keeping remote registry support post-v1.0 preserves the no-network behavior
  of existing `init`, `update`, `status`, `doctor`, and `migrate` flows.

## Guardrails For Future Implementation

Before a release can claim registry/signing support, it must implement and
test:

- registry index parsing with stable rejection diagnostics;
- signed release-manifest parsing and verification;
- archive checksum verification;
- safe archive unpacking that rejects path escapes, symlink escapes, device
  files, and unexpected roots;
- content-addressed cache behavior that never mutates project files by itself;
- explicit user selection before installing remote fragments;
- no remote code execution during discovery, dry-run planning, or diagnostics;
- executable remote adapter rendering only after signature verification plus
  the existing `--allow-exec-adapters` gate;
- migration handling for any Agentfile source/trust metadata.

The detailed designs remain:

- [`docs/FRAGMENT-REGISTRY.md`](FRAGMENT-REGISTRY.md)
- [`docs/FRAGMENT-SIGNING.md`](FRAGMENT-SIGNING.md)
- [`docs/REMOTE-SYNC-STRATEGY.md`](REMOTE-SYNC-STRATEGY.md)

## V1.0 User-Facing Wording

Use "registry/signing design ready" or "post-v1.0 registry/signing path
defined." Do not claim "public fragment registry shipped" or "remote signed
fragments supported" until the implementation and verification gates above
exist.
