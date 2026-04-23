# base

Common baseline installed into **every** project by `anamnesis init`, regardless of stack.

Expected contents (to be populated during v0.1 development):

- `AGENTS.md.tmpl` — canonical project context template
- `content/ontology.yaml.tmpl` — ontology skeleton
- `adapters/claude-code/` — CC-specific baseline
  - `hooks/inject-ontology.sh.tmpl` — SessionStart ontology injection
  - `hooks/remind-uncommitted.sh` — periodic uncommitted-changes reminder
  - `skills/load-context/SKILL.md` — ontology summary skill
  - `commands/load-context.md` — `/load-context` slash command
  - `settings.json.tmpl` — minimal hook registration

See `docs/DESIGN.md` §4.1 and §8.1 for the architecture rationale.
