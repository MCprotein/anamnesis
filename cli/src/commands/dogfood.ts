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
import type { ToolName } from "../core/agentfile.js";

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
    runCodexNativeDispatchSimulation(libraryRoot),
    runRealCodexNativeSmokeIfEnabled(),
    runRealCodexProjectHookSmokeIfEnabled(),
    runRealCodexUserPromptSmokeIfEnabled(),
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
    tools: [...SUPPORTED_TOOLS],
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
    const codexHook = spawnSync(
      process.execPath,
      [path.join(project, ".anamnesis", "codex-native-hooks", "session-start.mjs")],
      {
        cwd: project,
        input: JSON.stringify({ hook_event_name: "SessionStart", cwd: project }),
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    if (codexHook.status !== 0) {
      const detail =
        (codexHook.stderr ?? "").trim() ||
        (codexHook.stdout ?? "").trim() ||
        codexHook.error?.message ||
        `exit ${codexHook.status}`;
      return handoffSimulationResult(command, start, "fail", detail);
    }
    const codexOutput = codexHook.stdout ?? "";
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    const cursorHandoff = fs.readFileSync(
      path.join(project, ".cursor", "rules", "handoff-prepare-cmd.mdc"),
      "utf8",
    );
    const missing = requiredHandoffEvidence(archivePath).filter(
      (needle) =>
        !hookOutput.includes(needle) &&
        !codexOutput.includes(needle) &&
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
      "active.md and latest archive injected; Codex native SessionStart and Cursor fallback instructions present",
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

function runCodexNativeDispatchSimulation(libraryRoot: string): CommandCheck {
  const command = ["anamnesis", "dogfood", "simulate-codex-native-dispatch"];
  const start = Date.now();
  let project: string | undefined;

  try {
    project = installAllAdapterSimulationProject(
      libraryRoot,
      "anamnesis-codex-native-dispatch-",
    );
    initializeGitRepo(project);
    writeActiveHandoffFixture(project);
    writeDirtyFixtureFiles(project, 9);

    const session = runNodeHook(
      project,
      path.join(project, ".anamnesis", "codex-native-hooks", "session-start.mjs"),
      {
        hook_event_name: "SessionStart",
        cwd: project,
      },
    );
    if (session.status !== 0) {
      return commandResult(command, start, "fail", hookFailureDetail(session));
    }
    const sessionContext = parseAdditionalContext(session.stdout);
    if (
      !sessionContext.includes("=== anamnesis: ontology context ===") ||
      !sessionContext.includes("=== anamnesis: handoff ===")
    ) {
      return commandResult(
        command,
        start,
        "fail",
        "SessionStart wrapper did not return ontology and handoff context",
      );
    }

    const postToolUse = runNodeHook(
      project,
      path.join(
        project,
        ".anamnesis",
        "codex-native-hooks",
        "base-PostToolUse-Edit-remind-uncommitted.mjs",
      ),
      {
        hook_event_name: "PostToolUse",
        cwd: project,
        tool_name: "apply_patch",
        tool_input: {
          command: [
            "*** Begin Patch",
            "*** Update File: dirty-0.txt",
            "@@",
            "-old",
            "+new",
            "*** End Patch",
          ].join("\n"),
        },
      },
    );
    if (postToolUse.status !== 0) {
      return commandResult(command, start, "fail", hookFailureDetail(postToolUse));
    }
    const postContext = parseAdditionalContext(postToolUse.stdout);
    if (!postContext.includes("uncommitted changes")) {
      return commandResult(
        command,
        start,
        "fail",
        "PostToolUse wrapper did not surface dirty-work reminder context",
      );
    }

    const stop = runNodeHook(
      project,
      path.join(
        project,
        ".anamnesis",
        "codex-native-hooks",
        "base-Stop-handoff-reminder.mjs",
      ),
      {
        hook_event_name: "Stop",
        cwd: project,
      },
    );
    if (stop.status !== 0) {
      return commandResult(command, start, "fail", hookFailureDetail(stop));
    }
    const stopDecision = parseStopDecision(stop.stdout);
    if (
      stopDecision.decision !== "block" ||
      !stopDecision.reason.includes("/handoff-prepare")
    ) {
      return commandResult(
        command,
        start,
        "fail",
        "Stop wrapper did not block with handoff reminder reason",
      );
    }

    return commandResult(
      command,
      start,
      "pass",
      "synthetic Codex JSON dispatch covered SessionStart, PostToolUse, and Stop wrappers",
    );
  } catch (e) {
    return commandResult(
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

function runRealCodexNativeSmokeIfEnabled(): CommandCheck {
  const command = ["anamnesis", "dogfood", "real-codex-native-smoke"];
  const start = Date.now();
  if (process.env.ANAMNESIS_REAL_CODEX_SMOKE !== "1") {
    return commandResult(
      command,
      start,
      "skipped",
      "set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI hook smoke",
    );
  }

  let codexHome: string | undefined;
  let project: string | undefined;
  try {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-codex-home-"));
    project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-codex-real-"));
    const sentinel = path.join(project, "codex-hook-sentinel.log");
    const hookPath = path.join(codexHome, "session-start-smoke.mjs");
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      "[features]\ncodex_hooks = true\n",
      "utf8",
    );
    fs.writeFileSync(hookPath, realCodexSmokeHookScript(), "utf8");
    fs.writeFileSync(
      path.join(codexHome, "hooks.json"),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                matcher: "startup|resume|clear",
                hooks: [
                  {
                    type: "command",
                    command: `node "${hookPath}"`,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "Return exactly OK.",
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          ANAMNESIS_CODEX_SMOKE_SENTINEL: sentinel,
        },
        input: "",
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    if (!fs.existsSync(sentinel)) {
      return commandResult(
        command,
        start,
        "fail",
        hookFailureDetail(result) || "Codex CLI did not invoke the SessionStart hook",
      );
    }
    const sentinelText = fs.readFileSync(sentinel, "utf8");
    if (!sentinelText.includes("SessionStart")) {
      return commandResult(
        command,
        start,
        "fail",
        "Codex CLI invoked the hook but did not pass a SessionStart payload",
      );
    }
    return commandResult(
      command,
      start,
      "pass",
      `real Codex CLI invoked SessionStart hook ${codexExitSuffix(result)}`,
    );
  } catch (e) {
    return commandResult(
      command,
      start,
      "fail",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    if (project !== undefined) {
      fs.rmSync(project, { recursive: true, force: true });
    }
    if (codexHome !== undefined) {
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  }
}

function runRealCodexProjectHookSmokeIfEnabled(): CommandCheck {
  const command = ["anamnesis", "dogfood", "real-codex-project-hook-smoke"];
  const start = Date.now();
  if (process.env.ANAMNESIS_REAL_CODEX_SMOKE !== "1") {
    return commandResult(
      command,
      start,
      "skipped",
      "set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI project hook smoke",
    );
  }

  let codexHome: string | undefined;
  let project: string | undefined;
  try {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-codex-home-"));
    project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-codex-project-"));
    const sentinel = path.join(project, "codex-project-hook-sentinel.log");
    const hookPath = path.join(project, "codex-project-session-start-smoke.mjs");
    fs.mkdirSync(path.join(project, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        "[features]",
        "codex_hooks = true",
        "",
        `[projects.${JSON.stringify(project)}]`,
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(project, ".codex", "config.toml"),
      "[features]\ncodex_hooks = true\n",
      "utf8",
    );
    fs.writeFileSync(hookPath, realCodexSmokeHookScript(), "utf8");
    fs.writeFileSync(
      path.join(project, ".codex", "hooks.json"),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                matcher: "startup|resume|clear",
                hooks: [
                  {
                    type: "command",
                    command: `node "${hookPath}"`,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(
      "codex",
      [
        "exec",
        "-C",
        project,
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "Return exactly OK.",
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          ANAMNESIS_CODEX_SMOKE_SENTINEL: sentinel,
        },
        input: "",
        encoding: "utf8",
        timeout: 20_000,
      },
    );

    if (!fs.existsSync(sentinel)) {
      return commandResult(
        command,
        start,
        "fail",
        hookFailureDetail(result) ||
          "Codex CLI did not invoke the project-local SessionStart hook",
      );
    }
    const sentinelText = fs.readFileSync(sentinel, "utf8");
    if (!sentinelText.includes("SessionStart")) {
      return commandResult(
        command,
        start,
        "fail",
        "Codex CLI invoked the project hook but did not pass a SessionStart payload",
      );
    }
    return commandResult(
      command,
      start,
      "pass",
      `real Codex CLI discovered project-local .codex/hooks.json SessionStart hook ${codexExitSuffix(result)}`,
    );
  } catch (e) {
    return commandResult(
      command,
      start,
      "fail",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    if (project !== undefined) {
      fs.rmSync(project, { recursive: true, force: true });
    }
    if (codexHome !== undefined) {
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  }
}

function runRealCodexUserPromptSmokeIfEnabled(): CommandCheck {
  const command = ["anamnesis", "dogfood", "real-codex-user-prompt-smoke"];
  const start = Date.now();
  if (process.env.ANAMNESIS_REAL_CODEX_SMOKE !== "1") {
    return commandResult(
      command,
      start,
      "skipped",
      "set ANAMNESIS_REAL_CODEX_SMOKE=1 to run the external Codex CLI UserPromptSubmit smoke",
    );
  }

  let codexHome: string | undefined;
  let project: string | undefined;
  try {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-codex-home-"));
    project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-codex-prompt-"));
    const sentinel = path.join(project, "codex-user-prompt-sentinel.log");
    const hookPath = path.join(project, "codex-user-prompt-smoke.mjs");
    fs.mkdirSync(path.join(project, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        "[features]",
        "codex_hooks = true",
        "",
        `[projects.${JSON.stringify(project)}]`,
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(project, ".codex", "config.toml"),
      "[features]\ncodex_hooks = true\n",
      "utf8",
    );
    fs.writeFileSync(hookPath, realCodexSmokeHookScript(), "utf8");
    fs.writeFileSync(
      path.join(project, ".codex", "hooks.json"),
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "command",
                    command: `node "${hookPath}"`,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(
      "codex",
      [
        "exec",
        "-C",
        project,
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "Return exactly OK.",
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          ANAMNESIS_CODEX_SMOKE_SENTINEL: sentinel,
        },
        input: "",
        encoding: "utf8",
        timeout: 20_000,
      },
    );

    if (!fs.existsSync(sentinel)) {
      return commandResult(
        command,
        start,
        "fail",
        hookFailureDetail(result) ||
          "Codex CLI did not invoke the UserPromptSubmit hook",
      );
    }
    const sentinelText = fs.readFileSync(sentinel, "utf8");
    if (
      !sentinelText.includes("UserPromptSubmit") ||
      !sentinelText.includes("ANAMNESIS_REAL_CODEX_HOOK_SMOKE_UserPromptSubmit")
    ) {
      return commandResult(
        command,
        start,
        "fail",
        "Codex CLI invoked UserPromptSubmit but did not receive the additionalContext-shaped hook output",
      );
    }
    return commandResult(
      command,
      start,
      "pass",
      `real Codex CLI invoked UserPromptSubmit hook with additionalContext output ${codexExitSuffix(result)}`,
    );
  } catch (e) {
    return commandResult(
      command,
      start,
      "fail",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    if (project !== undefined) {
      fs.rmSync(project, { recursive: true, force: true });
    }
    if (codexHome !== undefined) {
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  }
}

function initializeGitRepo(project: string): void {
  const result = spawnSync("git", ["init"], {
    cwd: project,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(hookFailureDetail(result) || "git init failed");
  }
}

function writeActiveHandoffFixture(project: string): void {
  const archivePath = ".anamnesis/handoff/2026-04-30T00-00-00Z.md";
  const handoffDir = path.join(project, ".anamnesis", "handoff");
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(
    path.join(project, archivePath),
    [
      "---",
      "created: 2026-04-30T00:00:00.000Z",
      "agent: codex",
      "git_ref: dogfood-fixture",
      "---",
      "",
      "# Handoff - Codex native dispatch simulation",
      "",
      "## Goal",
      "Synthetic native dispatch should expose this handoff to Codex.",
      "",
      "## Done so far",
      "- Installed all adapter surfaces.",
      "",
      "## In flight",
      "- verify Codex native dispatch",
      "",
      "## Decisions",
      "- SessionStart includes active.md and latest archive.",
      "",
      "## Open questions / blockers",
      "- none",
      "",
      "## Next steps",
      "1. Continue the smoke.",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(handoffDir, "active.md"),
    [
      "---",
      "updated: 2026-04-30T00:00:00.000Z",
      "agent: codex",
      "git_ref: dogfood-fixture",
      "---",
      "",
      "# Active handoff index",
      "",
      "## Current focus",
      `- Codex native dispatch simulation - archive: \`${archivePath}\``,
      "",
      "## Active tasks",
      `- [in-flight] Codex native dispatch simulation - next: verify hook JSON output - archive: \`${archivePath}\``,
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeDirtyFixtureFiles(project: string, count: number): void {
  const newerThanHandoff = new Date(Date.now() + 5_000);
  for (let i = 0; i < count; i++) {
    const file = path.join(project, `dirty-${i}.txt`);
    fs.writeFileSync(file, `dirty ${i}\n`, "utf8");
    fs.utimesSync(file, newerThanHandoff, newerThanHandoff);
  }
}

function runNodeHook(
  project: string,
  hookPath: string,
  payload: Record<string, unknown>,
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [hookPath], {
    cwd: project,
    input: JSON.stringify(payload),
    encoding: "utf8",
    stdio: "pipe",
  });
}

function parseAdditionalContext(stdout: string | Buffer | null): string {
  const parsed = parseJsonLine(stdout);
  const hookSpecificOutput = safeRecord(parsed.hookSpecificOutput);
  return typeof hookSpecificOutput.additionalContext === "string"
    ? hookSpecificOutput.additionalContext
    : "";
}

function parseStopDecision(
  stdout: string | Buffer | null,
): { decision: string; reason: string } {
  const parsed = parseJsonLine(stdout);
  return {
    decision: typeof parsed.decision === "string" ? parsed.decision : "",
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

function parseJsonLine(stdout: string | Buffer | null): Record<string, unknown> {
  const text = typeof stdout === "string" ? stdout.trim() : "";
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().startsWith("{"));
  if (!firstLine) return {};
  try {
    return safeRecord(JSON.parse(firstLine));
  } catch {
    return {};
  }
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hookFailureDetail(result: {
  status?: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
}): string {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return (
    stderr ||
    stdout ||
    result.error?.message ||
    (result.status !== undefined && result.status !== null
      ? `exit ${result.status}`
      : "")
  );
}

function codexExitSuffix(result: {
  status?: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
}): string {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0 && result.error === undefined) {
    return "and completed the model turn";
  }
  if (output.includes("401 Unauthorized")) {
    return "before expected isolated-CODEX_HOME auth failure";
  }
  if (result.error?.message.includes("ETIMEDOUT")) {
    return "before expected isolated-CODEX_HOME network timeout";
  }
  return `before Codex exited ${result.status ?? "unknown"}`;
}

function realCodexSmokeHookScript(): string {
  return `import fs from "node:fs";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
}
const raw = Buffer.concat(chunks).toString("utf8");
let eventName = "unknown";
try {
  const payload = JSON.parse(raw || "{}");
  eventName = typeof payload.hook_event_name === "string"
    ? payload.hook_event_name
    : eventName;
} catch {}
const output = {
  hookSpecificOutput: {
    hookEventName: eventName,
    additionalContext: "ANAMNESIS_REAL_CODEX_HOOK_SMOKE_" + eventName,
  },
};
const sentinel = process.env.ANAMNESIS_CODEX_SMOKE_SENTINEL;
if (sentinel) {
  fs.appendFileSync(
    sentinel,
    JSON.stringify({ input: raw || "{}", output }) + "\\n---\\n",
  );
}
process.stdout.write(JSON.stringify(output) + "\\n");
`;
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
  return commandResult(command, start, outcome, detail);
}

function commandResult(
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
    env: withoutRecursiveDogfoodEnv(process.env),
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

function withoutRecursiveDogfoodEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.ANAMNESIS_REAL_CODEX_SMOKE;
  return next;
}

function scoreCriteria(
  st: StatusResult,
  doc: DoctorResult,
  checks: CommandCheck[],
): DogfoodCriterion[] {
  const tools = new Set(st.agentfile.tools);
  const allToolsEnabled = SUPPORTED_TOOLS.every((t) => tools.has(t));
  const continuity = new Map(st.continuity.checks.map((c) => [c.id, c]));
  const codexHooksReady =
    !tools.has("codex") ||
    (st.codexHooks.readable && st.codexHooks.summary.warnings === 0);
  const failedChecks = checks.filter((c) => c.outcome === "fail");
  const hasPassingCheck = (namePart: string): boolean =>
    checks.some((c) => c.outcome === "pass" && c.name.includes(namePart));
  const verificationPassed =
    checks.length > 0 &&
    failedChecks.length === 0 &&
    hasPassingCheck("simulate-handoff") &&
    hasPassingCheck("simulate-stale-handoff") &&
    hasPassingCheck("simulate-codex-native-dispatch") &&
    hasPassingCheck("typecheck") &&
    hasPassingCheck("test");

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
        continuity.get("managed-drift")?.status === "pass" &&
        codexHooksReady
          ? "pass"
          : "fail",
      detail:
        `doctor ${doc.summary.errors} error(s), ${doc.summary.warnings} warning(s); ` +
        `status continuity ready=${st.continuity.ready}; ` +
        `ontology gaps warnings=${st.ontology.summary.warnings}; ` +
        `codex hook warnings=${st.codexHooks.summary.warnings}`,
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
    `Codex hooks: ${input.st.codexHooks.summary.total} total (anamnesis ${input.st.codexHooks.summary.anamnesis}, omx ${input.st.codexHooks.summary.omx}, plugin ${input.st.codexHooks.summary.plugin}, user ${input.st.codexHooks.summary.user}, invalid ${input.st.codexHooks.summary.invalid}, warnings ${input.st.codexHooks.summary.warnings})`,
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
