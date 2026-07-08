export function formatGettingStartedGuide(version: string): string {
  return `anamnesis ${version} — AI coding agent config lifecycle manager

Get started:
  Preview first-time project adoption:
    anamnesis init --dry-run

  Install Claude Code + Codex + Cursor surfaces:
    anamnesis init --tools all --allow-exec-adapters

  Verify the project after install:
    anamnesis doctor
    anamnesis status

Already using anamnesis:
  Preview/apply project updates:
    anamnesis update --dry-run --allow-exec-adapters
    anamnesis update --apply --allow-exec-adapters

  Plan CLI + project upgrade work:
    anamnesis upgrade plan

Agent follow-ups:
  /ontology-enrich       add semantic relationships, flows, intent, and rules
  /handoff-prepare       capture in-flight work before switching agents

More:
  anamnesis --help       full command reference
  anamnesis --version    installed CLI version

Docs: https://github.com/MCprotein/anamnesis`;
}
