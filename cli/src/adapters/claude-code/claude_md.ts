// Claude Code adapter — CLAUDE.md entrypoint.
//
// AGENTS.md remains the canonical, cross-agent memory surface. CLAUDE.md is a
// Claude Code-native entrypoint that points Claude Code back to that canonical
// context plus the managed ontology and handoff locations.

import * as path from "node:path";
import type { AgentfileSettings, RegionAction } from "../../core/render.js";

export const CLAUDE_MD_REGION_ID = "anamnesis-claude-code-entrypoint";

export function planClaudeMdEntrypoint(opts: {
  scopePath: string;
  settings: AgentfileSettings;
}): RegionAction {
  const scopePath = opts.scopePath || ".";
  const scoped = (file: string) =>
    scopePath === "." ? file : path.posix.join(scopePath, file);
  const file = scoped(opts.settings.claude_md_path);
  // Claude Code does not load AGENTS.md when a CLAUDE.md exists, and a prose
  // "read AGENTS.md" pointer is only followed when the model decides to open
  // it. An `@` import (relative to this CLAUDE.md) always loads it.
  const agentsFile = scoped(opts.settings.agents_md_path);
  const agentsImport =
    agentsFile === file
      ? null
      : path.posix.relative(path.posix.dirname(file), agentsFile);

  return {
    kind: "region",
    file,
    regionId: CLAUDE_MD_REGION_ID,
    fragmentId: "anamnesis-claude-code",
    fragmentVersion: 2,
    content: renderClaudeMdEntrypoint(agentsImport),
  };
}

function renderClaudeMdEntrypoint(agentsImport: string | null): string {
  const intro =
    agentsImport === null
      ? [
          "This project is managed by anamnesis. This file is also the",
          "canonical cross-agent project memory; this region adds the Claude",
          "Code specifics.",
        ]
      : [
          `@${agentsImport}`,
          "",
          `This project is managed by anamnesis. The import above loads \`${agentsImport}\`,`,
          "the canonical cross-agent project memory; this region adds the Claude",
          "Code specifics.",
        ];
  return [
    "## Claude Code entrypoint",
    "",
    ...intro,
    "",
    "### Claude Code context",
    "",
    "- SessionStart hooks inject a compact ontology digest and, when a handoff",
    "  exists, the active handoff summary, each with source pointers. The",
    "  pointed-to ontology slices and handoff files (the active index plus warm",
    "  archives referenced by `Current focus` / `Active tasks`) hold the exact",
    "  content when a task depends on it. `Recently completed` and",
    "  closed/cold/deprecated/superseded archives are history, not startup context.",
    "- `anamnesis context query \"<terms>\"` finds source pointers for project",
    "  docs, roadmap items, prior decisions, and ontology evidence that is not",
    "  already loaded. Its snippets are location hints; the returned",
    "  `source_path` / `stable_ref` is the source to read before relying on a fact.",
    "- Claude Code runs the anamnesis hooks, slash commands, and skills",
    "  natively from `.claude/`. The `codex-*` sections of the project memory",
    "  and the manuals under `.anamnesis/codex-instructions/` are fallbacks",
    "  for Codex only.",
    "",
    "### Generation boundary",
    "",
    "- CLI-generated: `AGENTS.md`, static ontology slices, and `.bootstrap.yaml` facts.",
    "- Agent-required: `/ontology-enrich` for semantic `.enriched.yaml`",
    "  notes and `/handoff-prepare` for task handoff state.",
  ].join("\n");
}
