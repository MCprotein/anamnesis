---
name: ontology-enrich
description: |
  Add the semantic layer (relationships, flows, operational rules) on top of
  the deterministic facts produced by `anamnesis ontology bootstrap`. Run
  after a fresh bootstrap or whenever project intent has shifted in ways
  parsers can't detect. Layer B of the hybrid ontology bootstrap.
---

# ontology-enrich

`anamnesis ontology bootstrap` extracts factual structure (namespaces, services, models, routes) from project files via deterministic parsers. That is **Layer A**. It cannot infer intent — why this NodePort, what flow connects these services, which invariants must hold.

This skill is **Layer B**: agent-driven semantic enrichment. You read the bootstrap output plus surrounding context, then write the *meaning* into a sibling `enriched.yaml` file.

## Steps

1. **Discover ontology files**:
   ```bash
   find . -path '*/.anamnesis/ontology/*.yaml' -type f \
     -not -path '*/node_modules/*' -not -path '*/.git/*'
   ```
   Read every `<id>.yaml` (static), every `<id>.bootstrap.yaml` (Layer A), and every `<id>.enriched.yaml` if it already exists.

2. **Read project entry points** to understand intent:
   - `CLAUDE.md` / `AGENTS.md` (project conventions, deployment rules)
   - `system_graph.yaml` if present (user-curated top-level ontology)
   - `README.md` for high-level service descriptions
   - Any `docs/architecture*.md` or similar

3. **Identify what parsers couldn't infer** for each fragment with a `<id>.bootstrap.yaml`:
   - **Relationships** — cross-namespace dependencies, service-to-service call paths, "X depends on Y" statements not visible in YAML
   - **Flows** — request paths (e.g., "client → traefik → service → pod"), data pipelines, deploy paths (e.g., "Runner → zot → kubelet certs.d → workload pod")
   - **Operational notes** — invariants ("skip_verify unsupported on containerd v2"), gotchas ("ClusterIP changes require microk8s restart"), why-this-design decisions
   - **Intent** — purpose of specific resources (e.g., "this NodePort exposes the Steam query endpoint", "this Ingress fronts the OCI registry")

4. **Write `<id>.enriched.yaml`** for each fragment, using these top-level keys:
   ```yaml
   relationships:
     - from: { namespace: zot, kind: Service, name: zot }
       to:   { namespace: traefik, kind: Ingress, name: zot }
       reason: "external TLS termination + cert delivery via DNS-01"

   flows:
     - name: "image push"
       path: "developer → github actions runner → zot.zot.svc.cluster.local:5000"
     - name: "image pull (kubelet)"
       path: "kubelet → registry.<host>:8443 → certs.d → ClusterIP redirect"

   operational_notes:
     - id: "containerd-v2-skip-verify"
       rule: "MicroK8s containerd v2 does not support `skip_verify`; setting it crashes the runtime"
       severity: "must"
   ```
   Use whichever subset of keys applies. Omit empty sections rather than emitting `relationships: []`.

5. **Never modify `<id>.bootstrap.yaml`** — it's auto-regenerable; your edits would be lost on the next bootstrap. Always write to `<id>.enriched.yaml`.

6. **Show the diff** to the user. State what you added, why, and what you weren't sure about. Stop. Let the user review and commit.

## Re-running this skill

If `<id>.enriched.yaml` already exists, treat it as the source of truth for semantic content the user has already approved. Add new entries; do not overwrite or reorder existing entries unless the underlying fact changed (e.g., a service moved namespaces). When in doubt, append rather than rewrite.

## When to invoke

- Right after `anamnesis init` and `anamnesis ontology bootstrap` on a new project
- After a significant architectural change (new service, namespace split, deploy path migration)
- When `/load-context` reveals the ontology summary feels thin or generic

## When NOT to invoke

- The bootstrap files don't exist yet — run `anamnesis ontology bootstrap` first
- The user is asking for a code change. This skill produces ontology, not code.
- The project has no agent-discernible intent beyond what the static fragments already say (e.g., a tiny single-service repo)
