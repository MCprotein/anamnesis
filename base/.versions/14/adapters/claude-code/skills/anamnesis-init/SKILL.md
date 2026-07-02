---
name: anamnesis-init
description: |
  Guide first-time anamnesis adoption for a project. Use when the user asks an
  agent to initialize/install/apply anamnesis, especially when README/docs
  scaffolding or enhancement should be chosen by the user before running the
  CLI.
---

# anamnesis-init

Use this skill when the user asks the agent to initialize a project with
anamnesis, install anamnesis surfaces, or "run init" on their behalf.

`anamnesis init` is a CLI command, not a skill. This skill is the agent-facing
adoption workflow that decides which CLI flags to use.

## Required Question

Before running `anamnesis init`, ask exactly one multiple-choice question unless
the user already gave an explicit docs preference such as "don't touch README",
"create docs", "enhance existing docs", `--scaffold-docs`, or `--enhance-docs`.

Question:

```text
README/docs 처리 방식을 선택해줘.
```

Choices:

```text
1. 문서 건드리지 않음 (Recommended) - AGENTS/CLAUDE/context/ontology만 설치하고 README/docs는 그대로 둠.
2. 누락 문서만 생성 - README.md와 docs/PROJECT-CONTEXT.md가 없을 때만 생성함. 기존 문서는 그대로 둠.
3. 기존 문서도 보완 - 기존 README/docs에 anamnesis 관리 region을 추가하거나 갱신하고, 누락 문서도 생성함.
```

If the agent runtime has a native multiple-choice question UI, use it. If not,
ask the same numbered question in plain text and wait for the user's answer.

## Map Answer To CLI Flags

- Choice 1: no docs flag.
- Choice 2: add `--scaffold-docs`.
- Choice 3: add `--enhance-docs`.

Do not use both docs flags. `--enhance-docs` already covers missing docs plus
existing-doc enhancement.

## Execution

1. Determine the target project root. Use the current working directory unless
   the user gave a path.
2. Run `anamnesis init --dry-run` first with the selected docs flag and any
   user-requested tool flags.
3. Review the dry-run output for blocked executable adapter writes, existing
   `Agentfile`, or unexpected user-owned document changes.
4. If the user already asked you to perform the install, run the apply command
   after dry-run succeeds:
   - Add `--allow-exec-adapters` when the user requested native hooks,
     commands, skills, Codex hooks, Cursor rules, or `--tools all`.
   - Preserve any user-supplied `--tools`, `--project-root`, `--library`,
     `--monorepo`, `--no-bootstrap`, or `--no-context-bootstrap` flags.
5. Report the docs choice, generated context files, and any follow-up agent
   work such as `/ontology-enrich`.

## Safety

- Never modify README/docs without either the user's explicit preference or the
  multiple-choice answer above.
- Never invent project facts. Starter docs and zero-context ontology drafts
  should contain open questions and review checklists until evidence exists.
- If `Agentfile` already exists, stop the init path and use
  `anamnesis update --dry-run` instead.
