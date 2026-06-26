# Contributing to anamnesis

Thanks for considering it. v0.1 is daily-use alpha — feedback, fragment contributions, and adapter ideas are all welcome.

This document covers the most common path: **adding or extending a fragment**. Tooling-internals contributions follow standard Node/TypeScript practices (tests required, `npm run typecheck` clean, prefer focused PRs).

---

## Adding a fragment

A fragment is a directory under `fragments/<id>/` describing one stack or concern. Minimal example:

```
fragments/my-stack/
├── fragment.yaml
└── content/
    └── agents.snippet.md
```

### `fragment.yaml`

```yaml
id: my-stack             # MUST match the directory name
version: 1               # bump when content changes meaningfully
description: One-line summary of what this fragment is about.

capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: my-stack     # the AGENTS.md region id this content lives in

  # Optional: structured ontology slice
  - type: ontology
    source: content/ontology.snippet.yaml

  # Optional: hook script (only on Claude Code in v0.1)
  - type: executable_hook
    event: PostToolUse:Edit
    source: adapters/claude-code/hooks/my-validate.sh
    adapters_supported: [claude-code]

  # Optional: reusable task contract
  - type: task_harness
    name: context-continuity
    source: task-harnesses/context-continuity.yaml
    lifecycle: reusable

owns:                    # for reference / future cleanup tooling
  - region: my-stack in AGENTS.md
  - file: .anamnesis/ontology/my-stack.yaml
  - file: .anamnesis/task-harnesses/context-continuity.yaml
```

### Capability types

| Type | Purpose | Source path |
|---|---|---|
| `project_memory` | Free-form text inserted into AGENTS.md region | a markdown file |
| `ontology` | Structured YAML slice (rendered to `.anamnesis/ontology/<id>.yaml`) | a yaml file |
| `executable_hook` | Shell script run on a Claude Code event | a shell script (mode 0755 set by adapter) |
| `slash_command` | A markdown file → `.claude/commands/<name>.md` | markdown |
| `skill` | Directory with `SKILL.md` (+ optional refs) → `.claude/skills/<name>/` | a directory |
| `task_harness` | Reusable task contract rendered to `.anamnesis/task-harnesses/<name>.yaml` and indexed for retrieval | yaml |

### Trigger (rulebook)

To make `init` suggest your fragment automatically, add a rule to [`rulebook.md`](rulebook.md):

```markdown
## my-stack
- trigger: `file_exists: my-stack-marker.toml`
- suggest: fragments/my-stack
- reason: short one-liner.
```

Trigger DSL atoms:

| Expression | Matches when |
|---|---|
| `package_json_has: <dep>` | `package.json` has `<dep>` in any deps section |
| `pyproject_has: <substring>` | `pyproject.toml` contains the substring |
| `file_exists: <path>` | File exists at the given project-relative path |
| `dir_exists: <path>` | Directory exists |
| `any_yaml_contains: <substring>` | At least one `*.yaml`/`*.yml` in the project contains it |

Combinators: `any: [<expr>, …]`, `all: [<expr>, …]`. Triggers are *suggestions only* — the user always has to confirm via `init` (or by adding the fragment id to `Agentfile.fragments`).

### Style notes

- Keep `agents.snippet.md` tight — it lands in every project's AGENTS.md. Operational rules and forbidden patterns travel well; opinions don't.
- Ontology slices are most useful for **forbidden patterns** and **preferred workflows** in structured form (so the agent can grep its own memory).
- Hooks should be **fast** (< 100ms typical) and **silent on success**. Print to stderr only on failure.
- Avoid project-specific identifiers (hostnames, IPs, user paths). Use placeholders (`<your-host>`, `${HOME}`) so the fragment ports cleanly.

### Promotion shortcut

If you've already authored a hook/skill/command/ontology/task harness in a project, you don't need to write `fragment.yaml` by hand:

```bash
anamnesis promote .claude/hooks/my-validate.sh --as=my-stack
```

This creates or extends `fragments/my-stack/` with the appropriate capability and `fragment.yaml` entry. You can then edit by hand, add a rule, and PR.

---

## Running the test suite

```bash
npm install
npm run typecheck
npm test          # vitest, ~1s
```

229 tests as of v0.1. Each new core change should add a test; new fragments don't need TypeScript tests but should be exercised via dry-run on a sanitized fixture.

---

## Submitting

- Fork → branch → PR.
- Keep commits focused. Korean or English commit messages are both fine.
- For new fragments: include the rulebook entry in the same PR.
- For core changes: add tests and update [`CHANGELOG.md`](CHANGELOG.md).

---

## Scope guard

Things this project deliberately does *not* do:

- Generate source code, `package.json`, Dockerfiles, or other project scaffolding.
- Run agents or orchestrate multi-agent workflows.
- Maintain a curated prompt library.

PRs in those directions will be politely redirected.

---

## License

By contributing, you agree your contributions are licensed under [MIT](LICENSE).
