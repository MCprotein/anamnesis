# Context Index Design

Status: v1.6 prototype in progress.

## Goal

After v1.5, SessionStart should stay compact. Agents need a local way to find
the exact project context they need without injecting whole ontology and
handoff files into every new session.

The context index is a regenerable, read-only project artifact. It points to
source files, stable IDs, freshness, and short snippets. It is not a cloud
memory service and it does not replace source files as the authority.

## Inputs

Index these public/local project sources first:

- `AGENTS.md` and adapter entrypoint files for operating rules.
- `system_graph.yaml` for user-managed project ontology.
- `.anamnesis/ontology/*.yaml`, `.bootstrap.yaml`, and `.enriched.yaml`.
- `.anamnesis/handoff/active.md` plus referenced archive files.
- `.anamnesis/manifest.json` for installed fragment/render state.
- `.anamnesis/evidence/events.jsonl` for latest runtime evidence summaries.
- Selected docs under `docs/`, especially roadmap, benchmark, design, and
  claim-boundary documents.

Do not index secrets, env files, Terraform state, PEM keys, logs with tokens,
or arbitrary large build artifacts.

## Output Shape

Start with JSONL so the index is easy to inspect, diff, and regenerate:

```json
{
  "schema_version": "anamnesis.context_index.v1",
  "id": "ontology:base:rule:managed-region",
  "kind": "ontology-rule",
  "source_path": ".anamnesis/ontology/base.yaml",
  "source_mtime": "2026-06-19T00:00:00.000Z",
  "source_hash": "sha256:...",
  "scope_path": ".",
  "stable_ref": "operational_notes[managed-region]",
  "title": "Managed regions are generated",
  "snippet": "Do not edit managed anamnesis regions directly.",
  "tags": ["ontology", "rule", "managed-region"],
  "freshness": "current"
}
```

Required fields:

- `id`: deterministic and stable across regenerations when the source entry is
  semantically the same.
- `kind`: small enum such as `agent-rule`, `ontology-entity`,
  `ontology-relationship`, `handoff-task`, `evidence-summary`, or `doc-section`.
- `source_path`: repo-relative path to the authoritative source.
- `source_hash`: hash of the source file or source slice.
- `stable_ref`: source-local pointer, heading, YAML id, JSON pointer, or line
  anchor when available.
- `snippet`: short retrieval preview, not a replacement for reading the source.

## Query Contract

The first CLI surface should be read-only:

```bash
anamnesis context index --write
anamnesis context query "handoff current task"
anamnesis context query --kind ontology-rule "managed region"
anamnesis context resume
anamnesis context resume --write
```

Query output must cite `source_path` and `stable_ref`. Agents should then read
the exact source before relying on an invariant, relationship, entity, path, or
operational rule.

Prototype behavior:

- `anamnesis context index` builds the index in memory and reports source,
  entry, kind, and warning counts.
- `anamnesis context index --write` writes
  `.anamnesis/context/index.jsonl`.
- `anamnesis context query <terms>` reads the JSONL index, ranks exact local
  entries by term hits, and prints source pointers.
- `--kind <kind>` filters query results to one entry kind.
- `anamnesis context resume` prints a compact bundle with active handoff
  pointer, latest archive pointer, touched git files, latest runtime evidence,
  diagnostic warnings, retrieval rules, and line/char/token estimates.
- `anamnesis context resume --write` writes
  `.anamnesis/context/resume.md`; the file is regenerable and ignored by git.
- `.anamnesis/context/` is ignored by git because the index is regenerable and
  may include handoff snippets from local work.

## Export Interface Decision

v1.6 does not expose the context index through MCP or another API server.
Cross-session continuity stays intentionally simple:

- Agents can call `anamnesis context query` or `anamnesis context resume`.
- Agents can read regenerable files under `.anamnesis/context/`.
- Source files remain authoritative; generated index/resume files are pointers,
  not memory blobs.

Revisit MCP only if repeated dogfood shows CLI/file access is materially
blocking supported agent workflows.

## Diagnostics

The index enables v1.6 diagnostics that are hard with plain startup context:

- stale `active.md` archive pointers
- duplicate ontology entity IDs
- contradictory relationship claims across `system_graph.yaml`, bootstrap, and
  enriched ontology
- superseded semantic entries still treated as current
- evidence records that point to missing artifacts

Diagnostics should be advisory first. They should not rewrite user-authored
ontology or handoff files.

Prototype behavior:

- `anamnesis context diagnose` runs advisory checks over handoff files,
  ontology YAML, and runtime evidence.
- It reports missing or stale active handoff archive pointers.
- It reports duplicate ontology entity IDs and relationship IDs whose
  endpoints differ across sources.
- It reports semantic entries referenced by `supersedes` when the superseded
  entry is still unmarked as superseded.
- It reports explicit Markdown docs-vs-bootstrap conflicts only when docs use
  `anamnesis-fact: facts... = ...` markers. It does not infer contradictions
  from free-form prose.
- It reports malformed evidence JSONL lines and missing local artifact paths.
- `status` exposes only the path-free context diagnostic summary. `doctor`
  recomputes diagnostics and prints detailed advisory issues with source
  pointers and repair hints.

## Non-Goals

- No network service.
- No embedding dependency in the first version.
- No automatic prompt-time injection from query results.
- No secret scanning beyond conservative exclusion of known sensitive paths.
- No claim that indexed snippets are authoritative without source reads.

## Acceptance Criteria

- Regeneration is deterministic for the same project state.
- Output is repo-local and safe to delete/recreate.
- Query results include source pointers and short snippets.
- `doctor` or a context diagnostic can flag stale handoff pointers and at least
  one contradiction fixture.
- The generated resume/query output stays within the v1.5 compact context
  budget.
