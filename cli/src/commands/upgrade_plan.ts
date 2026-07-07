import * as path from "node:path";
import {
  findAgentfile,
  readAgentfile,
} from "../core/agentfile.js";
import type { PlannedChange } from "../core/applier.js";
import {
  migrateAgentfile,
  CURRENT_AGENTFILE_VERSION,
} from "./migrate.js";
import {
  status,
  type StatusResult,
} from "./status.js";
import {
  update,
} from "./update.js";
import {
  doctor,
  type DoctorResult,
} from "./doctor.js";
import {
  upgrade,
  type UpgradeOptions,
  type UpgradeResult,
} from "./upgrade.js";

export type UpgradePlanProjectKind = "managed" | "unmanaged" | "unknown";
export type UpgradePlanGateSeverity = "error" | "warning" | "info";

export interface UpgradePlanGate {
  severity: UpgradePlanGateSeverity;
  kind: string;
  message: string;
  next: string;
}

export type UpgradePlanChoiceEffect =
  | "read-only"
  | "local-write"
  | "package-install"
  | "manual";

export interface UpgradePlanChoice {
  id: string;
  gateKind: string;
  label: string;
  effect: UpgradePlanChoiceEffect;
  command?: string;
  outcome: string;
  recommended: boolean;
}

export interface UpgradePlanProject {
  kind: UpgradePlanProjectKind;
  projectRoot: string;
  agentfilePath?: string;
  error?: string;
  schema?: {
    currentVersion: number;
    supportedVersion: number;
    migrationRequired: boolean;
    nextCommand: string;
  };
  statusSummary?: StatusResult["summary"];
  updateSummary?: ChangeSummary;
  doctorSummary?: DoctorResult["summary"];
  gates: UpgradePlanGate[];
  choices: UpgradePlanChoice[];
  commands: string[];
}

export interface ChangeSummary {
  create: number;
  update: number;
  noop: number;
  blocked: number;
  userModified: number;
}

export interface UpgradePlanResult {
  generatedAt: string;
  package: UpgradeResult;
  project: UpgradePlanProject;
}

export interface UpgradePlanOptions extends UpgradeOptions {
  projectRoot: string;
  libraryRoot: string;
  now?: () => Date;
}

export function upgradePlan(opts: UpgradePlanOptions): UpgradePlanResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const packageResult = upgrade({
    registry: opts.registry,
    apply: false,
    currentVersion: opts.currentVersion,
    latestVersion: opts.latestVersion,
    packageName: opts.packageName,
    fetchTimeoutMs: opts.fetchTimeoutMs,
    commandTimeoutMs: opts.commandTimeoutMs,
    runner: opts.runner,
  });

  return {
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    package: packageResult,
    project: inspectProject({
      projectRoot,
      libraryRoot,
      packageResult,
    }),
  };
}

