# Fragment Authoring Guide

Status: v0.9 author guidance. This documents the current built-in fragment
shape and the review bar for future public fragments.

## What a Fragment Is

A fragment is a reusable bundle of agent context for one stack, framework, or
operational concern. It does not scaffold application code. It installs the
material an AI coding agent needs to avoid starting blank:

- always-loaded project memory
- static ontology slices
- optional deterministic Layer A bootstrap support
- optional skills or slash-command procedures
- optional executable adapter surfaces
- optional task harnesses for reusable task contracts

Good fragments help agents continue work with less re-briefing. They should
encode stable project rules and known failure modes, not broad tutorials.

## When to Add One

Add a fragment when at least one of these is true:

- The stack has conventions agents repeatedly rediscover incorrectly.
- A small ontology slice would make project structure clearer across sessions.
- There is a recurring verification command or hook that prevents common
  mistakes.
- Dogfood or benchmark evidence shows missing context slows or derails agent
  continuity.

Do not add a fragment just because a framework exists. If the guidance is
generic, starts sounding like documentation copied from the framework website,
or has no clear continuity benefit, keep it out of the library.

## Directory Layout

```text
fragments/<id>/
  fragment.yaml
  README.md
  content/
    agents.snippet.md
    ontology.snippet.yaml
  adapters/
    claude-code/
      hooks/
      commands/
      skills/
    codex/
    cursor/
  task-harnesses/
  .versions/
    <old-version>/
      fragment.yaml
      content/
      adapters/
```

Only `fragment.yaml` is mandatory, but most useful fragments include at least
`content/agents.snippet.md` and `content/ontology.snippet.yaml`.

## `fragment.yaml`

Example:

```yaml
id: prisma
version: 2
description: >
  Prisma ORM operational guidelines and schema drift checks.
requires:
  - base
  - id: runtime
    min_version: 2
conflicts: []
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: prisma

  - type: ontology
    source: content/ontology.snippet.yaml

  - type: executable_hook
    event: PostToolUse:Edit
    source: adapters/claude-code/hooks/prisma-validate.sh
    adapters_supported: [claude-code, codex]
owns:
  - region: prisma in AGENTS.md
  - file: .anamnesis/ontology/prisma.yaml
  - file: .claude/hooks/prisma-validate.sh
```

Rules:

- `id` must match the directory name.
- `version` is a positive integer. Increment it when generated output should
  change for existing projects.
- `requires` lists fragment ids that must render first. Use plain strings for
  id-only dependencies, or `{ id, min_version }` when a dependency needs at
  least a specific integer fragment version.
- `conflicts` lists fragment ids that should not be selected together without
  a user decision.
- `capabilities` describe what the fragment provides.
- `owns` documents managed regions/files for reviewers and future repair
  workflows.
- Detection triggers do not live in `fragment.yaml`; they live in
  `rulebook.md`.

## Capability Types

| Capability | Required fields | Purpose |
|---|---|---|
| `project_memory` | `source`, `region` | Inserts always-loaded guidance into `AGENTS.md`. |
| `ontology` | `source` | Writes `.anamnesis/ontology/<id>.yaml`. |
| `executable_hook` | `event`, `source`, optional `adapters_supported` | Renders hook automation for adapters that support it. |
| `skill` | `name`, `source` | Provides a reusable procedure. Native in Claude Code, fallback elsewhere. |
| `slash_command` | `name`, `source` | Provides a user-invoked command. Native in Claude Code, fallback elsewhere. |
| `task_harness` | `name`, `source`, optional `lifecycle`, optional `adapters_supported` | Provides a repo-local task contract under `.anamnesis/task-harnesses/<name>.yaml`. It is indexed for retrieval, not injected wholesale into startup context. |

Use `adapters_supported` only when a capability cannot render safely or
meaningfully for every enabled adapter. `fragment.adapters` in Agentfile can
disable a whole fragment per tool later, but the capability should still
declare hard renderer limits.

## Task Harnesses

`task_harness` sources should be short YAML files using
`schema_version: "anamnesis.task_harness.v1"`. They describe a task contract:
goal, stop condition, read/write scope, forbidden actions, required evidence,
test commands, rubric, and lifecycle metadata.

Fragments should normally ship reusable harness templates:

```yaml
- type: task_harness
  name: context-continuity
  source: task-harnesses/context-continuity.yaml
  lifecycle: reusable
```

Lifecycle rules:

- `current` harnesses are one-task artifacts. They should leave active startup
  context when the task is done and should be deleted or archived under bounded
  retention.
- `reusable` harnesses are templates. They may remain on disk, but should carry
  metadata such as `last_used`, `use_count`, `deprecated`, and `superseded_by`
  when project-local lifecycle tooling updates them.
- Harness bodies should stay out of SessionStart injection by default. Agents
  should retrieve a matched harness via source pointer or `anamnesis context
  query --kind task-harness`.
- Cleanup must be preview-first. Stale or superseded harnesses belong in a
  `anamnesis gc --dry-run` report before deletion. The current preview command
  separates managed delete candidates from user-authored review candidates and
  reports stale current harnesses, deprecated/superseded reusable harnesses,
  count pressure, and disk-budget pressure.

## Project Memory Snippet

`content/agents.snippet.md` should be short and operational.

Prefer:

- project or framework invariants
- commands the agent should run before claiming completion
- files the agent should inspect first
- common mistakes and their remedies
- boundaries between CLI-generated and agent-generated context

