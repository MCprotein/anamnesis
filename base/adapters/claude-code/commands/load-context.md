---
description: Read and summarize anamnesis-managed ontology for this project
---

Show the current project context — entities, relationships, invariants — by reading the ontology files anamnesis maintains.

Invocation contract:

- If the user explicitly requests `/load-context` as the standalone task, provide the orientation summary and stop.
- If this procedure is invoked as auxiliary startup or orientation work during an active task, finish the read-only orientation and then continue the original task. It does not broaden the user's request or authorize additional work.

Steps:

1. Read every `*.yaml` under any `.anamnesis/ontology/` directory in the project — including nested ones for monorepo sub-scopes (e.g. `apps/api/.anamnesis/ontology/`). Use `find . -path '*/.anamnesis/ontology/*.yaml' -type f` (or equivalent) to locate them.
2. If `system_graph.yaml` exists at the project root, read it (user-managed; takes precedence over slices).
3. If the user's orientation question depends on project docs, roadmap entries, prior decisions, or evidence not present in the ontology files, run `anamnesis context query "<terms>"` and read the returned `source_path` / `stable_ref` before summarizing. Treat query snippets as source pointers, not authority.
4. Summarize concisely, grouping by scope when nested ontology dirs are present:
   - Main entities (services, hosts, identifiers, paths)
   - Relationships (who calls whom, who depends on what)
   - Stated invariants ("never do X", "always Y")
5. Don't make any edits — this is orientation only. Then follow the invocation contract: stop for a standalone request, or resume the original active task after auxiliary orientation.

If neither `.anamnesis/ontology/` nor `system_graph.yaml` exists, say so plainly and suggest running `anamnesis init`.
