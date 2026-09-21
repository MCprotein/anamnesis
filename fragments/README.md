# fragments

Stack-specific / concern-specific bundles. Each fragment provides one or more **capabilities** (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`, `task_harness`) and is suggested by a rule in [`../rulebook.md`](../rulebook.md).

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
    ├── codex/              # optional tool-specific sources
    └── cursor/             # optional tool-specific sources
```

## Fragment catalog

| id | rulebook trigger | implemented |
|---|---|---|
| `prisma` | `@prisma/client` in package.json or `prisma/schema.prisma` | ✅ |
| `k8s` | `k8s/` directory | ✅ |
| `nestjs` | `@nestjs/core` in package.json | ✅ |
| `nextjs` | `next` in package.json | ✅ |
| `fastapi` | `fastapi` in pyproject.toml | ✅ |
| `python-uv` | `uv.lock` exists | ✅ |
| `docker-compose` | `docker-compose.yml` or `compose.yaml` | ✅ |
| `rails` | `Gemfile` + `config/application.rb` | ✅ |
| `django` | `django` in `pyproject.toml` or `manage.py` | ✅ |
| `go` | `go.mod` exists | ✅ |
| `rust` | `Cargo.toml` exists | ✅ |
| `sveltekit` | `@sveltejs/kit` in package.json | ✅ |
| `remix` | `@remix-run/node` or `@remix-run/react` in package.json | ✅ |
| `nuxt` | `nuxt` in package.json | ✅ |

Trigger conditions are defined in [`../rulebook.md`](../rulebook.md) — the format spec lives there too.
Public authoring guidance lives in
[`../docs/FRAGMENT-AUTHORING.md`](../docs/FRAGMENT-AUTHORING.md).

Executable or agent-action capabilities (`executable_hook`, `skill`,
`slash_command`) may declare `side_effects` in `fragment.yaml`: `read-only`,
`local-write`, `repo-external-write`, `git-hook`, `network`,
`credential-touching`, or `external-production`. These declarations are
rendered into fallback surfaces and feed later safety diagnostics.

`implemented` means the fragment can install project memory and ontology
snippets. It does not imply deep deterministic ontology bootstrap support.
Built-in Layer A introspectors currently cover the subset documented in
[`../docs/ONTOLOGY-BOOTSTRAP.md`](../docs/ONTOLOGY-BOOTSTRAP.md); deeper
coverage is added when dogfood usage shows that agents need more facts.

## How `init` selects fragments

1. Always include the `base` fragment (from `../base/`) if present.
2. Evaluate every rule in `rulebook.md` against the project. Matching rules select fragment IDs for initialization; `init --dry-run` previews them.
3. Look up each suggested id in this directory. Missing fragments → error.
4. Resolve `requires` dependencies, including optional minimum integer
   versions, then topologically sort. Detect `conflicts` pairs.
5. Render via the adapter for each tool listed in the project's `Agentfile`.

`init` does not ask for confirmation for each match. Review its dry-run before
installation. After initialization, `Agentfile` is editable; later updates
report new matches as suggestions and respect declined entries.
