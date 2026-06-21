import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { contextResume } from "./context_resume.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function initGit(project: string): void {
  spawnSync("git", ["init"], { cwd: project, stdio: "ignore" });
}

describe("context resume", () => {
  it("builds a compact resume bundle from handoff, touched files, evidence, and diagnostics", () => {
    const project = tmpDir("anamnesis-context-resume-");
    initGit(project);
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- compact resume bundle - archive: `.anamnesis/handoff/old.md`",
        "",
        "## Active tasks",
        "- [in-flight] implement resume bundle - next: verify benchmarks - archive: `.anamnesis/handoff/old.md`",
        "",
      ].join("\n"),
    );
    writeFile(project, ".anamnesis/handoff/old.md", "# Handoff - old\n");
    writeFile(project, ".anamnesis/handoff/new.md", "# Handoff - new\n");
    fs.utimesSync(
      path.join(project, ".anamnesis", "handoff", "old.md"),
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-20T00:00:00.000Z"),
    );
    fs.utimesSync(
      path.join(project, ".anamnesis", "handoff", "new.md"),
      new Date("2026-06-21T00:00:00.000Z"),
      new Date("2026-06-21T00:00:00.000Z"),
    );
    writeFile(project, "src/app.ts", "export const app = true;\n");
    writeFile(
      project,
      ".anamnesis/evidence/events.jsonl",
      `${JSON.stringify({
        schema_version: "anamnesis.evidence.v1",
        kind: "doctor-check",
        generated_at: "2026-06-21T01:00:00.000Z",
        command: ["anamnesis", "doctor"],
        project: { name: "fixture" },
        summary: { ok: true, errors: 0, warnings: 0 },
      })}\n`,
    );

    const result = contextResume({
      projectRoot: project,
      now: () => new Date("2026-06-22T00:00:00.000Z"),
      maxTouchedFiles: 6,
    });

    expect(result.projectRoot).toBe(".");
    expect(result.activeHandoff).toBe(".anamnesis/handoff/active.md");
    expect(result.latestArchive).toBe(".anamnesis/handoff/new.md");
    expect(result.activeTasks[0]).toContain("compact resume bundle");
    expect(result.touchedFiles.map((file) => file.path)).toContain("src/app.ts");
    expect(result.latestEvidence).toMatchObject({
      kind: "doctor-check",
      generated_at: "2026-06-21T01:00:00.000Z",
    });
    expect(result.diagnostics.warnings).toBe(1);
    expect(result.bundle).toContain("## retrieval_rule");
    expect(result.summary.estimatedTokens).toBeLessThan(300);
  });

  it("writes the resume bundle when requested", () => {
    const project = tmpDir("anamnesis-context-resume-write-");

    const result = contextResume({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-06-22T00:00:00.000Z"),
    });

    expect(result.writtenPath).toBe(".anamnesis/context/resume.md");
    expect(
      fs.readFileSync(path.join(project, ".anamnesis/context/resume.md"), "utf8"),
    ).toContain("# anamnesis resume bundle");
  });
});
