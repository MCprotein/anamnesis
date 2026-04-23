# fragments

Stack-specific / concern-specific bundles. Each fragment provides one or more **capabilities** (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`) and optional tool adapters.

## Layout

```
fragments/<id>/
├── fragment.yaml           # metadata (id, version, triggers, requires, capabilities)
├── content/                # tool-agnostic
│   ├── agents.snippet.md   # merged into AGENTS.md region
│   └── ontology.snippet.yaml
└── adapters/
    ├── claude-code/
    ├── codex/
    └── cursor/             # v0.2+
```

See `specs/fragment.md` (to be written) for the full `fragment.yaml` schema, and `docs/DESIGN.md` §4.3 for the data model.

## v0.1 target fragments

| id | stack trigger | priority |
|---|---|---|
| `prisma` | `@prisma/client` | high |
| `k8s` | `k8s/` directory | high |
| `nestjs` | `@nestjs/core` | high |
| `nextjs` | `next` | medium |
| `fastapi` | `pyproject.toml: fastapi` | medium |
| `python-uv` | `uv.lock` | medium |
| `docker-compose` | `docker-compose.yml` | low |

Rules that trigger each fragment are declared in [`rulebook.md`](../rulebook.md).
