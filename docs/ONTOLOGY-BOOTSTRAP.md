# Hybrid Ontology Bootstrap (v0.4)

> Status: implemented in 0.4.0; expanded in 0.4.1 with nextjs,
> nestjs, fastapi, multi-scope bootstrap output, and `--scope`.

Two-layer auto-generation of `.anamnesis/ontology/<fragment-id>.yaml` so
new projects don't start with an empty ontology slice.

| Layer | Mode | Source | Cost | Output type |
|---|---|---|---|---|
| **A** | deterministic | CLI introspector parses project files | none (no LLM) | facts (namespaces, ports, models, routes) |
| **B** | agent-driven | skill running in active tool (CC/Codex/Cursor) | LLM tokens | semantics (relationships, flows, operational notes) |

The two layers compose: Layer A populates verifiable facts; Layer B adds
the meaning a parser can't infer.

---

## 1. Why this design

Today `ontology` capability ships static snippets shipped by the
fragment library. They are generic and don't contain project-specific
truth (real namespace names, ports, models, etc.). Users either edit by
hand (current example-service `system_graph.yaml`) or skip the file entirely.

Goal: a new project running `anamnesis init` ends up with an ontology
that already reflects its real shape.

Non-goal: replacing human curation. Layer A + B together produce a
**draft**; user reviews, prunes, and accepts.

---

## 2. CLI surface

```
anamnesis ontology bootstrap [--scope=<path>] [--fragment=<id>] [--dry-run]
/ontology-enrich
```

- `bootstrap` — Layer A. Runs registered introspectors against the
  project/scope, writes `.anamnesis/ontology/<id>.bootstrap.yaml`.
- `/ontology-enrich` — Layer B. The base fragment installs this as an
  agent skill/slash surface; the active agent reads bootstrap facts and
  writes semantic `<id>.enriched.yaml` files.
- `--scope` — multi-scope projects: bootstrap one scope. Default: all
  scopes that have an applicable fragment.
- `--fragment` — bootstrap only one fragment's introspector. Default:
  all installed fragments with a registered introspector.
- `--dry-run` — print what would be written, no file writes.

---

## 3. File layout

For each installed fragment with an introspector:

```
.anamnesis/ontology/
  <id>.yaml              # static snippet (shipped by fragment, exists today)
  <id>.bootstrap.yaml    # NEW — Layer A output, regenerable
  <id>.enriched.yaml     # NEW — Layer B output, agent-curated
```

In multi-scope projects the same layout is rooted at the selected scope,
for example `apps/web/.anamnesis/ontology/nextjs.bootstrap.yaml`.

**Why three files instead of one with regions?**
- `bootstrap.yaml` is fully regenerable; running `bootstrap` again
  overwrites it. Keep it isolated so user never accidentally loses
  manual edits.
- `enriched.yaml` is agent-curated but user-reviewable. Tracked by
  manifest as `user-modified` once user touches it (existing semantics).
- The static `<id>.yaml` stays untouched as the canonical template.

`SessionStart` ontology injection (existing `inject-ontology.sh`) reads
all three and concatenates in order: static → bootstrap → enriched.

---

## 4. Introspector interface

```ts
// cli/src/core/introspector.ts

import { ProjectContext } from "../core/triggers.js";

export interface OntologyFacts {
  // Free-form structured data merged into <id>.bootstrap.yaml
  [key: string]: unknown;
}

export interface Introspector {
  fragmentId: string;
  /** Quick check: does this project have anything for this introspector to read? */
  appliesTo(ctx: ProjectContext): boolean;
  /** Parse project files, return facts as plain JS object (will be YAML-serialized). */
  introspect(ctx: ProjectContext): OntologyFacts;
}

export class IntrospectorRegistry {
  register(i: Introspector): void;
  for(fragmentId: string): Introspector | undefined;
  all(): Introspector[];
}
```

The bootstrap command:
1. Loads installed fragments from `Agentfile`.
2. For each fragment, looks up its introspector.
3. Runs `appliesTo(ctx)` — skip if false.
4. Runs `introspect(ctx)` — get facts.
5. Wraps in metadata header + writes `<id>.bootstrap.yaml`.

---

## 5. Built-in introspectors (v0.4 first cut)

| Fragment | Source files | Extracted facts |
|---|---|---|
| `k8s` | `**/*.yaml` (kind: Namespace, Service, Ingress, Deployment, StatefulSet) | namespaces, services (name/ns/type/ports/selector), ingresses (host/paths), workloads (kind/name/ns/image) |
| `prisma` | `**/schema.prisma` | datasource, generator, models (name + fields + relations) |
| `nextjs` | `app/**/page.tsx?` and `pages/**/*.tsx?` | routes (file path → URL), dynamic segments, layouts |
| `nestjs` | `**/*.controller.ts` (regex first cut, ts-morph later) | controllers, route prefixes, handler verbs/paths |
| `fastapi` | `**/*.py` (regex on `@app.get/post/...` and `@router.*`) | routers, paths, methods |

