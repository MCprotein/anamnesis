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

Non-goals:
- replacing human curation. Layer A + B together produce a **draft**;
  user reviews, prunes, and accepts.
- becoming the whole product roadmap. Ontology bootstrap supports the
  larger anamnesis goal: every supported agent should receive current
  project context and be able to continue work after an agent switch.

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
- `anamnesis status` — reports ontology gaps: missing static slices,
  missing or stale bootstrap facts, missing semantic enrichment, fragments
  without registered introspectors, and introspectors that are not
  applicable in the current scope.
- `anamnesis doctor` — turns actionable ontology gaps into warnings with
  the next command or skill to run.

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
- `enriched.yaml` is agent-curated and user-reviewable. It is intentionally
  separate from regenerable bootstrap output; `status` / `doctor` report
  when it is missing.
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
# generator: anamnesis@0.5.0 introspector=k8s

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

`bootstrap.yaml` files are regenerable Layer A outputs. Re-running
`bootstrap` refreshes them; `update --apply` doesn't touch them because it
only owns fragment-rendered surfaces. `status` / `doctor` report when an
applicable installed fragment is missing bootstrap or enrichment files, or
when the existing bootstrap output no longer matches the current
introspector result.

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
4. Write or update .anamnesis/ontology/<fragment>.enriched.yaml under top-level keys:
     relationships:
     flows:
     operational_notes:
     open_questions:
   Never modify .bootstrap.yaml (auto-generated).
5. Merge existing enriched content by stable entry IDs.
6. Stop. Show diff. User reviews and commits.
```

Tool-agnostic — same content rendered via SKILL.md (CC), AGENTS.md
region (Codex), `.cursor/rules/*.mdc` (Cursor). Existing skill
rendering pipeline handles this for free.

### Layer B re-run policy

`<id>.enriched.yaml` is user-reviewed semantic memory. A re-run must treat
existing content as state, not scratch output:

- **Same id, same meaning**: leave unchanged.
- **New id, new fact**: append with `evidence` and `confidence`.
- **Old id, changed design**: append a replacement with `supersedes:
  "<old-id>"` instead of deleting the old entry.
- **Old id, invalid fact**: make the smallest correction only when preserving
  the old text would mislead the next agent.
- **Weak evidence or inference**: write an `open_questions` entry instead of
  pretending it is a fact.
- **Ordering**: preserve existing arrays; append by default.

Recommended entry fields:

```yaml
relationships:
  - id: "service-to-ingress"
    from: { kind: Service, name: api, namespace: app }
    to: { kind: Ingress, name: api, namespace: app }
    reason: "Ingress terminates external HTTP traffic before routing to api"
    evidence:
      - "k8s.bootstrap.yaml: Service/api and Ingress/api"
    confidence: "high"

flows:
  - id: "user-login"
    name: "user login"
    path: "browser -> web -> api -> postgres"
    evidence:
      - "README.md: authentication flow"
    confidence: "medium"

operational_notes:
  - id: "db-migration-before-deploy"
    rule: "Run migrations before deploying api pods"
    severity: "must"
    evidence:
      - "AGENTS.md: deploy invariant"

open_questions:
  - id: "cache-owner"
    question: "Which service owns cache invalidation?"
    evidence:
      - "No owner found in docs or bootstrap output"
```

---

## 8. Integration points

- `init` flow: after fragment install, runs bootstrap automatically.
  `--no-bootstrap` skips this pass.
- `update` flow: doesn't auto-rerun bootstrap (would clobber user
  edits if they touched `.bootstrap.yaml` despite warnings). User runs
  `bootstrap` explicitly when project shape changes.
- `status` flow: reports whether installed fragments have their static
  ontology slice, applicable bootstrap output, current bootstrap facts, and
  semantic enrichment file. It also identifies installed fragments without
  deterministic Layer A support so dogfood evidence can guide future
  introspector work.

---

## 9. Test strategy

- **Unit**: each introspector against a synthetic project fixture
  (`__fixtures__/k8s-sample/`, `__fixtures__/prisma-sample/`, etc.).
  Assert exact YAML output.
- **Integration**: `init --apply` on a fixture monorepo with k8s +
  prisma + nextjs. Assert bootstrap files created in expected scopes.
- **Drift**: modify fixture file, assert `status` / `doctor` report stale
  bootstrap output, then re-run bootstrap and assert hash bumps.
- Aim: +30 tests minimum.

---

## 10. Phased rollout

| Phase | Deliverable | Tests | Status |
|---|---|---|---|
| 0.4.0 | core + k8s + prisma introspectors, bootstrap command, enrich skill, `init` auto-bootstrap | +27 | shipped |
| 0.4.1 | nextjs + nestjs + fastapi introspectors, multi-scope bootstrap, `--scope` | +33 | shipped |
| 0.5.x | context-continuity dogfood, adapter parity fixtures, session-start contract, and introspector API review | +14 | shipped |
| 0.6.x | ontology drift reporting, Layer B re-run semantics, targeted introspector improvements from dogfood gaps | +5 so far | in progress; gap report, re-run semantics, and bootstrap drift shipped |

Phase 0.4.0 ships the architecture + 2 most-impactful built-ins
(sanitized-k8s + sanitized-nest-prisma both immediately benefit). Later
phases add coverage without API churn, but only after the broader
agent-switching context story is verified. New framework introspectors
should be evidence-driven, not added just to fill out a catalog.

---

## 11. Open questions

- **Layer B re-runs**: resolved in base v7 as append-safe merge by stable
  entry IDs, `supersedes` for replacement designs, and `open_questions` for
  weak evidence.
- **Multi-scope fact aggregation**: resolved in 0.4.1 as per-scope
  output. Each scope's introspector reads its own subtree; root-level
  manifests are handled by the root scope only.
- **Stable ordering**: introspector output must be deterministic to
  avoid spurious drift. Use sorted keys, sorted arrays where order is
  not semantic.
- **Schema versioning**: `<id>.bootstrap.yaml` should carry a
  `schema_version` field so future introspector changes can migrate
  smoothly.
