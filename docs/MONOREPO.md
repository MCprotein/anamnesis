# Monorepo guide

How to apply anamnesis to a monorepo (multiple apps under one repo).

Available since **v0.2**. `init --monorepo` can detect common workspace
layouts and generate a multi-scope Agentfile; hand-editing remains useful
for unusual repo shapes or explicit fragment overrides.

---

## Concepts

A **scope** is a sub-project within the repository. Each scope has its
own `path`, `tools`, and `fragments` list, with optional inheritance
from a parent scope via `extends`.

```yaml
project:
  scopes:
    - path: .                        # root scope
    - path: apps/api
      extends: .                     # inherit root tools + fragments
      overrides:
        fragments_add: [{...}]       # add to inherited list
        fragments_remove: [...]      # drop by id
        tools: [...]                 # replace inherited tools list
```

### What gets per-scope vs project-wide

| Capability | Behavior |
|---|---|
| `project_memory` (AGENTS.md region + Claude entrypoint) | Scope-local: writes to `<scope>/AGENTS.md`; Claude Code also gets `<scope>/CLAUDE.md` pointing at that scope memory |
| `ontology` (slice file) | Scope-local: writes to `<scope>/.anamnesis/ontology/<id>.yaml`; bootstrap facts write beside the static slice as `<id>.bootstrap.yaml` |
| `executable_hook` | **Project-root only** for native/bridge files — Claude Code's `settings.json` and git hooks are root concerns |
| `skill` | Native/fallback files such as `.claude/skills/` and `.cursor/rules/` are project-root; Codex AGENTS fallback can be scope-local |
| `slash_command` | Native/fallback files such as `.claude/commands/` and `.cursor/rules/` are project-root; Codex AGENTS fallback can be scope-local |
| `task_harness` | Project-root retrieval target: writes `.anamnesis/task-harnesses/<name>.yaml`; scope-specific applicability belongs in the harness body until scoped matching exists |

Implication: scopes are most useful for **per-app guidance and ontology**.
Native hook/skill/command surfaces stay repo-wide when the underlying tool
requires root files, while AGENTS.md-based fallbacks can still carry
scope-local command or skill intent.

---

## Step-by-step: applying to a monorepo

### Example layout

```
my-monorepo/
├── apps/
│   ├── api/             # FastAPI backend
│   ├── web/             # Next.js frontend
│   └── worker/          # Python worker (uv)
├── packages/
│   └── shared/          # shared TypeScript lib (no special fragment)
├── docker-compose.yml   # at root
└── package.json         # at root (monorepo manifest)
```

### 1. First init at the root

```bash
cd my-monorepo
anamnesis init --dry-run
```

Anamnesis will detect rulebook matches at the root level and propose
fragments. For our example layout it might detect `docker-compose`
and possibly `python-uv` (if `uv.lock` is at root). Apply with:

```bash
anamnesis init --allow-exec-adapters
```

For automatic scope detection, use:

```bash
anamnesis init --monorepo --dry-run
```

Anamnesis detects common `apps/*`, `packages/*`, and workspace layouts.
If your repo shape is unusual, start with the generated Agentfile and
hand-edit the scopes.

### 2. Review or hand-edit `Agentfile` scopes

If `init --monorepo` detected the layout, review the generated scopes.
For unusual layouts, open the generated `Agentfile` and rewrite as
multi-scope:

```yaml
version: 1
project:
  name: my-monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
      overrides:
        fragments_add:
          - { id: fastapi, version: 1 }
          - { id: python-uv, version: 1 }
    - path: apps/web
      extends: .
      overrides:
        fragments_add:
          - { id: nextjs, version: 1 }
    - path: apps/worker
      extends: .
      overrides:
        fragments_add:
          - { id: python-uv, version: 1 }
        fragments_remove: []   # nothing to drop here
tools:
  - claude-code
fragments:
  - { id: base, version: 2 }
  - { id: docker-compose, version: 1 }
```

