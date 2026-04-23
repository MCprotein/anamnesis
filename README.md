# anamnesis

> **AI coding agent config lifecycle manager.**
> Keep your AI coding agents from forgetting what your project is.

---

## Status

**v0.1 — in development.** Not yet functional. Design docs only.

This is a private-first build. We're dogfooding on a few personal projects before publishing.

---

## What it is

Every time you open a new project with Claude Code / Codex / Cursor, your agent starts from zero. No context, no conventions, no project-specific rules. So you write a `CLAUDE.md`, an `AGENTS.md`, an ontology file, a few hooks, some slash commands — and you do it again for the next project.

anamnesis manages those files for you: it installs a common baseline, adds stack-specific fragments (prisma, k8s, nestjs, ...), and keeps them synchronized as the project evolves.

**Core idea** — the word *anamnesis* (ἀνάμνησις) means "not forgetting" in Greek; the direct opposite of amnesia. This tool prevents **agent amnesia** — the state where every new session starts without memory of your project.

---

## What it isn't

- **Not a project scaffolder** (cookiecutter, Yeoman) — it doesn't generate source code, `package.json`, Dockerfiles.
- **Not an agent runtime** (OMC, LangGraph) — it doesn't execute agents. It manages files they read.
- **Not a prompt library** — it works on reusable operational artifacts (hooks, ontologies, skills), not on prompts.

---

## Architecture, at a glance

Three layers:

```
content      →  tool-agnostic markdown/YAML (AGENTS.md sections, ontology snippets)
capabilities →  intermediate representation (project_memory, ontology, hook, skill, slash_command)
adapters     →  tool-specific renderers (claude-code, codex, cursor)
```

One source, many targets. A `prisma` fragment's content is written once; the `claude-code` adapter renders real hooks, the `codex` adapter renders AGENTS.md instructions + git pre-commit, the `cursor` adapter renders `.cursor/rules`.

---

## Lifecycle

Three commands:

```bash
anamnesis init      # first-time: detect stacks, suggest fragments, install baseline
anamnesis update    # library updates + project drift detection (dry-run by default)
anamnesis promote   # promote a project-local hook/skill into the library
```

---

## Design docs

- [`docs/DESIGN.md`](docs/DESIGN.md) — full architecture, capabilities, idempotency model
- [`specs/agentfile.md`](specs/agentfile.md) — `Agentfile` manifest schema

---

## Roadmap

| Version | Scope |
|---------|-------|
| **v0.1** | Claude Code adapter only. `init` / `update` / `promote`. 5–7 starter fragments. Internal dogfooding. |
| **v0.2** | Codex adapter (AGENTS.md + git hook fallback). |
| **v0.3** | Cursor adapter (`.cursor/rules/*.mdc` with scope metadata). |
| **v1.0** | Stable schema. Community fragment registry. |

---

## License

MIT — see [LICENSE](LICENSE).