function inspectProject(input: {
  projectRoot: string;
  libraryRoot: string;
  packageResult: UpgradeResult;
}): UpgradePlanProject {
  let agentfilePath: string | null;
  try {
    agentfilePath = findAgentfile(input.projectRoot);
  } catch (e) {
    return {
      kind: "unknown",
      projectRoot: input.projectRoot,
      error: (e as Error).message,
      gates: [
        {
          severity: "error",
          kind: "agentfile-discovery-failed",
          message: (e as Error).message,
          next: "Fix Agentfile discovery, then rerun `anamnesis upgrade plan` from the project root.",
        },
      ],
      choices: [],
      commands: ["anamnesis doctor"],
    };
  }

  if (!agentfilePath) {
    return {
      kind: "unmanaged",
      projectRoot: input.projectRoot,
      gates: [
        {
          severity: "info",
          kind: "project-unmanaged",
          message: "No Agentfile found in the current project.",
          next: "Run this command inside an anamnesis-managed project, or preview adoption here with `anamnesis init --dry-run`.",
        },
      ],
      choices: [
        {
          id: "preview-init",
          gateKind: "project-unmanaged",
          label: "Preview anamnesis adoption",
          effect: "read-only",
          command: "anamnesis init --dry-run",
          outcome: "Shows managed files and regions without writing project state.",
          recommended: true,
        },
      ],
      commands: [
        "anamnesis init --dry-run",
        "anamnesis update --dry-run --allow-exec-adapters",
      ],
    };
  }

  const relAgentfile = relativeProjectPath(input.projectRoot, agentfilePath);
  try {
    const agentfile = readAgentfile(input.projectRoot);
    const schemaPlan = migrateAgentfile({
      projectRoot: input.projectRoot,
      apply: false,
    });
    const st = status({
      projectRoot: input.projectRoot,
      libraryRoot: input.libraryRoot,
    });
    const dryRun = update({
      projectRoot: input.projectRoot,
      libraryRoot: input.libraryRoot,
      apply: false,
      allowExecAdapters: false,
    });
    const health = doctor({
      projectRoot: input.projectRoot,
      libraryRoot: input.libraryRoot,
    });
    const updateSummary = summarizePlannedChanges(dryRun.changes);
    const gates = projectGates({
      packageResult: input.packageResult,
      status: st,
      updateSummary,
      doctor: health,
      schema: schemaPlan,
    });

    return {
      kind: "managed",
      projectRoot: input.projectRoot,
      agentfilePath: relAgentfile,
      schema: {
        currentVersion: schemaPlan.currentVersion,
        supportedVersion: CURRENT_AGENTFILE_VERSION,
        migrationRequired: schemaPlan.changed,
        nextCommand: schemaPlan.nextCommand,
      },
      statusSummary: st.summary,
      updateSummary,
      doctorSummary: health.summary,
      gates,
      choices: projectChoices({
        packageResult: input.packageResult,
        status: st,
        updateSummary,
        doctor: health,
        schema: schemaPlan,
      }),
      commands: nextCommands({
        packageResult: input.packageResult,
        agentfileVersion: agentfile.version,
        schemaChanged: schemaPlan.changed,
        updateSummary,
        status: st,
      }),
    };
  } catch (e) {
    return {
      kind: "unknown",
      projectRoot: input.projectRoot,
      agentfilePath: relAgentfile,
      error: (e as Error).message,
      gates: [
        {
          severity: "error",
          kind: "project-inspection-failed",
          message: (e as Error).message,
          next: "Fix the reported project issue, then rerun `anamnesis upgrade plan` before applying project updates.",
        },
      ],
      choices: [],
      commands: [
        "anamnesis migrate agentfile --apply",
        "anamnesis doctor",
      ],
    };
  }
}

function projectGates(input: {
  packageResult: UpgradeResult;
  status: StatusResult;
  updateSummary: ChangeSummary;
  doctor: DoctorResult;
  schema: ReturnType<typeof migrateAgentfile>;
}): UpgradePlanGate[] {
  const gates: UpgradePlanGate[] = [];

  if (input.packageResult.updateAvailable) {
    gates.push({
      severity: "info",
      kind: "package-update-available",
      message:
        `CLI package can update from ${input.packageResult.currentVersion} ` +
        `to ${input.packageResult.latestVersion}.`,
      next: input.packageResult.installCommand.join(" "),
    });
  }

  if (input.schema.changed) {
    gates.push({
      severity: "warning",
      kind: "agentfile-migration-required",
      message:
        `Agentfile schema ${input.schema.currentVersion} needs migration ` +
        `to ${input.schema.targetVersion}.`,
      next: input.schema.nextCommand,
    });
  }

  if (input.status.summary.fragmentUpdatesAvailable > 0) {
    gates.push({
      severity: "warning",
      kind: "fragment-updates-available",
      message:
        `${input.status.summary.fragmentUpdatesAvailable} fragment update(s) available.`,
      next: "Preview all project changes with `anamnesis update --dry-run --allow-exec-adapters`; omit the flag only if executable adapters should remain untouched.",
    });
  }

  if (input.status.partialAdoptions.length > 0) {
    gates.push({
      severity: "warning",
      kind: "partial-adoption",
      message:
        `${input.status.partialAdoptions.length} fragment(s) are held back by preserved managed surfaces.`,
      next: "Review `anamnesis status` partial upgrades; manually merge user-modified surfaces or rerun update with the needed permission flags.",
    });
  }

  if (input.updateSummary.blocked > 0) {
    gates.push({
      severity: "warning",
      kind: "executable-adapter-gate",
      message:
        `${input.updateSummary.blocked} executable adapter write(s) require explicit permission.`,
      next: "Re-run preview/apply with `--allow-exec-adapters` only after reviewing hooks, commands, skills, Cursor rules, and Codex wrappers.",
    });
  }

  if (input.updateSummary.userModified > 0) {
    gates.push({
      severity: "warning",
      kind: "user-modified-managed-surfaces",
      message:
        `${input.updateSummary.userModified} managed surface(s) contain local edits and will be preserved.`,
      next: "Compare the dry-run output with the local file; manually merge wanted library content or keep the local edit and accept the warning.",
    });
  }

  if (input.status.summary.fragmentPinned > 0) {
    gates.push({
      severity: "info",
      kind: "pinned-fragments",
      message:
        `${input.status.summary.fragmentPinned} pinned fragment(s) will not move unless requested.`,
      next: "Preview with `anamnesis update --dry-run --bump-pinned --allow-exec-adapters` only after reviewing the pinned version change.",
    });
  }

  if (input.status.summary.suggestedCount > 0) {
    gates.push({
      severity: "info",
      kind: "suggested-fragments",
      message:
        `${input.status.summary.suggestedCount} rulebook suggestion(s) are not installed.`,
      next: "Add wanted fragments to Agentfile, or record intentional opt-outs under `declined` to silence future suggestions.",
    });
  }

  if (input.doctor.summary.errors > 0 || input.doctor.summary.warnings > 0) {
    gates.push({
      severity: input.doctor.summary.errors > 0 ? "error" : "warning",
      kind: "doctor-issues",
      message:
        `doctor reports ${input.doctor.summary.errors} error(s) and ` +
        `${input.doctor.summary.warnings} warning(s).`,
      next: "Run `anamnesis doctor`; resolve errors before applying project updates, and review warnings for expected agent-required follow-up.",
    });
  }

  return gates;
}

