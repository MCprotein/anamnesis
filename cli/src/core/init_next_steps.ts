const ALL_AGENT_TOOLS = ["claude-code", "codex", "cursor"] as const;

export interface InitNextStepInput {
  writtenToDisk: boolean;
  blockedWrites: number;
  tools: readonly string[];
  execAdaptersEnabled: boolean;
}

export function formatInitNextStepLines(input: InitNextStepInput): string[] {
  const allToolsSelected = ALL_AGENT_TOOLS.every((tool) =>
    input.tools.includes(tool),
  );
  const installCommand = allToolsSelected
    ? "anamnesis init --tools all --allow-exec-adapters"
    : "anamnesis init --allow-exec-adapters";

  const lines = ["  next steps:"];
  if (input.writtenToDisk) {
    lines.push("    verify install: anamnesis doctor");
    lines.push("    inspect status: anamnesis status");
  } else {
    lines.push(`    apply reviewed plan: ${installCommand}`);
  }

  if (input.blockedWrites > 0) {
    lines.push(
      "    blocked executable surfaces: re-run with --allow-exec-adapters after reviewing hooks/commands/skills",
    );
  } else if (!allToolsSelected) {
    lines.push(
      "    all agent surfaces on first install: anamnesis init --tools all --allow-exec-adapters",
    );
  }

  lines.push(
    input.execAdaptersEnabled
      ? "    native automation: enabled via --allow-exec-adapters"
      : `    native automation: disabled; enable with ${input.writtenToDisk ? "anamnesis apply --allow-exec-adapters" : installCommand}`,
  );

  lines.push(
    "    semantic ontology: /ontology-enrich when relationships, flows, intent, or operational rules matter",
  );
  lines.push(
    "    task handoff: /handoff-prepare before switching agents with in-progress work",
  );
  return lines;
}
