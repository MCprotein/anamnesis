# base

The **always-installed** fragment. `anamnesis init` auto-includes this regardless of rulebook matches — it carries the bits every project benefits from.

Mechanically it is a regular fragment (declares `fragment.yaml`, has `content/` and `adapters/`). The only distinction is location: it lives at `base/` rather than `fragments/<id>/`, and `init` loads it via `loadBaseFragment()` rather than the rulebook path.

## Contents

```
base/
├── fragment.yaml                # 17 capabilities (covers all 6 types; v22+)
├── content/
│   ├── agents.snippet.md        # AGENTS.md "anamnesis-base" region
│   └── ontology.snippet.yaml    # → .anamnesis/ontology/base.yaml
├── task-harnesses/
│   └── context-continuity.yaml  # → .anamnesis/task-harnesses/context-continuity.yaml
├── adapters/claude-code/
    ├── hooks/
    │   ├── inject-ontology.sh    # SessionStart: cats ontology slices recursively
    │   ├── inject-handoff.sh     # SessionStart: active.md + warm active archive pointers
    │   ├── handoff-reminder.sh   # Stop: deduped dirty-work handoff reminder
    │   ├── work-briefing.sh      # UserPromptSubmit: due Work briefing
    │   ├── work-post-tool-batch.mjs # PostToolBatch: same-turn Work cadence
    │   └── remind-uncommitted.sh # PostToolUse:Edit: nags on dirty git tree
    ├── commands/
    │   ├── load-context.md      # /load-context slash command
    │   └── handoff-prepare.md   # /handoff-prepare — prepare cross-session/agent handoff
    └── skills/
        ├── load-context/
        │   └── SKILL.md         # load-context skill
        ├── ontology-enrich/
        │   └── SKILL.md         # Layer B ontology enrichment + schema/re-run lifecycle skill
        ├── anamnesis-init/
        │   └── SKILL.md         # agent-guided init workflow with docs-choice question
        └── doc-freshness-review/
            └── SKILL.md         # semantic stale-doc review after deterministic diagnostics
└── adapters/codex/
    └── hooks/
        ├── session-start.mjs    # Native Codex SessionStart JSON wrapper
        ├── work-user-prompt.mjs # Native Codex Work prompt JSON wrapper
        └── work-post-tool-use.mjs # Native Codex same-turn Work wrapper
```

## Why every capability type?

The base fragment intentionally exercises all six capabilities
(project_memory, ontology, executable_hook, skill, slash_command,
task_harness). It serves as both the operational baseline and the smoke-test
fixture for
the renderer/adapter pipeline. Adapter outputs differ by tool, but the
base intent is the same: load context/ontology, preserve handoff
continuity, expose a bounded task contract, and remind agents about
operational guardrails. Handoff startup context stays lifecycle-aware:
`Current focus` / `Active tasks` get compact summaries, warm active archive
pointers are exposed for retrieval, and cold/deprecated archives stay out of
SessionStart unless the user explicitly opens them.

## Files installed into a project

When `anamnesis init` runs with `--allow-exec-adapters` against a fresh project:

| Source (this dir) | Destination (project) |
|---|---|
| `content/agents.snippet.md` | `AGENTS.md` (region `anamnesis-base`) |
| `content/ontology.snippet.yaml` | `.anamnesis/ontology/base.yaml` |
| `task-harnesses/context-continuity.yaml` | `.anamnesis/task-harnesses/context-continuity.yaml` |
| `adapters/codex/hooks/session-start.mjs` | `.anamnesis/codex-native-hooks/session-start.mjs` + `.codex/hooks.json` `SessionStart` registration |
| `adapters/codex/hooks/work-user-prompt.mjs` | `.anamnesis/codex-native-hooks/work-user-prompt.mjs` + `.codex/hooks.json` `UserPromptSubmit` registration |
| `adapters/codex/hooks/work-post-tool-use.mjs` | `.anamnesis/codex-native-hooks/work-post-tool-use.mjs` + canonical `.codex/hooks.json` `PostToolUse` registration |
| `adapters/claude-code/hooks/remind-uncommitted.sh` | `.anamnesis/codex-hooks/base-PostToolUse-Edit-remind-uncommitted.sh` + `.anamnesis/codex-native-hooks/base-PostToolUse-Edit-remind-uncommitted.mjs` + `.codex/hooks.json` `PostToolUse` registration |
| `adapters/claude-code/hooks/handoff-reminder.sh` | `.anamnesis/codex-hooks/base-Stop-handoff-reminder.sh` + `.anamnesis/codex-native-hooks/base-Stop-handoff-reminder.mjs` + `.codex/hooks.json` `Stop` registration |
| `adapters/claude-code/hooks/inject-ontology.sh` | `.claude/hooks/inject-ontology.sh` (mode 0o755) |
| `adapters/claude-code/hooks/remind-uncommitted.sh` | `.claude/hooks/remind-uncommitted.sh` (mode 0o755) |
| `adapters/claude-code/hooks/inject-handoff.sh` | `.claude/hooks/inject-handoff.sh` (mode 0o755) |
| `adapters/claude-code/hooks/handoff-reminder.sh` | `.claude/hooks/handoff-reminder.sh` (mode 0o755) |
| `adapters/claude-code/hooks/work-briefing.sh` | `.claude/hooks/work-briefing.sh` (mode 0o755) + `.claude/settings.json` `UserPromptSubmit` registration |
| `adapters/claude-code/hooks/work-post-tool-batch.mjs` | `.claude/hooks/work-post-tool-batch.mjs` (mode 0o755) + matcherless `.claude/settings.json` `PostToolBatch` registration |
| `adapters/claude-code/commands/load-context.md` | `.claude/commands/load-context.md` |
| `adapters/claude-code/commands/handoff-prepare.md` | `.claude/commands/handoff-prepare.md` |
| `adapters/claude-code/skills/load-context/SKILL.md` | `.claude/skills/load-context/SKILL.md` |
| `adapters/claude-code/skills/ontology-enrich/SKILL.md` | `.claude/skills/ontology-enrich/SKILL.md` |
| `adapters/claude-code/skills/anamnesis-init/SKILL.md` | `.claude/skills/anamnesis-init/SKILL.md` |
| `adapters/claude-code/skills/doc-freshness-review/SKILL.md` | `.claude/skills/doc-freshness-review/SKILL.md` |
| `adapters/claude-code/skills/load-context/SKILL.md` | `.codex/skills/load-context/SKILL.md` + `AGENTS.md` fallback region |
| `adapters/claude-code/skills/ontology-enrich/SKILL.md` | `.codex/skills/ontology-enrich/SKILL.md` + `AGENTS.md` fallback region |
| `adapters/claude-code/skills/anamnesis-init/SKILL.md` | `.codex/skills/anamnesis-init/SKILL.md` + `AGENTS.md` fallback region |
| `adapters/claude-code/skills/doc-freshness-review/SKILL.md` | `.codex/skills/doc-freshness-review/SKILL.md` + `AGENTS.md` fallback region |

Without `--allow-exec-adapters`, the AGENTS.md region and ontology file install but native/executable adapter files such as Claude Code hooks/commands/skills, Codex native skills/hooks, and Cursor rules are reported as `blocked` (supply-chain protection).
