// `anamnesis dogfood check` — self-check the repo as a real managed project.
//
// The command is intentionally product-oriented: it scores continuity
// readiness across context, ontology, adapter surfaces, diagnostics, and
// verification. With `--append`, it records a markdown entry for release
// history and version-to-version comparison.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { status, StatusError, type StatusResult } from "./status.js";
import { doctor, DoctorError, type DoctorResult } from "./doctor.js";
import {
  bootstrap,
  OntologyBootstrapError,
  type BootstrapResult,
} from "./ontology.js";
import { init } from "./init.js";
import { update } from "./update.js";
import {
  readAgentfile,
  writeAgentfile,
  type ToolName,
} from "../core/agentfile.js";

export type CriterionId =
  | "context-continuity"
  | "ontology-availability"
  | "adapter-parity"
  | "diagnostics-quality"
  | "verification-strength";

export type CriterionStatus = "pass" | "fail";

export interface DogfoodCriterion {
  id: CriterionId;
  label: string;
  status: CriterionStatus;
  detail: string;
}

export type CheckOutcome = "pass" | "fail" | "skipped";

export interface CommandCheck {
  name: string;
  command: string[];
  outcome: CheckOutcome;
  durationMs: number;
  detail: string;
}

export interface DogfoodResult {
  projectRoot: string;
  libraryRoot: string;
  generatedAt: string;
  status: StatusResult;
  doctor: DoctorResult;
  bootstrap: BootstrapResult;
  checks: CommandCheck[];
  criteria: DogfoodCriterion[];
  score: {
    passed: number;
    total: number;
    previous: number | null;
    trend: "improved" | "regressed" | "unchanged" | "new-baseline";
  };
  appendedPath?: string;
  ok: boolean;
  markdown: string;
}

export interface DogfoodOptions {
  projectRoot: string;
  libraryRoot: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
  runner?: (cmd: string[], opts: { cwd: string }) => CommandCheck;
}

export class DogfoodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DogfoodError";
  }
}

const SUPPORTED_TOOLS: ToolName[] = ["claude-code", "codex", "cursor"];

