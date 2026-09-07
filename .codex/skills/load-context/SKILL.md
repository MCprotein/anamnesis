---
name: load-context
description: |
  Re-orient on the project's structure by reading anamnesis-managed ontology
  files. Use at session start, after a long context-clearing pause, or when
  the agent appears to have lost track of project conventions.
---

# load-context

When invoked, perform only the read-only orientation steps below.

## Invocation contract

- If the user explicitly requests `load-context` as the standalone task, provide the orientation summary and stop.
- If this skill is invoked as auxiliary startup or orientation work during an active task, finish the orientation and then continue the original task. It does not broaden the user's request or authorize additional work.

## Steps

1. Locate every `.anamnesis/ontology/*.yaml` in the project — including nested directories under monorepo sub-scopes (e.g. `apps/api/.anamnesis/ontology/`). The recommended discovery pattern:
   ```bash
   find . -path '*/.anamnesis/ontology/*.yaml' -type f \
     -not -path '*/node_modules/*' -not -path '*/.git/*'
   ```
2. Read each found file. These are anamnesis-managed slices written by installed fragments.
3. If `system_graph.yaml` exists at the project root, read it. This is user-managed and represents the authoritative top-level ontology.
4. If the user's orientation question depends on project docs, roadmap entries, prior decisions, or evidence not present in the ontology files, run `anamnesis context query "<terms>"` and read the returned `source_path` / `stable_ref`. Treat query snippets as source pointers, not authority.
5. Summarize what you read, grouping by scope when nested ontology dirs are present:
   - **Entities**: namespaces, services, hosts, identifiers, paths
   - **Relationships**: dependencies, call paths, ownership
   - **Invariants & rules**: anything stated as "must" / "never" / "always"
6. Do not edit files during orientation. Then follow the invocation contract: stop for a standalone request, or resume the original active task after auxiliary orientation.

## When the project has no ontology

If neither `.anamnesis/ontology/` nor `system_graph.yaml` exists:

- Say so plainly.
- Suggest `anamnesis init` to install the baseline.
- Do not invent ontology content from filesystem inspection — that's `init`'s job, not yours.

## Why this skill exists

Without it, every fresh session starts from zero project context. The agent re-derives the structure from filenames, package.json, etc. — slow, error-prone, and inconsistent across sessions. The ontology files are the single source of truth; this skill ensures the agent reads them first.
