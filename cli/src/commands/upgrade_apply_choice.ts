import * as path from "node:path";
import {
  init,
  type InitResult,
} from "./init.js";
import {
  update,
  type UpdateResult,
} from "./update.js";
import {
  doctor,
  type DoctorResult,
} from "./doctor.js";
import {
  migrateAgentfile,
  type MigrateAgentfileResult,
} from "./migrate.js";
import {
  upgrade,
  type UpgradeResult,
} from "./upgrade.js";
import {
  summarizePlannedChanges,
  upgradePlan,
  type UpgradePlanChoice,
  type UpgradePlanOptions,
  type UpgradePlanResult,
} from "./upgrade_plan.js";

export type UpgradeApplyChoiceStatus =
  | "executed-read-only"
  | "preview-required"
  | "applied"
  | "manual"
  | "unsupported";

export type UpgradeApplyChoiceOperation =
  | "init"
  | "update"
  | "migrate-agentfile"
  | "doctor"
  | "upgrade-package"
  | "none";

export type UpgradeApplyChoiceExecution =
  | InitResult
  | UpdateResult
  | MigrateAgentfileResult
  | DoctorResult
  | UpgradeResult;

export interface UpgradeApplyChoiceResult {
  generatedAt: string;
  choiceId: string;
  choice: UpgradePlanChoice;
  status: UpgradeApplyChoiceStatus;
  operation: UpgradeApplyChoiceOperation;
  command?: string;
  previewCommand?: string;
  message: string;
  summary: string[];
  plan: UpgradePlanResult;
  execution?: UpgradeApplyChoiceExecution;
}

export interface UpgradeApplyChoiceOptions
  extends Omit<UpgradePlanOptions, "apply"> {
  choiceId: string;
  apply?: boolean;
}

export class UpgradeApplyChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpgradeApplyChoiceError";
  }
}

export function upgradeApplyChoice(
  opts: UpgradeApplyChoiceOptions,
): UpgradeApplyChoiceResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const plan = upgradePlan({
    ...opts,
    projectRoot,
    libraryRoot,
    apply: false,
  });
  const choice = plan.project.choices.find((entry) => entry.id === opts.choiceId);

  if (!choice) {
    const available = plan.project.choices.map((entry) => entry.id).join(", ");
    throw new UpgradeApplyChoiceError(
      `choice '${opts.choiceId}' not found` +
        (available.length > 0 ? `; available choices: ${available}` : ""),
    );
  }

  if (choice.effect === "manual" || !choice.command) {
    return result({
      plan,
      choice,
      status: "manual",
      operation: "none",
      message:
        "This choice is manual guidance and has no safe executable command.",
      summary: [choice.outcome],
    });
  }

  switch (choice.id) {
    case "preview-init":
      return executeInitPreview({ plan, choice, projectRoot, libraryRoot });
    case "upgrade-cli-package":
      return executePackageUpgrade({ plan, choice, opts });
    case "migrate-agentfile-schema":
      return executeMigrationChoice({ plan, choice, opts, projectRoot });
    case "preview-content-only-update":
      return executeUpdateChoice({
        plan,
        choice,
        projectRoot,
        libraryRoot,
        applyRequested: opts.apply === true,
        desiredApply: false,
        allowExecAdapters: false,
        bumpPinned: false,
      });
    case "apply-content-only-update":
      return executeUpdateChoice({
        plan,
        choice,
        projectRoot,
        libraryRoot,
        applyRequested: opts.apply === true,
        desiredApply: true,
        allowExecAdapters: false,
        bumpPinned: false,
        previewCommand: "anamnesis update --dry-run",
      });
    case "preview-executable-adapter-update":
      return executeUpdateChoice({
        plan,
        choice,
        projectRoot,
        libraryRoot,
        applyRequested: opts.apply === true,
        desiredApply: false,
        allowExecAdapters: true,
        bumpPinned: false,
      });
    case "apply-executable-adapter-update":
      return executeUpdateChoice({
        plan,
        choice,
        projectRoot,
        libraryRoot,
        applyRequested: opts.apply === true,
        desiredApply: true,
        allowExecAdapters: true,
        bumpPinned: false,
        previewCommand: "anamnesis update --dry-run --allow-exec-adapters",
      });
    case "preview-bump-pinned-fragments":
      return executeUpdateChoice({
        plan,
        choice,
        projectRoot,
        libraryRoot,
        applyRequested: opts.apply === true,
        desiredApply: false,
        allowExecAdapters: true,
        bumpPinned: true,
      });
    case "inspect-doctor-issues":
      return executeDoctorChoice({ plan, choice, projectRoot, libraryRoot });
    default:
      return result({
        plan,
        choice,
        status: "unsupported",
        operation: "none",
        command: choice.command,
        message:
          "This choice has a command, but this CLI does not yet have an internal executor for it.",
        summary: [
          "No command was run. Use the printed command manually after review.",
        ],
      });
  }
}

function executeInitPreview(input: {
  plan: UpgradePlanResult;
  choice: UpgradePlanChoice;
  projectRoot: string;
  libraryRoot: string;
}): UpgradeApplyChoiceResult {
  const execution = init({
    projectRoot: input.projectRoot,
    libraryRoot: input.libraryRoot,
    dryRun: true,
    allowExecAdapters: false,
  });
  const summary = summarizePlannedChanges(execution.changes);
  return result({
    plan: input.plan,
    choice: input.choice,
    status: "executed-read-only",
    operation: "init",
    command: input.choice.command,
    message: "Executed the read-only init preview choice.",
    summary: [
      `init dry-run: create=${summary.create} update=${summary.update} blocked=${summary.blocked} user-modified=${summary.userModified}`,
      `fragments: ${execution.selectedFragments.map((fragment) => fragment.id).join(", ") || "(none)"}`,
    ],
    execution,
  });
}

