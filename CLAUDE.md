<!-- anamnesis:region id=anamnesis-claude-code-entrypoint fragment=anamnesis-claude-code@2 -->
## Claude Code entrypoint

@AGENTS.md

This project is managed by anamnesis. The import above loads `AGENTS.md`,
the canonical cross-agent project memory; this region adds the Claude
Code specifics.

### Claude Code context

- SessionStart hooks inject a compact ontology digest and, when a handoff
  exists, the active handoff summary, each with source pointers. The
  pointed-to ontology slices and handoff files (the active index plus warm
  archives referenced by `Current focus` / `Active tasks`) hold the exact
  content when a task depends on it. `Recently completed` and
  closed/cold/deprecated/superseded archives are history, not startup context.
- `anamnesis context query "<terms>"` finds source pointers for project
  docs, roadmap items, prior decisions, and ontology evidence that is not
  already loaded. Its snippets are location hints; the returned
  `source_path` / `stable_ref` is the source to read before relying on a fact.
- Hooks, slash commands, and skills live under `.claude/`.

### Generation boundary

- CLI-generated: `AGENTS.md`, static ontology slices, and `.bootstrap.yaml` facts.
- Agent-required: `/ontology-enrich` for semantic `.enriched.yaml`
  notes and `/handoff-prepare` for task handoff state.
<!-- /anamnesis:region -->