function projectChoices(input: {
  packageResult: UpgradeResult;
  status: StatusResult;
  updateSummary: ChangeSummary;
  doctor: DoctorResult;
  schema: ReturnType<typeof migrateAgentfile>;
}): UpgradePlanChoice[] {
  const choices: UpgradePlanChoice[] = [];

  if (input.packageResult.updateAvailable) {
    choices.push({
      id: "upgrade-cli-package",
      gateKind: "package-update-available",
      label: "Upgrade the global CLI package",
      effect: "package-install",
      command: input.packageResult.installCommand.join(" "),
      outcome:
        "Updates the installed anamnesis CLI only; project-managed files still need update/doctor after package install.",
      recommended: true,
    });
  }

  if (input.schema.changed) {
    choices.push({
      id: "migrate-agentfile-schema",
      gateKind: "agentfile-migration-required",
      label: "Migrate Agentfile schema",
      effect: "local-write",
      command: input.schema.nextCommand,
      outcome:
        "Backs up and rewrites Agentfile schema before rendering project-managed surfaces.",
      recommended: true,
    });
  }

  if (
    input.status.summary.fragmentUpdatesAvailable > 0 ||
    input.updateSummary.create > 0 ||
    input.updateSummary.update > 0 ||
    input.updateSummary.blocked > 0
  ) {
    choices.push({
      id: "preview-content-only-update",
      gateKind: "fragment-updates-available",
      label: "Preview content-only project update",
      effect: "read-only",
      command: "anamnesis update --dry-run",
      outcome:
        "Shows non-executable managed content changes while keeping hook/command/skill adapter writes blocked.",
      recommended: input.updateSummary.blocked === 0,
    });
    choices.push({
      id: "preview-executable-adapter-update",
      gateKind:
        input.updateSummary.blocked > 0
          ? "executable-adapter-gate"
          : "fragment-updates-available",
      label: "Preview with executable adapters included",
      effect: "read-only",
      command: "anamnesis update --dry-run --allow-exec-adapters",
      outcome:
        "Includes hooks, commands, skills, Cursor rules, and Codex wrappers in the preview without writing them.",
      recommended: input.updateSummary.blocked > 0,
    });
  }

  if (input.updateSummary.blocked > 0) {
    choices.push({
      id: "apply-executable-adapter-update",
      gateKind: "executable-adapter-gate",
      label: "Apply executable adapter updates after review",
      effect: "local-write",
      command: "anamnesis update --apply --allow-exec-adapters",
      outcome:
        "Writes reviewed project surfaces and executable adapter files; local user edits remain preserved.",
      recommended: false,
    });
  }

  if (
    input.status.partialAdoptions.length > 0 ||
    input.updateSummary.userModified > 0
  ) {
    choices.push({
      id: "keep-local-managed-edits",
      gateKind:
        input.status.partialAdoptions.length > 0
          ? "partial-adoption"
          : "user-modified-managed-surfaces",
      label: "Keep local managed edits",
      effect: "manual",
      outcome:
        "Leaves user-modified managed surfaces untouched and accepts partial adoption until a later manual merge.",
      recommended: true,
    });
    choices.push({
      id: "manually-merge-managed-surfaces",
      gateKind: "user-modified-managed-surfaces",
      label: "Manually merge library content",
      effect: "manual",
      outcome:
        "Compare dry-run output with local files, merge wanted library content, then rerun update and doctor.",
      recommended: false,
    });
  }

  if (input.status.summary.fragmentPinned > 0) {
    choices.push({
      id: "keep-pinned-fragments",
      gateKind: "pinned-fragments",
      label: "Keep pinned fragments unchanged",
      effect: "manual",
      outcome:
        "Leaves pinned fragment versions as-is; future update runs will continue to preserve the pin.",
      recommended: true,
    });
    choices.push({
      id: "preview-bump-pinned-fragments",
      gateKind: "pinned-fragments",
      label: "Preview bumping pinned fragments",
      effect: "read-only",
      command: "anamnesis update --dry-run --bump-pinned --allow-exec-adapters",
      outcome:
        "Shows the explicit version move for pinned fragments before any local write.",
      recommended: false,
    });
  }

  if (input.status.summary.suggestedCount > 0) {
    choices.push({
      id: "add-suggested-fragments",
      gateKind: "suggested-fragments",
      label: "Add wanted suggested fragments",
      effect: "manual",
      outcome:
        "Edit Agentfile to add the useful rulebook suggestions, then run update dry-run/apply.",
      recommended: false,
    });
    choices.push({
      id: "decline-suggested-fragments",
      gateKind: "suggested-fragments",
      label: "Record intentional suggestion opt-outs",
      effect: "manual",
      outcome:
        "Add declined entries to Agentfile so irrelevant rulebook suggestions stop reappearing.",
      recommended: false,
    });
  }

  if (input.doctor.summary.errors > 0 || input.doctor.summary.warnings > 0) {
    choices.push({
      id: "inspect-doctor-issues",
      gateKind: "doctor-issues",
      label: "Inspect doctor issues",
      effect: "read-only",
      command: "anamnesis doctor",
      outcome:
        "Shows install integrity, continuity, ontology, and context diagnostics before applying more changes.",
      recommended: input.doctor.summary.errors > 0,
    });
  }

  return choices;
}