export function dogfoodCheck(opts: DogfoodOptions): DogfoodResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const outputPath = path.resolve(
    projectRoot,
    opts.outputPath ?? path.join("docs", "DOGFOOD.md"),
  );
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();

  let st: StatusResult;
  let doc: DoctorResult;
  let boot: BootstrapResult;
  try {
    st = status({ projectRoot, libraryRoot });
    doc = doctor({ projectRoot, libraryRoot });
    boot = bootstrap({ projectRoot, dryRun: true });
  } catch (e) {
    if (
      e instanceof StatusError ||
      e instanceof DoctorError ||
      e instanceof OntologyBootstrapError
    ) {
      throw new DogfoodError(e.message);
    }
    throw e;
  }

  const checks = runVerificationChecks(
    projectRoot,
    libraryRoot,
    opts.runner ?? runCommand,
  );
  const criteria = scoreCriteria(st, doc, checks);
  const passed = criteria.filter((c) => c.status === "pass").length;
  const total = criteria.length;
  const previous = previousScore(outputPath);
  const trend =
    previous === null
      ? "new-baseline"
      : passed > previous
        ? "improved"
        : passed < previous
          ? "regressed"
          : "unchanged";
  const markdown = renderMarkdown({
    generatedAt,
    st,
    doc,
    boot,
    checks,
    criteria,
    passed,
    total,
    previous,
    trend,
  });

  let appendedPath: string | undefined;
  if (opts.append === true) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}`, "utf8");
    appendedPath = path.relative(projectRoot, outputPath);
  }

  return {
    projectRoot,
    libraryRoot,
    generatedAt,
    status: st,
    doctor: doc,
    bootstrap: boot,
    checks,
    criteria,
    score: { passed, total, previous, trend },
    appendedPath,
    ok: passed === total,
    markdown,
  };
}

function runVerificationChecks(
  projectRoot: string,
  libraryRoot: string,
  runner: (cmd: string[], opts: { cwd: string }) => CommandCheck,
): CommandCheck[] {
  return [
    runActiveHandoffSimulation(libraryRoot),
    runStaleHandoffSimulation(libraryRoot),
    runNpmScript(projectRoot, "typecheck", ["npm", "run", "typecheck"], runner),
    runNpmScript(projectRoot, "test", ["npm", "test"], runner),
  ];
}

function installAllAdapterSimulationProject(
  libraryRoot: string,
  prefix: string,
): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  init({
    projectRoot: project,
    libraryRoot,
    dryRun: false,
    allowExecAdapters: true,
    noBootstrap: true,
  });

  const af = readAgentfile(project);
  af.tools = [...SUPPORTED_TOOLS];
  writeAgentfile(project, af);
  update({
    projectRoot: project,
    libraryRoot,
    apply: true,
    allowExecAdapters: true,
  });
  return project;
}

function runActiveHandoffSimulation(libraryRoot: string): CommandCheck {
  const command = ["anamnesis", "dogfood", "simulate-handoff"];
  const start = Date.now();
  let project: string | undefined;

  try {
    project = installAllAdapterSimulationProject(
      libraryRoot,
      "anamnesis-handoff-switch-",
    );

    const archivePath = ".anamnesis/handoff/2026-04-30T00-00-00Z.md";
    const handoffDir = path.join(project, ".anamnesis", "handoff");
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, archivePath),
      [
        "---",
        "created: 2026-04-30T00:00:00.000Z",
        "agent: claude-code",
        "git_ref: dogfood-fixture",
        "---",
        "",
        "# Handoff — v0.5 active switch simulation",
        "",
        "## Goal",
        "Codex or Cursor should continue from active.md without a user re-brief.",
        "",
        "## Done so far",
        "- Installed Claude Code, Codex, and Cursor adapter surfaces.",
        "",
        "## In flight",
        "- resume v0.5 active handoff simulation",
        "",
        "## Decisions",
        "- Treat active.md as the first session-start index.",
        "",
        "## Open questions / blockers",
        "- none",
        "",
        "## Next steps",
        "1. Verify the next agent receives active handoff context.",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(handoffDir, "active.md"),
      [
        "---",
        "updated: 2026-04-30T00:00:00.000Z",
        "agent: claude-code",
        "git_ref: dogfood-fixture",
        "---",
        "",
        "# Active handoff index",
        "",
        "## Current focus",
        `- v0.5 active handoff simulation — archive: \`${archivePath}\``,
        "",
        "## Active tasks",
        `- [in-flight] resume v0.5 active handoff simulation — next: verify injected handoff context across agents — archive: \`${archivePath}\``,
        "",
        "## Recently completed",
        "- none",
        "",
      ].join("\n"),
      "utf8",
    );

    const hookPath = path.join(project, ".claude", "hooks", "inject-handoff.sh");
    const hook = spawnSync(hookPath, [], {
      cwd: project,
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
      stdio: "pipe",
    });
    if (hook.status !== 0) {
      const detail =
        (hook.stderr ?? "").trim() ||
        (hook.stdout ?? "").trim() ||
        hook.error?.message ||
        `exit ${hook.status}`;
      return handoffSimulationResult(command, start, "fail", detail);
    }

    const hookOutput = hook.stdout ?? "";
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    const cursorHandoff = fs.readFileSync(
      path.join(project, ".cursor", "rules", "handoff-prepare-cmd.mdc"),
      "utf8",
    );
    const missing = requiredHandoffEvidence(archivePath).filter(
      (needle) =>
        !hookOutput.includes(needle) &&
        !agents.includes(needle) &&
        !cursorHandoff.includes(needle),
    );
    if (missing.length > 0) {
      return handoffSimulationResult(
        command,
        start,
        "fail",
        `missing active handoff evidence: ${missing.join(", ")}`,
      );
    }

    return handoffSimulationResult(
      command,
      start,
      "pass",
      "active.md and latest archive injected; Codex/Cursor fallback instructions present",
    );
  } catch (e) {
    return handoffSimulationResult(
      command,
      start,
      "fail",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    if (project !== undefined) {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }
}

function runStaleHandoffSimulation(libraryRoot: string): CommandCheck {
  const command = ["anamnesis", "dogfood", "simulate-stale-handoff"];
  const start = Date.now();
  let project: string | undefined;

  try {
    project = installAllAdapterSimulationProject(
      libraryRoot,
      "anamnesis-stale-handoff-",
    );
    const oldArchive = ".anamnesis/handoff/2026-04-30T00-00-00Z.md";
    const newestArchive = ".anamnesis/handoff/2026-04-30T01-00-00Z.md";
    writeSimulationArchive(
      project,
      oldArchive,
      "Old active handoff state that should be superseded.",
      new Date("2026-04-30T00:00:00.000Z"),
    );
    writeSimulationArchive(
      project,
      newestArchive,
      "Newest handoff state that active.md should reference.",
      new Date("2026-04-30T01:00:00.000Z"),
    );
    writeSimulationActiveIndex(project, oldArchive);

    const st = status({ projectRoot: project, libraryRoot });
    const active = st.continuity.checks.find((c) => c.id === "active-handoff");
    const doc = doctor({ projectRoot: project, libraryRoot });
    const doctorHasWarning = doc.issues.some(
      (issue) =>
        issue.code === "continuity-active-handoff-stale" &&
        issue.target?.includes(newestArchive),
    );
    if (active?.status !== "fail" || !active.detail.includes(newestArchive)) {
      return handoffSimulationResult(
        command,
        start,
        "fail",
        active?.detail ?? "active-handoff check missing",
      );
    }
    if (!doctorHasWarning) {
      return handoffSimulationResult(
        command,
        start,
        "fail",
        "doctor did not report continuity-active-handoff-stale",
      );
    }

    return handoffSimulationResult(
      command,
      start,
      "pass",
      "status and doctor detect active.md that does not reference the newest archive",
    );
  } catch (e) {
    return handoffSimulationResult(
      command,
      start,
      "fail",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    if (project !== undefined) {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }
}

function writeSimulationArchive(
  project: string,
  archivePath: string,
  goal: string,
  mtime?: Date,
): void {
  const abs = path.join(project, archivePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    [
      "---",
      "created: 2026-04-30T00:00:00.000Z",
      "agent: claude-code",
      "git_ref: dogfood-fixture",
      "---",
      "",
      "# Handoff — v0.5 active switch simulation",
      "",
      "## Goal",
      goal,
      "",
      "## Done so far",
      "- Installed Claude Code, Codex, and Cursor adapter surfaces.",
      "",
      "## In flight",
      "- resume v0.5 active handoff simulation",
      "",
      "## Decisions",
      "- Treat active.md as the first session-start index.",
      "",
      "## Open questions / blockers",
      "- none",
      "",
      "## Next steps",
      "1. Verify the next agent receives active handoff context.",
      "",
    ].join("\n"),
    "utf8",
  );
  if (mtime !== undefined) {
    fs.utimesSync(abs, mtime, mtime);
  }
}

function writeSimulationActiveIndex(project: string, archivePath: string): void {
  const handoffDir = path.join(project, ".anamnesis", "handoff");
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(
    path.join(handoffDir, "active.md"),
    [
      "---",
      "updated: 2026-04-30T00:00:00.000Z",
      "agent: claude-code",
      "git_ref: dogfood-fixture",
      "---",
      "",
      "# Active handoff index",
      "",
      "## Current focus",
      `- v0.5 active handoff simulation — archive: \`${archivePath}\``,
      "",
      "## Active tasks",
      `- [in-flight] resume v0.5 active handoff simulation — next: verify injected handoff context across agents — archive: \`${archivePath}\``,
      "",
      "## Recently completed",
      "- none",
      "",
    ].join("\n"),
    "utf8",
  );
}

function requiredHandoffEvidence(archivePath: string): string[] {
  return [
    "Source: .anamnesis/handoff/active.md",
    `--- most recent archived handoff: ${archivePath} ---`,
    "resume v0.5 active handoff simulation",
    "Codex or Cursor should continue from active.md without a user re-brief.",
    ".anamnesis/handoff/active.md",
    "stale",
    "/handoff-prepare",
  ];
}

function handoffSimulationResult(
  command: string[],
  start: number,
  outcome: CheckOutcome,
  detail: string,
): CommandCheck {
  return {
    name: command.join(" "),
    command,
    outcome,
    durationMs: Date.now() - start,
    detail,
  };
}

function runNpmScript(
  projectRoot: string,
  scriptName: string,
  command: string[],
  runner: (cmd: string[], opts: { cwd: string }) => CommandCheck,
): CommandCheck {
  if (!hasPackageScript(projectRoot, scriptName)) {
    return {
      name: `npm ${scriptName}`,
      command,
      outcome: "skipped",
      durationMs: 0,
      detail: `package.json script '${scriptName}' not found`,
    };
  }
  return runner(command, { cwd: projectRoot });
}

function hasPackageScript(projectRoot: string, scriptName: string): boolean {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  return typeof pkg.scripts?.[scriptName] === "string";
}

function runCommand(cmd: string[], opts: { cwd: string }): CommandCheck {
  const start = Date.now();
  const bin = process.platform === "win32" && cmd[0] === "npm" ? "npm.cmd" : cmd[0]!;
  const result = spawnSync(bin, cmd.slice(1), {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  const durationMs = Date.now() - start;
  const stderr = (result.stderr ?? "").trim();
  const stdout = (result.stdout ?? "").trim();
  const detail =
    result.status === 0
      ? "passed"
      : (stderr || stdout || result.error?.message || `exit ${result.status}`);
  return {
    name: cmd.join(" "),
    command: cmd,
    outcome: result.status === 0 ? "pass" : "fail",
    durationMs,
    detail,
  };
}

function scoreCriteria(
  st: StatusResult,
  doc: DoctorResult,
  checks: CommandCheck[],
): DogfoodCriterion[] {
  const tools = new Set(st.agentfile.tools);
  const allToolsEnabled = SUPPORTED_TOOLS.every((t) => tools.has(t));
  const continuity = new Map(st.continuity.checks.map((c) => [c.id, c]));
  const verificationPassed =
    checks.length > 0 &&
    checks.every((c) => c.outcome === "pass") &&
    checks.some((c) => c.name.includes("simulate-handoff")) &&
    checks.some((c) => c.name.includes("simulate-stale-handoff")) &&
    checks.some((c) => c.name.includes("typecheck")) &&
    checks.some((c) => c.name.includes("test"));

  return [
    {
      id: "context-continuity",
      label: "Context continuity",
      status:
        allToolsEnabled &&
        continuity.get("project-memory")?.status === "pass" &&
        continuity.get("handoff")?.status === "pass" &&
        continuity.get("active-handoff")?.status === "pass"
          ? "pass"
          : "fail",
      detail:
        `enabled tools: ${st.agentfile.tools.join(", ")}; ` +
        `status continuity ${st.continuity.passed}/${st.continuity.total}`,
    },
    {
      id: "ontology-availability",
      label: "Ontology availability",
      status: continuity.get("ontology")?.status ?? "fail",
      detail: continuity.get("ontology")?.detail ?? "ontology check missing",
    },
    {
      id: "adapter-parity",
      label: "Adapter parity surface",
      status:
        allToolsEnabled && continuity.get("adapter-surfaces")?.status === "pass"
          ? "pass"
          : "fail",
      detail:
        continuity.get("adapter-surfaces")?.detail ??
        "adapter surface check missing",
    },
    {
      id: "diagnostics-quality",
      label: "Diagnostics quality",
      status:
        doc.ok &&
        st.continuity.ready &&
        continuity.get("managed-drift")?.status === "pass"
          ? "pass"
          : "fail",
      detail:
        `doctor ${doc.summary.errors} error(s), ${doc.summary.warnings} warning(s); ` +
        `status continuity ready=${st.continuity.ready}; ` +
        `ontology gaps warnings=${st.ontology.summary.warnings}`,
    },
    {
      id: "verification-strength",
      label: "Verification strength",
      status: verificationPassed ? "pass" : "fail",
      detail: checks
        .map((c) => `${c.name}: ${c.outcome} (${c.durationMs}ms)`)
        .join("; "),
    },
  ];
}

function previousScore(outputPath: string): number | null {
  if (!fs.existsSync(outputPath)) return null;
  const text = fs.readFileSync(outputPath, "utf8");
  const matches = Array.from(
    text.matchAll(/Continuity readiness score:\s+(\d+)\/5/g),
  );
  const last = matches.at(-1);
  return last?.[1] ? Number(last[1]) : null;
}

function renderMarkdown(input: {
  generatedAt: string;
  st: StatusResult;
  doc: DoctorResult;
  boot: BootstrapResult;
  checks: CommandCheck[];
  criteria: DogfoodCriterion[];
  passed: number;
  total: number;
  previous: number | null;
  trend: DogfoodResult["score"]["trend"];
}): string {
  const trendText =
    input.previous === null
      ? "new baseline"
      : `${input.trend} vs previous ${input.previous}/5`;
  const bootstrapSummary = summarizeBootstrap(input.boot);
  const checks = input.checks
    .map(
      (c) =>
        `| \`${c.command.join(" ")}\` | ${c.outcome} | ${c.durationMs} | ${escapeCell(c.detail)} |`,
    )
    .join("\n");
  const criteria = input.criteria
    .map((c) => `| ${c.label} | ${c.status} | ${escapeCell(c.detail)} |`)
    .join("\n");

  return [
    `## Automated Self-Check — ${input.generatedAt}`,
    "",
    `Continuity readiness score: ${input.passed}/${input.total} (${trendText})`,
    "",
    `Project: ${input.st.agentfile.project.name}`,
    `Tools: ${input.st.agentfile.tools.join(", ")}`,
    `Fragments: ${input.st.fragments.map((f) => `${f.id}@${f.installedVersion}:${f.status}`).join(", ")}`,
    `Drift: ${input.st.summary.entriesClean} clean, ${input.st.summary.entriesUserModified} modified, ${input.st.summary.entriesMissing} missing`,
    `Status continuity: ${input.st.continuity.ready ? "ready" : "issues"} (${input.st.continuity.passed}/${input.st.continuity.total})`,
    `Doctor: ${input.doc.ok ? "ok" : "issues"} (${input.doc.summary.errors} errors, ${input.doc.summary.warnings} warnings)`,
    `Ontology gaps: ${input.st.ontology.summary.warnings} warning(s), ${input.st.ontology.summary.info} info`,
    `Ontology bootstrap dry-run: ${bootstrapSummary}`,
    "",
    "| Criterion | Result | Detail |",
    "|---|---|---|",
    criteria,
    "",
    "| Verification command | Result | ms | Detail |",
    "|---|---|---:|---|",
    checks || "| _(none)_ | skipped | 0 | no verification commands configured |",
  ].join("\n");
}

function summarizeBootstrap(result: BootstrapResult): string {
  const counts = new Map<string, number>();
  for (const entry of result.entries) {
    counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
