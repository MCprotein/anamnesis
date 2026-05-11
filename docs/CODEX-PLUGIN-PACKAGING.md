# Codex Plugin Packaging Decision

Status: v1.1 research record.
Date: 2026-05-07.
Local evidence: `codex --version` reported `codex-cli 0.128.0`.

## Decision

anamnesis should not emit a Codex plugin bundle by default in v1.1.

Keep lifecycle automation on the config-layer path already implemented:

- `.codex/config.toml` enables `[features].hooks = true`
- `.codex/hooks.json` registers lifecycle hook commands
- `.anamnesis/codex-native-hooks/*.mjs` contains the generated wrappers
- `--allow-exec-adapters` remains the supply-chain gate for executable output

A future optional plugin surface can package non-runtime user-experience
material such as:

- reusable Codex skills
- example prompts or workflows
- MCP/app metadata if a fragment genuinely needs it
- optional marketplace metadata for discovery

Do not move required context, ontology, handoff, dirty-work reminders, or
hook execution into a Codex plugin until plugin-installed lifecycle hooks are
verified by real Codex CLI smokes.

## Why

The official Codex plugin documentation presents plugins as bundles for
skills, apps, and MCP servers, with more capabilities still evolving. The
plugin build documentation also describes manifest fields for `skills`,
`mcpServers`, `apps`, and `hooks`, including plugin-root path rules.

The official hooks documentation, separately, documents the config-layer hook
shape under `[features].hooks = true` and `hooks.<Event>` entries, with
current lifecycle events and matcher behavior. That path is the one anamnesis
already tests through synthetic dispatch and opt-in real Codex CLI smokes.

There is still public ambiguity around plugin-local hooks. An open upstream
issue reports that plugin examples imply plugin-local `hooks.json` support
while observed runtime behavior only executes config-layer `hooks.json`. That
issue should not be treated as authoritative product documentation, but it is
enough risk to avoid relying on plugin hooks for anamnesis' core continuity
promise without our own real smoke evidence.

## Packaging Boundary

| Surface | v1.1 policy | Rationale |
|---|---|---|
| Context / project memory | Keep in managed `AGENTS.md` and adapter-native memory files | Required every session, must work without plugin install state |
| Ontology and handoff startup | Keep in `AGENTS.md` plus native SessionStart hook when executable adapters are allowed | Core product promise; already test-backed |
| Dirty-work and handoff reminders | Keep in `.codex/hooks.json` wrappers | Hook execution is required behavior, not optional plugin UX |
| Skills | Candidate for optional plugin packaging | Codex skills are first-class and plugin-friendly |
| Slash-command-like workflows | Candidate only as skills or documented prompts | Codex does not share Claude Code's slash-command model exactly |
| MCP/app metadata | Candidate only when a fragment has a real integration need | Avoid shipping broad integration scaffolding with no continuity value |
| Plugin-local hooks | Defer | Needs real Codex CLI proof before use |

## Future Implementation Shape

If plugin packaging becomes useful, add it as an explicit optional command or
adapter mode rather than changing default `init` / `update` behavior.

Candidate command shape:

```bash
anamnesis codex-plugin plan
anamnesis codex-plugin emit --output .agents/plugins/anamnesis
```

The first implementation should emit a reviewable local plugin bundle only:

```text
.agents/plugins/anamnesis/
  .codex-plugin/plugin.json
  skills/
    load-context/SKILL.md
    ontology-enrich/SKILL.md
```

Keep hooks out of that bundle until a real smoke proves plugin-local hook
execution. The plugin output should be advisory/distribution UX, not the only
copy of required continuity state.

## Required Evidence Before Shipping Plugin Hooks

- Fresh local plugin install is detected by Codex CLI.
- Bundled skills are visible and invokable through the plugin surface.
- If `hooks` is emitted, plugin-local lifecycle hooks execute for
  `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`.
- `status` / `doctor` can distinguish plugin-owned entries from
  config-layer anamnesis hooks and explain conflicts.
- Disabling or uninstalling the plugin does not remove the repo-local
  fallback continuity path.

## Sources

- OpenAI Codex plugin overview:
  <https://developers.openai.com/codex/plugins>
- OpenAI Codex plugin build docs:
  <https://developers.openai.com/codex/plugins/build>
- OpenAI Codex hooks docs:
  <https://developers.openai.com/codex/hooks>
- Upstream ambiguity tracked in `openai/codex` issue #16430:
  <https://github.com/openai/codex/issues/16430>