Notes:
- The top-level `fragments` is the **root scope's** fragment list. Each
  sub-scope inherits via `extends: .` and adds its own.
- `base` always lives at root (it's auto-included regardless).
- Fragments shared by all apps go in root + `extends`. Fragments
  specific to one app go in that scope's `fragments_add`.

### 3. Run `update`

```bash
anamnesis update --dry-run --allow-exec-adapters
```

Expected output:

```
fragments: base, docker-compose, fastapi, python-uv, nextjs
changes: create=N update=0 noop=0 blocked=0 user-modified=0
```

What gets created:

| Path | Source |
|---|---|
| `AGENTS.md` (root) | `anamnesis-base` + `docker-compose` regions |
| `apps/api/AGENTS.md` | `anamnesis-base` (inherited) + `fastapi` + `python-uv` regions |
| `apps/web/AGENTS.md` | `anamnesis-base` + `nextjs` regions |
| `apps/worker/AGENTS.md` | `anamnesis-base` + `python-uv` regions |
| `.anamnesis/ontology/{base,docker-compose}.yaml` | root ontology |
| `apps/api/.anamnesis/ontology/{fastapi,python-uv}.yaml` | per-scope |
| `apps/web/.anamnesis/ontology/nextjs.yaml` | per-scope |
| `apps/api/.anamnesis/ontology/fastapi.bootstrap.yaml` | per-scope deterministic facts if bootstrap applies |
| `apps/web/.anamnesis/ontology/nextjs.bootstrap.yaml` | per-scope deterministic facts if bootstrap applies |
| `.claude/hooks/*` | repo-wide (root only, regardless of scope) |
| `.claude/commands/load-context.md` | repo-wide |
| `.codex/hooks.json` + `.anamnesis/codex-native-hooks/*.mjs` | repo-wide Codex native lifecycle hooks |

When you actually `cd apps/api` and start a Claude Code session,
CC reads BOTH `AGENTS.md` (root) AND `apps/api/AGENTS.md` —
the agent gets the cumulative context.

### 4. Apply

```bash
anamnesis update --apply --allow-exec-adapters
```

---

## Verification

- `anamnesis status` reports installed fragments + drift across the whole
  project, grouped per scope for multi-scope Agentfiles.
- `anamnesis doctor` reports missing fragments, drift, update warnings,
  and adapter registration issues across the project.
- `cat apps/api/AGENTS.md` should show the inherited + scope-specific
  regions.
- `find . -path '*/.anamnesis/ontology/*.yaml'` lists all ontology
  slices the Claude Code and Codex SessionStart hooks will inject.

---

## Common pitfalls

### Don't put per-scope hooks in sub-scope `.claude/hooks/`

CC reads `.claude/settings.json` only at project root. Hooks installed
at `apps/api/.claude/hooks/` won't be auto-registered. Exec adapter files
are root-wide; use fragments at the root scope or the base scope for them.

### Don't list root-wide fragments in sub-scopes

If `base` is in `fragments` at the top level, sub-scopes that `extends: .`
already see it. Adding `base` again in `fragments_add` works (de-duped)
but is redundant.

### `extends` only inherits the parent scope at resolution time

Multiple inheritance levels work (a → b → c via extends chain), but
cycles are rejected by the schema validator.

### Don't run `init` twice in a monorepo

`init` errors out if `Agentfile` already exists. For sub-app changes,
edit the Agentfile manually and run `update`.

---

## Roadmap touchpoints

The next monorepo focus is context continuity, not merely more detection:
switching from Claude Code to Codex or Cursor inside a scope should still
surface the same root + scope project memory, ontology, handoff state, and
operational guardrails without a custom user prompt.

Future hardening will focus on ontology drift reports, mixed-stack
dogfood fixtures, and clearer diagnostics when root-wide exec adapters and
scope-local context diverge.
