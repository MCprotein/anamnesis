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
  const file =
    scopePath === "."
      ? opts.settings.claude_md_path
      : path.posix.join(scopePath, opts.settings.claude_md_path);

  return {
    kind: "region",
    file,
    regionId: CLAUDE_MD_REGION_ID,
    fragmentId: "anamnesis-claude-code",
    fragmentVersion: 1,
    content: renderClaudeMdEntrypoint(opts.settings),
  };
}

function renderClaudeMdEntrypoint(settings: AgentfileSettings): string {
  return [
    "## Claude Code entrypoint",
    "",
    "This project is managed by anamnesis. `AGENTS.md` is the canonical",
    "cross-agent project memory; Claude Code should read it first and treat",
    "this file as the Claude-specific pointer surface.",
    "",
    "### Start here",
    "",
    `1. Read \`${settings.agents_md_path}\` for project context, operating rules, and adapter-neutral instructions.`,
    "2. Read `.anamnesis/ontology/*.yaml`, `*.bootstrap.yaml`, and",
    "   `*.enriched.yaml` when present.",
    "3. If `.anamnesis/handoff/active.md` exists, read it and the",
    "   referenced archive before continuing work.",
    "4. Use Claude Code native surfaces under `.claude/` for hooks, slash",
    "   commands, and skills when installed.",
    "",
    "### Generation boundary",
    "",
    "- CLI-generated: `AGENTS.md`, static ontology slices, and `.bootstrap.yaml` facts.",
    "- Agent-required: `/ontology-enrich` for semantic `.enriched.yaml`",
    "  notes and `/handoff-prepare` for task handoff state.",
  ].join("\n");
}
