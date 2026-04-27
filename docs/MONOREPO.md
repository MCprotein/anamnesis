# Monorepo guide

How to apply anamnesis to a monorepo (multiple apps under one repo).

Available since **v0.2**. UX improvements (interactive init that detects
the layout) are planned for **v0.3** — until then there's a small
hand-edit step.

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
| `project_memory` (AGENTS.md region) | Scope-local: writes to `<scope>/AGENTS.md` |
| `ontology` (slice file) | Scope-local: writes to `<scope>/.anamnesis/ontology/<id>.yaml` |
| `executable_hook` (`.claude/hooks/*.sh`) | **Project-root only** — Claude Code's `settings.json` is read only at root |
| `skill` (`.claude/skills/<name>/`) | **Project-root only** — same reason |
| `slash_command` (`.claude/commands/<name>.md`) | **Project-root only** — same reason |

Implication: scopes are useful for **per-app guidance and ontology**.
Hooks/skills/commands are repo-wide regardless of scope. This matches
how Claude Code itself reads things (nested AGENTS.md auto-loads
per directory; settings.json doesn't).

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

This produces a *single-scope* `Agentfile` with the matched fragments
applied at the root. It does NOT yet split per app.

### 2. Hand-edit `Agentfile` to declare scopes

Open the generated `Agentfile` and rewrite as multi-scope:

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
| `.claude/hooks/*` | repo-wide (root only, regardless of scope) |
| `.claude/commands/load-context.md` | repo-wide |

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
  project. (Per-scope grouping in output is a v0.3 polish item.)
- `cat apps/api/AGENTS.md` should show the inherited + scope-specific
  regions.
- `find . -path '*/.anamnesis/ontology/*.yaml'` lists all ontology
  slices the SessionStart hook will inject.

---

## Common pitfalls

### Don't put per-scope hooks in sub-scope `.claude/hooks/`

CC reads `.claude/settings.json` only at project root. Hooks installed
at `apps/api/.claude/hooks/` won't be auto-registered. Until v0.3 brings
better per-scope adapter support, exec adapters are root-wide; use
fragments at the root scope or the base scope for them.

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

## Roadmap touchpoints (v0.3+)

The hand-edit step in (2) goes away in v0.3 with `init --interactive`,
which detects `apps/*` / `packages/*` / `services/*` patterns and
proposes a multi-scope Agentfile.

`status` will gain per-scope grouping — useful when 5+ scopes drift
independently.
