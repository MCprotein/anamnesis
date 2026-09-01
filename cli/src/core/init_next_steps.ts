const ALL_AGENT_TOOLS = ["claude-code", "codex", "cursor"] as const;

export interface InitNextStepInput {
  writtenToDisk: boolean;
  blockedWrites: number;
  tools: readonly string[];
  execAdaptersEnabled: boolean;
}

export interface InitNextStep {
  label: string;
  value: string;
  command?: boolean;
}

export function initNextSteps(input: InitNextStepInput): InitNextStep[] {
  const allToolsSelected = ALL_AGENT_TOOLS.every((tool) =>
    input.tools.includes(tool),
  );
  const installCommand = allToolsSelected
    ? "anamnesis init --tools all --allow-exec-adapters"
    : "anamnesis init --allow-exec-adapters";
  const steps: InitNextStep[] = input.writtenToDisk
    ? [
        { label: "verify install", value: "anamnesis doctor", command: true },
        { label: "inspect status", value: "anamnesis status", command: true },
      ]
    : [{ label: "apply reviewed plan", value: installCommand, command: true }];

  if (input.blockedWrites > 0) {
    steps.push({
      label: "blocked executable surfaces",
      value:
        "review hooks/commands/skills, then re-run with --allow-exec-adapters",
    });
  } else if (!allToolsSelected) {
    steps.push({
      label: "install all agent surfaces",
      value: "anamnesis init --tools all --allow-exec-adapters",
      command: true,
    });
  }

  steps.push(
    input.execAdaptersEnabled
      ? { label: "native automation", value: "enabled via --allow-exec-adapters" }
      : {
          label: "enable native automation",
          value: input.writtenToDisk
            ? "anamnesis apply --allow-exec-adapters"
            : installCommand,
          command: true,
        },
    {
      label: "semantic ontology",
      value: "/ontology-enrich",
      command: true,
    },
    {
      label: "task handoff",
      value: "/handoff-prepare",
      command: true,
    },
  );
  return steps;
}

export function formatInitNextStepLines(input: InitNextStepInput): string[] {
  return [
    "  next steps:",
    ...initNextSteps(input).map(
      (step) => `    ${step.label}: ${step.value}`,
    ),
  ];
}