function executePackageUpgrade(input: {
  plan: UpgradePlanResult;
  choice: UpgradePlanChoice;
  opts: UpgradeApplyChoiceOptions;
}): UpgradeApplyChoiceResult {
  if (input.opts.apply !== true) {
    return result({
      plan: input.plan,
      choice: input.choice,
      status: "preview-required",
      operation: "upgrade-package",
      command: input.choice.command,
      message:
        "Package install choices are external writes; re-run with --apply to execute after review.",
      summary: [
        `package: ${input.plan.package.currentVersion} -> ${input.plan.package.latestVersion} [${input.plan.package.status}]`,
      ],
    });
  }

  const execution = upgrade({
    registry: input.opts.registry,
    apply: true,
    currentVersion: input.opts.currentVersion,
    latestVersion: input.opts.latestVersion,
    packageName: input.opts.packageName,
    fetchTimeoutMs: input.opts.fetchTimeoutMs,
    commandTimeoutMs: input.opts.commandTimeoutMs,
    runner: input.opts.runner,
  });
  return result({
    plan: input.plan,
    choice: input.choice,
    status: "applied",
    operation: "upgrade-package",
    command: input.choice.command,
    message: "Executed the package upgrade choice.",
    summary: [
      `package: ${execution.currentVersion} -> ${execution.latestVersion} [${execution.status}]`,
      `applied: ${execution.applied}`,
    ],
    execution,
  });
}

function executeMigrationChoice(input: {
  plan: UpgradePlanResult;
  choice: UpgradePlanChoice;
  opts: UpgradeApplyChoiceOptions;
  projectRoot: string;
}): UpgradeApplyChoiceResult {
  const apply = input.opts.apply === true;
  const execution = migrateAgentfile({
    projectRoot: input.projectRoot,
    apply,
    migrations: input.opts.agentfileMigrations,
  });
  return result({
    plan: input.plan,
    choice: input.choice,
    status: apply ? "applied" : "preview-required",
    operation: "migrate-agentfile",
    command: apply ? input.choice.command : undefined,
    previewCommand: apply ? undefined : "anamnesis migrate agentfile",
    message: apply
      ? "Executed the Agentfile migration choice."
      : "Previewed the Agentfile migration choice; re-run with --apply to write after review.",
    summary: [
      `migration: ${execution.currentVersion} -> ${execution.targetVersion}`,
      `changed: ${execution.changed}`,
      `applied: ${execution.applied}`,
      `next: ${execution.nextCommand}`,
    ],
    execution,
  });
}

function executeUpdateChoice(input: {
  plan: UpgradePlanResult;
  choice: UpgradePlanChoice;
  projectRoot: string;
  libraryRoot: string;
  applyRequested: boolean;
  desiredApply: boolean;
  allowExecAdapters: boolean;
  bumpPinned: boolean;
  previewCommand?: string;
}): UpgradeApplyChoiceResult {
  const shouldApply = input.desiredApply && input.applyRequested;
  const execution = update({
    projectRoot: input.projectRoot,
    libraryRoot: input.libraryRoot,
    apply: shouldApply,
    allowExecAdapters: input.allowExecAdapters,
    bumpPinned: input.bumpPinned,
  });
  const summary = summarizePlannedChanges(execution.changes);
  const needsApply = input.desiredApply && !input.applyRequested;

  return result({
    plan: input.plan,
    choice: input.choice,
    status: shouldApply
      ? "applied"
      : needsApply
        ? "preview-required"
        : "executed-read-only",
    operation: "update",
    command: shouldApply || !needsApply ? input.choice.command : undefined,
    previewCommand: needsApply ? input.previewCommand : undefined,
    message: shouldApply
      ? "Executed the project update choice."
      : needsApply
        ? "Previewed the project update choice; re-run with --apply to write after review."
        : "Executed the read-only project update preview choice.",
    summary: [
      `update: create=${summary.create} update=${summary.update} noop=${summary.noop} blocked=${summary.blocked} user-modified=${summary.userModified}`,
      `written: ${execution.writtenToDisk}`,
    ],
    execution,
  });
}

function executeDoctorChoice(input: {
  plan: UpgradePlanResult;
  choice: UpgradePlanChoice;
  projectRoot: string;
  libraryRoot: string;
}): UpgradeApplyChoiceResult {
  const execution = doctor({
    projectRoot: input.projectRoot,
    libraryRoot: input.libraryRoot,
  });
  return result({
    plan: input.plan,
    choice: input.choice,
    status: "executed-read-only",
    operation: "doctor",
    command: input.choice.command,
    message: "Executed the read-only doctor choice.",
    summary: [
      `doctor: errors=${execution.summary.errors} warnings=${execution.summary.warnings} info=${execution.summary.info}`,
    ],
    execution,
  });
}

function result(input: Omit<UpgradeApplyChoiceResult, "generatedAt" | "choiceId">):
  UpgradeApplyChoiceResult {
  return {
    generatedAt: new Date().toISOString(),
    choiceId: input.choice.id,
    ...input,
  };
}
