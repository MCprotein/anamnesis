# fragments

Stack-specific / concern-specific bundles. Each fragment provides one or more **capabilities** (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`) and is suggested by a rule in [`../rulebook.md`](../rulebook.md).

The always-installed baseline lives at [`../base/`](../base/), not here.

## Layout

```
fragments/<id>/
├── fragment.yaml           # metadata (id, version, requires, conflicts, capabilities, owns)
├── content/                # tool-agnostic
│   ├── agents.snippet.md   # → AGENTS.md region
│   └── ontology.snippet.yaml  # → .anamnesis/ontology/<id>.yaml
└── adapters/
    ├── claude-code/
    ├── codex/              # v0.2+
    └── cursor/             # v0.3+
```

## v0.1 fragments

| id | rulebook trigger | implemented |
|---|---|---|
| `prisma` | `@prisma/client` in package.json or `prisma/schema.prisma` | ✅ |
| `k8s` | `k8s/` directory or YAML with `apiVersion:` | — |
| `nestjs` | `@nestjs/core` in package.json | — |
| `nextjs` | `next` in package.json | — |
| `fastapi` | `fastapi` in pyproject.toml | — |
| `python-uv` | `uv.lock` exists | — |
| `docker-compose` | `docker-compose.yml` or `compose.yaml` | — |

`prisma` is implemented as the v0.1 reference; the rest are stubs added in subsequent rounds. Trigger conditions are defined in [`../rulebook.md`](../rulebook.md) — the format spec lives there too.

## How `init` selects fragments

1. Always include the `base` fragment (from `../base/`) if present.
2. Evaluate every rule in `rulebook.md` against the project. Rules that match → suggest a fragment id.
3. Look up each suggested id in this directory. Missing fragments → error.
4. Topologically sort by `requires`. Detect `conflicts` pairs.
5. Render via the adapter for each tool listed in the project's `Agentfile`.

The user has the final say — `Agentfile` is editable, and `init` will be made interactive in a later round so suggestions can be accepted/rejected per-fragment.
