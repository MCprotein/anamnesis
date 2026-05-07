import type { ToolName } from "../core/agentfile.js";
import type { Capability } from "../core/fragments.js";

export type CapabilityType = Capability["type"];
export type ParityLevel = "native" | "fallback";

export interface AdapterParityCell {
  readonly level: ParityLevel;
  readonly surface: string;
  readonly evidence: readonly string[];
}

export interface AdapterParityRow {
  readonly capability: CapabilityType;
  readonly purpose: string;
  readonly adapters: Record<ToolName, AdapterParityCell>;
}

export const ADAPTER_PARITY_ORDER = [
  "project_memory",
  "ontology",
  "executable_hook",
  "skill",
  "slash_command",
] as const satisfies readonly CapabilityType[];

export const ADAPTER_ORDER = [
  "claude-code",
  "codex",
  "cursor",
] as const satisfies readonly ToolName[];

const ADAPTER_LABELS: Record<ToolName, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

export const ADAPTER_PARITY_MATRIX = [
  {
    capability: "project_memory",
    purpose: "Always-loaded project context and operating rules",
    adapters: {
      "claude-code": {
        level: "native",
        surface: "`AGENTS.md` region plus `CLAUDE.md` entrypoint",
        evidence: ["continuity acceptance", "claude_md renderer"],
      },
      codex: {
        level: "native",
        surface: "`AGENTS.md` region",
        evidence: ["continuity acceptance", "codex registry"],
      },
      cursor: {
        level: "native",
        surface: "`AGENTS.md` region read by Cursor",
        evidence: ["continuity acceptance", "cursor registry"],
      },
    },
  },
  {
    capability: "ontology",
    purpose: "Structured project facts and ontology slices",
    adapters: {
      "claude-code": {
        level: "native",
        surface: "`.anamnesis/ontology/*.yaml` plus SessionStart injection",
        evidence: ["continuity acceptance", "dogfood check"],
      },
      codex: {
        level: "native",
        surface: "`.anamnesis/ontology/*.yaml` plus native SessionStart wrapper when exec adapters are allowed; `AGENTS.md` fallback remains",
        evidence: ["continuity acceptance", "codex native hook tests"],
      },
      cursor: {
        level: "fallback",
        surface: "`.anamnesis/ontology/*.yaml` plus Cursor rules",
        evidence: ["continuity acceptance", "dogfood check"],
      },
    },
  },
  {
    capability: "executable_hook",
    purpose: "Event-triggered automation and operational reminders",
    adapters: {
      "claude-code": {
        level: "native",
        surface: "`.claude/hooks/*.sh` registered in `.claude/settings.json`",
        evidence: ["continuity acceptance", "hook renderer tests"],
      },
      codex: {
        level: "fallback",
        surface: "native wrappers for Codex-supported events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`) where installed; `AGENTS.md` hook region plus optional Git pre-commit bridge remain as fallback",
        evidence: ["codex native hook tests", "event coverage tests", "codex fallback tests"],
      },
      cursor: {
        level: "fallback",
        surface: "`.cursor/rules/*.mdc` instruction fallback",
        evidence: ["cursor MDC tests", "registry coverage"],
      },
    },
  },
  {
    capability: "skill",
    purpose: "Reusable agent procedure",
    adapters: {
      "claude-code": {
        level: "native",
        surface: "`.claude/skills/<name>/SKILL.md`",
        evidence: ["continuity acceptance", "skill renderer tests"],
      },
      codex: {
        level: "fallback",
        surface: "`AGENTS.md` skill region",
        evidence: ["continuity acceptance", "codex fallback tests"],
      },
      cursor: {
        level: "fallback",
        surface: "`.cursor/rules/<name>.mdc`",
        evidence: ["continuity acceptance", "cursor MDC tests"],
      },
    },
  },
  {
    capability: "slash_command",
    purpose: "User-invoked command procedure",
    adapters: {
      "claude-code": {
        level: "native",
        surface: "`.claude/commands/<name>.md`",
        evidence: ["continuity acceptance", "slash command renderer tests"],
      },
      codex: {
        level: "fallback",
        surface: "`AGENTS.md` command region",
        evidence: ["continuity acceptance", "codex fallback tests"],
      },
      cursor: {
        level: "fallback",
        surface: "`.cursor/rules/<name>-cmd.mdc`",
        evidence: ["continuity acceptance", "cursor MDC tests"],
      },
    },
  },
] as const satisfies readonly AdapterParityRow[];

export function formatAdapterParityMarkdown(
  rows: readonly AdapterParityRow[] = ADAPTER_PARITY_MATRIX,
): string {
  return [
    "| Capability | Purpose | Claude Code | Codex | Cursor |",
    "|---|---|---|---|---|",
    ...rows.map((row) =>
      `| ${[
        `\`${row.capability}\``,
        row.purpose,
        ...ADAPTER_ORDER.map((adapter) => formatCell(row.adapters[adapter])),
      ].join(" | ")} |`,
    ),
  ].join("\n");
}

export function adapterLabel(adapter: ToolName): string {
  return ADAPTER_LABELS[adapter];
}

function formatCell(cell: AdapterParityCell): string {
  return `**${cell.level}**<br>${cell.surface}<br>tested: ${cell.evidence.join(", ")}`;
}
