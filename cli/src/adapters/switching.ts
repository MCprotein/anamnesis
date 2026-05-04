import type { ToolName } from "../core/agentfile.js";

export interface SwitchingScenario {
  readonly id: string;
  readonly from: ToolName;
  readonly to: ToolName;
  readonly sourceSurface: string;
  readonly targetSurface: string;
  readonly expectation: string;
}

export const SWITCHING_AGENT_ORDER = [
  "claude-code",
  "codex",
  "cursor",
] as const satisfies readonly ToolName[];

const AGENT_LABELS: Record<ToolName, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

const SOURCE_SURFACES: Record<ToolName, string> = {
  "claude-code": "native `.claude/commands/handoff-prepare.md`",
  codex: "`AGENTS.md` `/handoff-prepare` command region",
  cursor: "`.cursor/rules/handoff-prepare-cmd.mdc` fallback rule",
};

const TARGET_SURFACES: Record<ToolName, string> = {
  "claude-code": "SessionStart `.claude/hooks/inject-handoff.sh`",
  codex: "native `.codex/hooks.json` SessionStart wrapper + `AGENTS.md` fallback",
  cursor: "`AGENTS.md` session-start handoff procedure",
};

export const SWITCHING_SCENARIOS = SWITCHING_AGENT_ORDER.flatMap((from) =>
  SWITCHING_AGENT_ORDER.map((to) => scenario(from, to)),
);

export function formatSwitchingScenariosMarkdown(
  scenarios: readonly SwitchingScenario[] = SWITCHING_SCENARIOS,
): string {
  return [
    "| # | From | To | Prepare surface | Resume surface | Expectation |",
    "|---:|---|---|---|---|---|",
    ...scenarios.map((scenario, index) =>
      `| ${index + 1} | ${agentLabel(scenario.from)} | ${agentLabel(scenario.to)} | ${scenario.sourceSurface} | ${scenario.targetSurface} | ${scenario.expectation} |`,
    ),
  ].join("\n");
}

export function switchingScenarioId(from: ToolName, to: ToolName): string {
  return `${from}->${to}`;
}

export function agentLabel(agent: ToolName): string {
  return AGENT_LABELS[agent];
}

function scenario(from: ToolName, to: ToolName): SwitchingScenario {
  const sameAgent = from === to;
  return {
    id: switchingScenarioId(from, to),
    from,
    to,
    sourceSurface: SOURCE_SURFACES[from],
    targetSurface: TARGET_SURFACES[to],
    expectation: sameAgent
      ? "same-agent restart still resumes from active handoff state"
      : "target agent resumes without a user re-brief",
  };
}