Avoid:

- marketing copy
- long framework introductions
- advice that applies to every project
- instructions that contradict the top-level `AGENTS.md` contract

## Ontology Snippet

`content/ontology.snippet.yaml` should be static, factual, and reusable.

Use it for:

- entity types the stack usually introduces
- important files and identifiers
- stable relationships
- invariants that future agents should not guess

Do not put project-specific facts here. Project-specific facts belong in
Layer A `.bootstrap.yaml` output or Layer B `.enriched.yaml` semantics.

## Layer A Introspectors

A fragment does not need an introspector to be useful. Add deterministic
Layer A support only when there are facts the CLI can prove from files without
executing project code.

Good Layer A facts:

- Prisma model names and datasource provider from `schema.prisma`
- NestJS module/controller/provider relationships from source files
- Kubernetes workloads, services, ingress hosts, and namespaces from YAML

Bad Layer A facts:

- guessed business intent
- inferred deployment policy without evidence
- runtime state that requires credentials or network access

Layer B enrichment is the place for relationships, flows, intent, and open
questions an agent can infer with evidence.

## Rulebook Entry

Add one rule to `rulebook.md` when the fragment should be suggested by
`init` or `status`.

```markdown
## prisma
- trigger: `any: [package_json_has: "@prisma/client", file_exists: prisma/schema.prisma]`
- suggest: fragments/prisma
- reason: Prisma schema drift is a frequent source of deploy failures; dedicated validation hook recommended.
```

Rules:

- Triggers must be cheap and deterministic.
- Do not execute project code.
- Prefer specific triggers over broad file-content scans.
- Explain user value in `reason`, not just "framework detected".
- Add a rulebook test if the trigger shape is non-trivial.

## Executable Hooks

Executable hooks carry supply-chain risk and need stricter review.

Rules:

- Keep scripts small and auditable.
- Do not download dependencies.
- Do not read secrets unless the user explicitly configured that hook.
- Do not mutate project files unless the hook's name and docs make that clear.
- Prefer validation and reminders over automatic fixes.
- Make generated hook paths explicit in `owns`.
- Remember that `.claude` executable surfaces require
  `--allow-exec-adapters`.

Remote executable fragments have additional policy in
[`docs/FRAGMENT-SIGNING.md`](FRAGMENT-SIGNING.md).

## Creating a Fragment

Use `promote` when you already have a project-local file that should become a
fragment capability:

```bash
anamnesis promote .claude/hooks/prisma-validate.sh \
  --as prisma \
  --type executable_hook \
  --description "Prisma schema drift validation"
```

Manual creation is also fine:

1. Create `fragments/<id>/fragment.yaml`.
2. Add `content/agents.snippet.md`.
3. Add `content/ontology.snippet.yaml`.
4. Add adapter files only when needed.
5. Add a `rulebook.md` trigger.
6. Add or update tests.
7. Dry-run `init` or `update` against a fixture.

## Versioning

Increment the fragment version when:

- generated `AGENTS.md` region content changes
- ontology snippet output changes
- adapter paths or hook behavior changes
- capability lists change
- `requires` or `conflicts` changes

Archive the previous version under `.versions/<old-version>/` when existing
projects may still be pinned to it.

Do not increment the version for README-only or comment-only changes that do
not affect rendered output.

## Tests and Verification

Minimum checks for a new or changed fragment:

```bash
npm run typecheck
npm test
npm run release:check
```

Targeted checks should cover:

- `fragment.yaml` parses with `loadFragment`
- rulebook trigger matches a positive fixture and skips a negative fixture
- `init --dry-run` suggests the fragment on a matching fixture
- `init --tools all` renders expected native or fallback surfaces
- `doctor` reports no errors after install
- executable hook rendering is gated by `--allow-exec-adapters`
- ontology gap output is useful when Layer A or Layer B is missing

For broad claims, add dogfood or benchmark evidence instead of relying only on
unit tests.

## Review Checklist

Before merging a public fragment:

- The fragment improves agent continuity, not just catalog breadth.
- `agents.snippet.md` is concise and operational.
- `ontology.snippet.yaml` contains stable facts, not guessed project state.
- Rulebook triggers are deterministic and specific.
- Every executable file has a clear reason and safety boundary.
- Adapter behavior is documented when native UX differs by tool.
- Version bump and `.versions/` archival are correct.
- README/docs mention any non-obvious limitations.
- Tests prove install, update, status, and doctor behavior.
- No remote-registry assumption bypasses checksum/signature policy.

## Compatibility Rules

- Fragment ids should be lowercase kebab-case.
- Do not rename a fragment id after publication; create a new fragment and a
  migration note.
- Do not remove a capability in a minor update without documenting the reason.
- Keep generated region ids stable.
- Keep ontology schema fields stable and append new facts instead of rewriting
  reviewed semantic content.
- Prefer additive changes until v1.0 freezes the public surface.

## Common Mistakes

- Putting detection triggers in `fragment.yaml` instead of `rulebook.md`.
- Adding an introspector for facts that belong in Layer B enrichment.
- Writing broad "how to use framework X" prose instead of project-operational
  guardrails.
- Forgetting Codex/Cursor fallback surfaces when adding Claude Code-native
  commands or skills.
- Treating `--allow-exec-adapters` as a signature or trust mechanism. It is
  only an execution-surface permission gate.
