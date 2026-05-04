import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { init } from "../commands/init.js";
import { update } from "../commands/update.js";
import { status } from "../commands/status.js";
import { doctor } from "../commands/doctor.js";
import {
  readAgentfile,
  writeAgentfile,
  type ToolName,
} from "../core/agentfile.js";
import {
  SWITCHING_AGENT_ORDER,
  SWITCHING_SCENARIOS,
  formatSwitchingScenariosMarkdown,
  switchingScenarioId,
} from "./switching.js";

function setupSwitchingProject(): { project: string; library: string } {
  const library = process.cwd();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-switching-"));
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: true,
    noBootstrap: true,
  });

  const af = readAgentfile(project);
  af.tools = [...SWITCHING_AGENT_ORDER];
  writeAgentfile(project, af);
  update({
    projectRoot: project,
    libraryRoot: library,
    apply: true,
    allowExecAdapters: true,
  });
  return { project, library };
}

function writeScenarioHandoff(
  project: string,
  from: ToolName,
  to: ToolName,
  archiveName: string,
): string {
  const scenarioId = switchingScenarioId(from, to);
  const archivePath = `.anamnesis/handoff/${archiveName}`;
  const handoffDir = path.join(project, ".anamnesis", "handoff");
  fs.rmSync(handoffDir, { recursive: true, force: true });
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(
    path.join(project, archivePath),
    [
      "---",
      "created: 2026-05-03T00:00:00.000Z",
      `agent: ${from}`,
      "git_ref: switching-fixture",
      "---",
      "",
      `# Handoff — ${scenarioId}`,
      "",
      "## Goal",
      `Verify ${scenarioId} can resume without a user re-brief.`,
      "",
      "## Done so far",
      "- Installed all adapter surfaces.",
      "",
      "## In flight",
      `- switching scenario ${scenarioId}`,
      "",
      "## Decisions",
      "- Treat active.md as the first cross-agent session-start index.",
      "",
      "## Open questions / blockers",
      "- none",
      "",
      "## Next steps",
      `1. ${to} resumes from this handoff.`,
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(handoffDir, "active.md"),
    [
      "---",
      "updated: 2026-05-03T00:00:00.000Z",
      `agent: ${from}`,
      "git_ref: switching-fixture",
      "---",
      "",
      "# Active handoff index",
      "",
      "## Current focus",
      `- switching scenario ${scenarioId} — archive: \`${archivePath}\``,
      "",
      "## Active tasks",
      `- [in-flight] switching scenario ${scenarioId} — next: ${to} resumes — archive: \`${archivePath}\``,
      "",
      "## Recently completed",
      "- none",
      "",
    ].join("\n"),
    "utf8",
  );
  return archivePath;
}

function expectSourcePrepareSurface(project: string, from: ToolName): void {
  if (from === "claude-code") {
    const command = fs.readFileSync(
      path.join(project, ".claude", "commands", "handoff-prepare.md"),
      "utf8",
    );
    expect(command).toContain("Capture the current task state");
    expect(command).toContain(".anamnesis/handoff/active.md");
    expect(command).toContain("next agent");
    return;
  }

  if (from === "codex") {
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain("codex-cmd-handoff-prepare");
    expect(agents).toContain("/handoff-prepare");
    expect(agents).toContain(".anamnesis/handoff/active.md");
    return;
  }

  const cursorRule = fs.readFileSync(
    path.join(project, ".cursor", "rules", "handoff-prepare-cmd.mdc"),
    "utf8",
  );
  expect(cursorRule).toContain("agentRequested: true");
  expect(cursorRule).toContain("/handoff-prepare");
  expect(cursorRule).toContain(".anamnesis/handoff/active.md");
}

function expectTargetResumeSurface(
  project: string,
  to: ToolName,
  archivePath: string,
  scenarioId: string,
): void {
  if (to === "claude-code") {
    const hookPath = path.join(project, ".claude", "hooks", "inject-handoff.sh");
    const hook = spawnSync(hookPath, [], {
      cwd: project,
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(hook.status).toBe(0);
    expect(hook.stdout).toContain("Source: .anamnesis/handoff/active.md");
    expect(hook.stdout).toContain(`--- most recent archived handoff: ${archivePath} ---`);
    expect(hook.stdout).toContain(`switching scenario ${scenarioId}`);
    return;
  }

  if (to === "codex") {
    const hook = spawnSync(
      process.execPath,
      [path.join(project, ".anamnesis", "codex-native-hooks", "session-start.mjs")],
      {
        cwd: project,
        input: JSON.stringify({ hook_event_name: "SessionStart", cwd: project }),
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    expect(hook.status).toBe(0);
    const output = JSON.parse(hook.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = output.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("=== anamnesis: handoff ===");
    expect(context).toContain("Source: .anamnesis/handoff/active.md");
    expect(context).toContain(`--- most recent archived handoff: ${archivePath} ---`);
    expect(context).toContain(`switching scenario ${scenarioId}`);
    const hooksJson = fs.readFileSync(
      path.join(project, ".codex", "hooks.json"),
      "utf8",
    );
    expect(hooksJson).toContain(".anamnesis/codex-native-hooks/session-start.mjs");
    return;
  }

  const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  expect(agents).toContain("Session start: handoff");
  expect(agents).toContain(".anamnesis/handoff/active.md");
  expect(agents).toContain("active.md 가 가리키는 archive");
  expect(agents).toContain("stale");
}

function writeStaleScenario(project: string, from: ToolName, to: ToolName): string {
  const oldArchive = writeScenarioHandoff(
    project,
    from,
    to,
    "2026-05-03T00-00-00Z.md",
  );
  const newestArchive = ".anamnesis/handoff/2026-05-03T01-00-00Z.md";
  const newest = path.join(project, newestArchive);
  fs.writeFileSync(
    newest,
    fs
      .readFileSync(path.join(project, oldArchive), "utf8")
      .replace("00:00:00.000Z", "01:00:00.000Z")
      .replace("without a user re-brief", "after stale detection"),
    "utf8",
  );
  fs.utimesSync(
    path.join(project, oldArchive),
    new Date("2026-05-03T00:00:00.000Z"),
    new Date("2026-05-03T00:00:00.000Z"),
  );
  fs.utimesSync(
    newest,
    new Date("2026-05-03T01:00:00.000Z"),
    new Date("2026-05-03T01:00:00.000Z"),
  );
  return newestArchive;
}

describe("3x3 switching-agent scenarios", () => {
  it("defines every ordered source/target pair, including same-agent restarts", () => {
    expect(SWITCHING_SCENARIOS).toHaveLength(9);
    expect(SWITCHING_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "claude-code->claude-code",
      "claude-code->codex",
      "claude-code->cursor",
      "codex->claude-code",
      "codex->codex",
      "codex->cursor",
      "cursor->claude-code",
      "cursor->codex",
      "cursor->cursor",
    ]);
  });

  it("keeps the published scenario table synced with the canonical fixture", () => {
    const docs = fs.readFileSync(
      path.join(process.cwd(), "docs", "SWITCHING-SCENARIOS.md"),
      "utf8",
    );
    const expected = [
      "<!-- switching-scenarios:matrix:start -->",
      formatSwitchingScenariosMarkdown(),
      "<!-- switching-scenarios:matrix:end -->",
    ].join("\n");

    expect(docs).toContain(expected);
  });

  it("verifies each ordered switch can prepare and resume active handoff state", () => {
    const { project, library } = setupSwitchingProject();
    try {
      for (const scenario of SWITCHING_SCENARIOS) {
        const archivePath = writeScenarioHandoff(
          project,
          scenario.from,
          scenario.to,
          `${scenario.from}-to-${scenario.to}.md`,
        );
        expectSourcePrepareSurface(project, scenario.from);
        expectTargetResumeSurface(
          project,
          scenario.to,
          archivePath,
          scenario.id,
        );
        const st = status({ projectRoot: project, libraryRoot: library });
        const active = st.continuity.checks.find((c) => c.id === "active-handoff");
        expect(active?.status, scenario.id).toBe("pass");
      }
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("verifies stale active handoff detection for every ordered switch", () => {
    const { project, library } = setupSwitchingProject();
    try {
      for (const scenario of SWITCHING_SCENARIOS) {
        const newestArchive = writeStaleScenario(project, scenario.from, scenario.to);
        const st = status({ projectRoot: project, libraryRoot: library });
        const active = st.continuity.checks.find((c) => c.id === "active-handoff");
        expect(active?.status, scenario.id).toBe("fail");
        expect(active?.detail, scenario.id).toContain(newestArchive);

        const doc = doctor({ projectRoot: project, libraryRoot: library });
        expect(
          doc.issues.some(
            (issue) =>
              issue.code === "continuity-active-handoff-stale" &&
              issue.target?.includes(newestArchive),
          ),
          scenario.id,
        ).toBe(true);
      }
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
