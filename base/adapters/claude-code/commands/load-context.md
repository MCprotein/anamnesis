---
description: Read and summarize anamnesis-managed ontology for this project
---

Show the current project context — entities, relationships, invariants — by reading the ontology files anamnesis maintains.

Steps:

1. Read every file under `.anamnesis/ontology/` (these are anamnesis-managed slices, one per installed fragment).
2. If `system_graph.yaml` exists at the project root, read it (user-managed; takes precedence over slices).
3. Summarize concisely:
   - Main entities (services, hosts, identifiers, paths)
   - Relationships (who calls whom, who depends on what)
   - Stated invariants ("never do X", "always Y")
4. Stop. Don't make any edits or run other tools — this is orientation only.

If neither `.anamnesis/ontology/` nor `system_graph.yaml` exists, say so plainly and suggest running `anamnesis init`.
