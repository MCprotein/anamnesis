import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { dogfoodCheck, type CommandCheck } from "./dogfood.js";
import { init } from "./init.js";
import { update } from "./update.js";
import { readAgentfile, writeAgentfile, type ToolName } from "../core/agentfile.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function passRunner(cmd: string[]): CommandCheck {
  return {
    name: cmd.join(" "),
    command: cmd,
    outcome: "pass",
    durationMs: 7,
    detail: "passed by test runner",
  };
}

function setupDogfoodProject(): { project: string; library: string } {
  const library = process.cwd();
  const project = tmpDir("anamnesis-dogfood-");
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify(
      {
        scripts: {
          typecheck: "echo typecheck",
          test: "echo test",
        },
      },
      null,
      2,
    ),
  );

  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: true,
    noBootstrap: true,
  });

  const af = readAgentfile(project);
  af.tools = ["claude-code", "codex", "cursor"] satisfies ToolName[];
  writeAgentfile(project, af);

  update({
    projectRoot: project,
    libraryRoot: library,
    apply: true,
    allowExecAdapters: true,
  });

  return { project, library };
}

describe("dogfoodCheck", () => {
  it("scores a fully rendered cross-agent project and appends markdown", () => {
    const { project, library } = setupDogfoodProject();
    const result = dogfoodCheck({
      projectRoot: project,
      libraryRoot: library,
      append: true,
      outputPath: "docs/DOGFOOD.md",
      now: () => new Date("2026-04-30T08:00:00.000Z"),
      runner: (cmd) => passRunner(cmd),
    });

    expect(result.ok).toBe(true);
    expect(result.score).toMatchObject({
      passed: 5,
      total: 5,
      previous: null,
      trend: "new-baseline",
    });
    expect(result.appendedPath).toBe("docs/DOGFOOD.md");

    const text = fs.readFileSync(path.join(project, "docs", "DOGFOOD.md"), "utf8");
    expect(text).toContain("Automated Self-Check — 2026-04-30T08:00:00.000Z");
    expect(text).toContain("Continuity readiness score: 5/5 (new baseline)");
    expect(text).toContain("Tools: claude-code, codex, cursor");
  });

  it("compares the score with the previous appended result", () => {
    const { project, library } = setupDogfoodProject();
    fs.mkdirSync(path.join(project, "docs"));
    fs.writeFileSync(
      path.join(project, "docs", "DOGFOOD.md"),
      "## Previous\n\nContinuity readiness score: 4/5 (old)\n",
    );

    const result = dogfoodCheck({
      projectRoot: project,
      libraryRoot: library,
      append: true,
      outputPath: "docs/DOGFOOD.md",
      now: () => new Date("2026-04-30T09:00:00.000Z"),
      runner: (cmd) => passRunner(cmd),
    });

    expect(result.score.previous).toBe(4);
    expect(result.score.trend).toBe("improved");

    const text = fs.readFileSync(path.join(project, "docs", "DOGFOOD.md"), "utf8");
    expect(text).toContain(
      "Continuity readiness score: 5/5 (improved vs previous 4/5)",
    );
  });
});
