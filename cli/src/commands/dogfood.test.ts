import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { dogfoodCheck, type CommandCheck } from "./dogfood.js";
import { init } from "./init.js";

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
    tools: ["claude-code", "codex", "cursor"],
  });

  return { project, library };
}

describe("dogfoodCheck", () => {
  beforeEach(() => {
    delete process.env.ANAMNESIS_REAL_CODEX_SMOKE;
    delete process.env.ANAMNESIS_REAL_CODEX_TOOL_SMOKE;
  });

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
    expect(result.evidencePath).toBe(".anamnesis/evidence/events.jsonl");
    expect(result.checks.map((c) => c.name)).toContain(
      "anamnesis dogfood simulate-handoff",
    );
    expect(result.checks.map((c) => c.name)).toContain(
      "anamnesis dogfood simulate-stale-handoff",
    );
    expect(result.checks.map((c) => c.name)).toContain(
      "anamnesis dogfood simulate-codex-native-dispatch",
    );
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "anamnesis dogfood real-codex-native-smoke",
          outcome: "skipped",
        }),
        expect.objectContaining({
          name: "anamnesis dogfood real-codex-project-hook-smoke",
          outcome: "skipped",
        }),
        expect.objectContaining({
          name: "anamnesis dogfood real-codex-user-prompt-smoke",
          outcome: "skipped",
        }),
        expect.objectContaining({
          name: "anamnesis dogfood real-codex-tool-turn-smoke",
          outcome: "skipped",
        }),
      ]),
    );

    const text = fs.readFileSync(path.join(project, "docs", "DOGFOOD.md"), "utf8");
    expect(text).toContain("Automated Self-Check — 2026-04-30T08:00:00.000Z");
    expect(text).toContain("Continuity readiness score: 5/5 (new baseline)");
    expect(text).toContain("Tools: claude-code, codex, cursor");
    expect(text).toContain("Codex hooks:");
    expect(text).toContain("codex hook warnings=0");
    expect(text).toContain("Ontology gaps:");
    expect(text).toContain("`anamnesis dogfood simulate-handoff`");
    expect(text).toContain("`anamnesis dogfood simulate-stale-handoff`");
    expect(text).toContain("`anamnesis dogfood simulate-codex-native-dispatch`");
    expect(text).toContain("`anamnesis dogfood real-codex-native-smoke`");
    expect(text).toContain("`anamnesis dogfood real-codex-project-hook-smoke`");
    expect(text).toContain("`anamnesis dogfood real-codex-user-prompt-smoke`");
    expect(text).toContain("`anamnesis dogfood real-codex-tool-turn-smoke`");
    expect(text).toContain("active.md and latest archive injected");
    expect(text).toContain("status and doctor detect active.md");
    expect(text).toContain("synthetic Codex JSON dispatch");

    const evidenceLines = fs
      .readFileSync(
        path.join(project, ".anamnesis", "evidence", "events.jsonl"),
        "utf8",
      )
      .trim()
      .split(/\r?\n/);
    expect(evidenceLines).toHaveLength(3);
    expect(JSON.parse(evidenceLines[0]!) as { kind: string }).toMatchObject({
      kind: "init-install",
    });
    expect(JSON.parse(evidenceLines[1]!) as { kind: string }).toMatchObject({
      kind: "fragment-lifecycle",
    });
    const evidence = JSON.parse(evidenceLines.at(-1)!) as {
      schema_version: string;
      kind: string;
      generated_at: string;
      summary: Record<string, unknown>;
      artifacts: Record<string, string>;
    };
    expect(evidence).toMatchObject({
      schema_version: "anamnesis.evidence.v1",
      kind: "dogfood-check",
      generated_at: "2026-04-30T08:00:00.000Z",
      summary: {
        ok: true,
        score: "5/5",
        trend: "new-baseline",
      },
      artifacts: {
        markdown: "docs/DOGFOOD.md",
      },
    });
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

  it("does not count skipped required verification scripts as passing", () => {
    const { project, library } = setupDogfoodProject();
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ scripts: {} }, null, 2),
    );

    const result = dogfoodCheck({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-04-30T10:00:00.000Z"),
      runner: (cmd) => passRunner(cmd),
    });

    expect(result.ok).toBe(false);
    expect(result.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "verification-strength",
          status: "fail",
        }),
      ]),
    );
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "npm typecheck", outcome: "skipped" }),
        expect.objectContaining({ name: "npm test", outcome: "skipped" }),
      ]),
    );
  });
});
