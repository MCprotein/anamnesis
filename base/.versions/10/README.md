# base

The **always-installed** fragment. `anamnesis init` auto-includes this regardless of rulebook matches — it carries the bits every project benefits from.

Mechanically it is a regular fragment (declares `fragment.yaml`, has `content/` and `adapters/`). The only distinction is location: it lives at `base/` rather than `fragments/<id>/`, and `init` loads it via `loadBaseFragment()` rather than the rulebook path.

## Contents

```
base/
├── fragment.yaml                # 10 capabilities (covers all 5 types; v10+)
├── content/
│   ├── agents.snippet.md        # AGENTS.md "anamnesis-base" region
│   └── ontology.snippet.yaml    # → .anamnesis/ontology/base.yaml
├── adapters/claude-code/
    ├── hooks/
    │   ├── inject-ontology.sh    # SessionStart: cats ontology slices recursively
    │   ├── inject-handoff.sh     # SessionStart: cats active.md + recent handoff archive
    │   ├── handoff-reminder.sh   # Stop: reminds when dirty work is newer than handoff
    │   └── remind-uncommitted.sh # PostToolUse:Edit: nags on dirty git tree
    ├── commands/
    │   ├── load-context.md      # /load-context slash command
    │   └── handoff-prepare.md   # /handoff-prepare — prepare cross-session/agent handoff
    └── skills/
        ├── load-context/
        │   └── SKILL.md         # load-context skill
        └── ontology-enrich/
            └── SKILL.md         # Layer B ontology enrichment + schema/re-run lifecycle skill
└── adapters/codex/
    └── hooks/
        └── session-start.mjs    # Native Codex SessionStart JSON wrapper
```

## Why every capability type?

The base fragment intentionally exercises all five capabilities
(project_memory, ontology, executable_hook, skill, slash_command). It
serves as both the operational baseline and the smoke-test fixture for
the renderer/adapter pipeline. Adapter outputs differ by tool, but the
base intent is the same: load context/ontology, preserve handoff
continuity, and remind agents about operational guardrails.

## Files installed into a project

When `anamnesis init` runs with `--allow-exec-adapters` against a fresh project:

| Source (this dir) | Destination (project) |
|---|---|
| `content/agents.snippet.md` | `AGENTS.md` (region `anamnesis-base`) |
| `content/ontology.snippet.yaml` | `.anamnesis/ontology/base.yaml` |
| `adapters/codex/hooks/session-start.mjs` | `.anamnesis/codex-native-hooks/session-start.mjs` + `.codex/hooks.json` `SessionStart` registration |
| `adapters/claude-code/hooks/remind-uncommitted.sh` | `.anamnesis/codex-hooks/base-PostToolUse-Edit-remind-uncommitted.sh` + `.anamnesis/codex-native-hooks/base-PostToolUse-Edit-remind-uncommitted.mjs` + `.codex/hooks.json` `PostToolUse` registration |
| `adapters/claude-code/hooks/handoff-reminder.sh` | `.anamnesis/codex-hooks/base-Stop-handoff-reminder.sh` + `.anamnesis/codex-native-hooks/base-Stop-handoff-reminder.mjs` + `.codex/hooks.json` `Stop` registration |
| `adapters/claude-code/hooks/inject-ontology.sh` | `.claude/hooks/inject-ontology.sh` (mode 0o755) |
| `adapters/claude-code/hooks/remind-uncommitted.sh` | `.claude/hooks/remind-uncommitted.sh` (mode 0o755) |
| `adapters/claude-code/hooks/inject-handoff.sh` | `.claude/hooks/inject-handoff.sh` (mode 0o755) |
| `adapters/claude-code/hooks/handoff-reminder.sh` | `.claude/hooks/handoff-reminder.sh` (mode 0o755) |
| `adapters/claude-code/commands/load-context.md` | `.claude/commands/load-context.md` |
| `adapters/claude-code/commands/handoff-prepare.md` | `.claude/commands/handoff-prepare.md` |
| `adapters/claude-code/skills/load-context/SKILL.md` | `.claude/skills/load-context/SKILL.md` |
| `adapters/claude-code/skills/ontology-enrich/SKILL.md` | `.claude/skills/ontology-enrich/SKILL.md` |

Without `--allow-exec-adapters`, the AGENTS.md region and ontology file install but native/executable adapter files such as Claude Code hooks/commands/skills, Cursor rules, and Codex native hook wrappers are reported as `blocked` (supply-chain protection).
