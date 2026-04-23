# rulebook

> Auto-detection rules that suggest fragments. `anamnesis init` runs these against the current project and proposes matching fragments.
> **Suggestions only** — fragments are never installed without explicit user confirmation.

Each rule has:
- **Trigger**: a detection condition (file existence, dependency presence, etc.)
- **Suggest**: the fragment id to propose
- **Reason**: why this suggestion makes sense (shown to user during init)

---

## Format (v0.1 draft)

A rule block:

```
## <rule-id>
- trigger: <condition expression>
- suggest: fragments/<id>
- reason: <human-readable rationale>
```

Supported trigger expressions (v0.1):

| Expression | Matches when |
|---|---|
| `package_json_has: <dep>` | `package.json` has `<dep>` in any `dependencies` section |
| `file_exists: <path>` | File exists at the given path (glob allowed) |
| `dir_exists: <path>` | Directory exists |
| `pyproject_has: <dep>` | `pyproject.toml` declares `<dep>` |
| `any_yaml_contains: <string>` | Any `*.yaml`/`*.yml` in the project contains the string |
| `all: [<expr>, <expr>]` | All sub-expressions match |
| `any: [<expr>, <expr>]` | At least one sub-expression matches |

---

## Rules

<!-- Initial rules; expand as fragments are added. -->

## prisma
- trigger: `any: [package_json_has: "@prisma/client", file_exists: prisma/schema.prisma]`
- suggest: fragments/prisma
- reason: Prisma schema drift is a frequent source of deploy failures; dedicated validation hook recommended.

## k8s
- trigger: `any: [dir_exists: k8s, any_yaml_contains: "apiVersion"]`
- suggest: fragments/k8s
- reason: Kubernetes manifests benefit from YAML linting and post-apply verification hooks.

## nestjs
- trigger: `package_json_has: "@nestjs/core"`
- suggest: fragments/nestjs
- reason: NestJS conventions (module/service/controller layering) are worth codifying for the agent.

## nextjs
- trigger: `package_json_has: next`
- suggest: fragments/nextjs
- reason: App-router vs pages-router conventions + build/lint automation worth capturing.

## fastapi
- trigger: `pyproject_has: fastapi`
- suggest: fragments/fastapi
- reason: Pydantic schemas + dependency injection patterns are reusable across projects.

## python-uv
- trigger: `file_exists: uv.lock`
- suggest: fragments/python-uv
- reason: `uv` workflow differs from pip/poetry; agent should prefer `uv run` / `uv sync`.

## docker-compose
- trigger: `any: [file_exists: docker-compose.yml, file_exists: compose.yaml]`
- suggest: fragments/docker-compose
- reason: Standard up/down/logs helpers + healthcheck conventions.
