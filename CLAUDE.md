<!-- anamnesis:region id=anamnesis-claude-code-entrypoint fragment=anamnesis-claude-code@1 -->
## Claude Code entrypoint

This project is managed by anamnesis. `AGENTS.md` is the canonical
cross-agent project memory; Claude Code should read it first and treat
this file as the Claude-specific pointer surface.

### Start here

1. Read `AGENTS.md` for project context, operating rules, and adapter-neutral instructions.
2. Read `.anamnesis/ontology/*.yaml`, `*.bootstrap.yaml`, and
   `*.enriched.yaml` when present.
3. If `.anamnesis/handoff/active.md` exists, read it and the
   referenced archive before continuing work.
4. Use Claude Code native surfaces under `.claude/` for hooks, slash
   commands, and skills when installed.

### Generation boundary

- CLI-generated: `AGENTS.md`, static ontology slices, and `.bootstrap.yaml` facts.
- Agent-required: `/ontology-enrich` for semantic `.enriched.yaml`
  notes and `/handoff-prepare` for task handoff state.
<!-- /anamnesis:region -->