function nextCommands(input: {
  packageResult: UpgradeResult;
  agentfileVersion: number;
  schemaChanged: boolean;
  updateSummary: ChangeSummary;
  status: StatusResult;
}): string[] {
  const commands: string[] = [];
  if (input.packageResult.updateAvailable) {
    commands.push(input.packageResult.installCommand.join(" "));
  }
  if (input.schemaChanged || input.agentfileVersion !== CURRENT_AGENTFILE_VERSION) {
    commands.push("anamnesis migrate agentfile --apply");
  }
  commands.push("anamnesis update --dry-run --allow-exec-adapters");
  if (
    input.updateSummary.create > 0 ||
    input.updateSummary.update > 0 ||
    input.updateSummary.blocked > 0
  ) {
    commands.push("anamnesis update --apply --allow-exec-adapters");
  }
  if (input.status.summary.fragmentPinned > 0) {
    commands.push("anamnesis update --dry-run --bump-pinned --allow-exec-adapters");
  }
  commands.push("anamnesis doctor");
  return [...new Set(commands)];
}

export function summarizePlannedChanges(
  changes: readonly PlannedChange[],
): ChangeSummary {
  const summary: ChangeSummary = {
    create: 0,
    update: 0,
    noop: 0,
    blocked: 0,
    userModified: 0,
  };
  for (const change of changes) {
    if (change.status === "create") summary.create++;
    else if (change.status === "update") summary.update++;
    else if (change.status === "noop") summary.noop++;
    else if (change.status === "blocked") summary.blocked++;
    else if (change.status === "user-modified") summary.userModified++;
  }
  return summary;
}

function relativeProjectPath(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath);
  return rel === "" ? path.basename(targetPath) : rel;
}
