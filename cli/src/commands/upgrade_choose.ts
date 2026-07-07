import * as path from "node:path";
import * as process from "node:process";
import { createInterface } from "node:readline/promises";
import {
  upgradeApplyChoice,
  type UpgradeApplyChoiceOptions,
  type UpgradeApplyChoiceResult,
} from "./upgrade_apply_choice.js";
import {
  upgradePlan,
  type UpgradePlanChoice,
  type UpgradePlanResult,
} from "./upgrade_plan.js";

export interface UpgradeChooseMenuItem {
  index: number;
  id: string;
  label: string;
  effect: UpgradePlanChoice["effect"];
  recommended: boolean;
  command?: string;
  outcome: string;
}

export interface UpgradeChooseResult {
  generatedAt: string;
  selectedChoiceId: string;
  interactive: boolean;
  menu: UpgradeChooseMenuItem[];
  execution: UpgradeApplyChoiceResult;
}

export type UpgradeChoosePrompt = (question: string) => Promise<string>;

export interface UpgradeChooseOptions
  extends Omit<UpgradeApplyChoiceOptions, "choiceId" | "plan"> {
  choiceInput?: string;
  inputIsTTY?: boolean;
  prompt?: UpgradeChoosePrompt;
}

export class UpgradeChooseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpgradeChooseError";
  }
}

export async function upgradeChoose(
  opts: UpgradeChooseOptions,
): Promise<UpgradeChooseResult> {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const plan = upgradePlan({
    ...opts,
    projectRoot,
    libraryRoot,
    apply: false,
  });
  const menu = buildUpgradeChoiceMenu(plan);
  if (menu.length === 0) {
    throw new UpgradeChooseError(
      "upgrade plan produced no choices; run `anamnesis upgrade plan` for details",
    );
  }

  const interactive = opts.choiceInput === undefined;
  const rawChoice =
    opts.choiceInput ??
    (await promptForChoice({
      menu,
      prompt: opts.prompt,
      inputIsTTY: opts.inputIsTTY,
    }));
  const selected = selectUpgradeChoice(menu, rawChoice);
  if (!selected) {
    throw new UpgradeChooseError(
      `unknown choice '${rawChoice.trim()}'; use a menu number or choice id from \`anamnesis upgrade plan\``,
    );
  }

  const execution = upgradeApplyChoice({
    ...opts,
    projectRoot,
    libraryRoot,
    choiceId: selected.id,
    plan,
  });

  return {
    generatedAt: new Date().toISOString(),
    selectedChoiceId: selected.id,
    interactive,
    menu,
    execution,
  };
}

export function buildUpgradeChoiceMenu(
  plan: UpgradePlanResult,
): UpgradeChooseMenuItem[] {
  return plan.project.choices.map((choice, offset) => ({
    index: offset + 1,
    id: choice.id,
    label: choice.label,
    effect: choice.effect,
    recommended: choice.recommended,
    command: choice.command,
    outcome: choice.outcome,
  }));
}

export function selectUpgradeChoice(
  menu: readonly UpgradeChooseMenuItem[],
  rawInput: string,
): UpgradeChooseMenuItem | undefined {
  const input = rawInput.trim();
  if (input.length === 0) return undefined;

  if (/^\d+$/.test(input)) {
    const index = Number(input);
    return menu.find((entry) => entry.index === index);
  }

  return menu.find((entry) => entry.id === input);
}

export function renderUpgradeChoiceMenu(
  menu: readonly UpgradeChooseMenuItem[],
): string {
  const lines = [
    "Choose one upgrade plan choice:",
    "",
    ...menu.map((entry) => {
      const recommended = entry.recommended ? ", recommended" : "";
      const command = entry.command ? ` command: ${entry.command}` : "";
      return `${entry.index}. ${entry.id} [${entry.effect}${recommended}] ${entry.label}${command}`;
    }),
    "",
    "Enter a number or choice id: ",
  ];
  return lines.join("\n");
}

async function promptForChoice(input: {
  menu: readonly UpgradeChooseMenuItem[];
  prompt?: UpgradeChoosePrompt;
  inputIsTTY?: boolean;
}): Promise<string> {
  const question = renderUpgradeChoiceMenu(input.menu);
  if (input.prompt) {
    return input.prompt(question);
  }

  const inputIsTTY = input.inputIsTTY ?? process.stdin.isTTY === true;
  if (!inputIsTTY) {
    throw new UpgradeChooseError(
      "interactive chooser requires a terminal; use `anamnesis upgrade plan` or `anamnesis upgrade apply-choice <id>` in scripts",
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