Each lives at `cli/src/introspectors/<fragment-id>.ts` and registers
itself via `registerBuiltinIntrospectors(registry)`.

**Out of scope for first cut**: `docker-compose` (defer; low signal),
`python-uv` (introspection covered by `fastapi` if installed).

---

## 6. Bootstrap output format

`.anamnesis/ontology/k8s.bootstrap.yaml`:

```yaml
# AUTO-GENERATED by 'anamnesis ontology bootstrap' — do not edit by hand.
# Re-run bootstrap to refresh. To add semantic notes, edit
# .anamnesis/ontology/k8s.enriched.yaml instead.
#
# generator: anamnesis@0.4.1 introspector=k8s

namespaces:
  - sanitized-app
  - zot
  - traefik
services:
  - name: zot
    namespace: zot
    type: ClusterIP
    ports: [{ name: http, port: 5000, target: 5000 }]
ingresses:
  - host: registry.mcprotein.mywire.org
    paths: [{ path: /, service: zot, port: 5000 }]
workloads:
  - { kind: Deployment, name: zot, namespace: zot, image: ghcr.io/project-zot/zot:v2.x }
```

Manifest tracks this file with hash. Re-running `bootstrap` updates the
hash; `update --apply` doesn't touch it (different command path).

---

## 7. Layer B: `ontology-enrich` skill

Shipped as a normal `skill` capability of the `base` fragment (so it
gets rendered to all three adapters automatically). Skill instructs the
agent:

```
1. Read all .anamnesis/ontology/*.yaml (static + bootstrap).
2. Read project entry points (CLAUDE.md/AGENTS.md, system_graph.yaml if present, etc.).
3. Identify semantic relationships not visible to parsers:
   - data flow paths (e.g., kubelet pull → certs.d → ClusterIP)
   - cross-namespace dependencies
   - operational rules (e.g., "skip_verify unsupported on containerd v2")
   - hostname/path/port intent (why this NodePort, what it serves)
4. Append to .anamnesis/ontology/<fragment>.enriched.yaml under top-level keys:
     relationships:
     flows:
     operational_notes:
   Never modify .bootstrap.yaml (auto-generated).
5. Stop. Show diff. User reviews and commits.
```

Tool-agnostic — same content rendered via SKILL.md (CC), AGENTS.md
region (Codex), `.cursor/rules/*.mdc` (Cursor). Existing skill
rendering pipeline handles this for free.

---

## 8. Integration points

- `init` flow: after fragment install, runs bootstrap automatically.
  `--no-bootstrap` skips this pass.
- `update` flow: doesn't auto-rerun bootstrap (would clobber user
  edits if they touched `.bootstrap.yaml` despite warnings). User runs
  `bootstrap` explicitly when project shape changes.
- Future `status` flow: report `bootstrap` hash drift if
  `<id>.bootstrap.yaml` exists but doesn't match what introspector would
  produce now.

---

## 9. Test strategy

- **Unit**: each introspector against a synthetic project fixture
  (`__fixtures__/k8s-sample/`, `__fixtures__/prisma-sample/`, etc.).
  Assert exact YAML output.
- **Integration**: `init --apply` on a fixture monorepo with k8s +
  prisma + nextjs. Assert bootstrap files created in expected scopes.
- **Drift**: modify fixture file, re-run bootstrap, assert hash bumps.
- Aim: +30 tests minimum.

---

## 10. Phased rollout

| Phase | Deliverable | Tests | Status |
|---|---|---|---|
| 0.4.0 | core + k8s + prisma introspectors, bootstrap command, enrich skill, `init` auto-bootstrap | +27 | shipped |
| 0.4.1 | nextjs + nestjs + fastapi introspectors, multi-scope bootstrap, `--scope` | +33 | shipped |
| 0.5.0 | introspector author SDK frozen + community fragment guide | — | planned |

Phase 0.4.0 ships the architecture + 2 most-impactful built-ins
(sanitized-k8s + sanitized-nest-prisma both immediately benefit). Later
phases add coverage without API churn.

---

## 11. Open questions

- **Layer B re-runs**: if user runs `/ontology-enrich` twice, does it
  append, replace, or diff? Lean toward "instruct agent to merge
  intelligently and present diff" — defer enforcement to the agent.
- **Multi-scope fact aggregation**: resolved in 0.4.1 as per-scope
  output. Each scope's introspector reads its own subtree; root-level
  manifests are handled by the root scope only.
- **Stable ordering**: introspector output must be deterministic to
  avoid spurious drift. Use sorted keys, sorted arrays where order is
  not semantic.
- **Schema versioning**: `<id>.bootstrap.yaml` should carry a
  `schema_version` field so future introspector changes can migrate
  smoothly.
