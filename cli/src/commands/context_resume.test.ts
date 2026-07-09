import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  contextResume,
  contextSubagentPreamble,
} from "./context_resume.js";

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

  it("uses Agentfile warm handoff budget for latest archive selection", () => {
    const project = tmpDir("anamnesis-context-resume-policy-");
    writeFile(
      project,
      "Agentfile",
      [
        "version: 1",
        "project: { name: fixture }",
        "tools: [codex]",
        "fragments: []",
        "settings:",
        "  max_warm_handoff_archives: 0",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/2026-06-21T00-00-00Z.md",
      "# Handoff - latest\n",
    );

    const result = contextResume({
      projectRoot: project,
      now: () => new Date("2026-06-22T00:00:00.000Z"),
    });

    expect(result.latestArchive).toBeUndefined();
    expect(result.bundle).toContain("latest_archive: (none)");
  });

  it("builds a launcher-wrapper subagent preamble from resume and startup pointers", () => {
    const project = tmpDir("anamnesis-context-subagent-preamble-");
    initGit(project);
    writeFile(project, "AGENTS.md", "# Agent rules\n");
    writeFile(project, "CLAUDE.md", "# Claude entrypoint\n");
    writeFile(
      project,
      ".anamnesis/ontology/base.yaml",
      "managed_by: anamnesis\nrule: always read pointers\n",
    );
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- subagent preamble - archive: `.anamnesis/handoff/warm.md`",
      ].join("\n"),
    );
    writeFile(project, ".anamnesis/handoff/warm.md", "# Handoff\n");

    const result = contextSubagentPreamble({
      projectRoot: project,
      now: () => new Date("2026-07-09T00:00:00.000Z"),
    });

    expect(result.schema_version).toBe("anamnesis.context_subagent_preamble.v1");
    expect(result.agentControlSources).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(result.startupSources.map((source) => source.path)).toEqual(
      expect.arrayContaining([
        ".anamnesis/ontology/base.yaml",
        ".anamnesis/handoff/active.md",
      ]),
    );
    expect(result.preamble).toContain("enforcement: launcher-wrapper");
    expect(result.preamble).toContain("## startup_source_pointers");
    expect(result.preamble).toContain(".anamnesis/ontology/base.yaml");
    expect(result.preamble).toContain("## resume_bundle");
    expect(result.preamble).toContain("anamnesis_context_sources");
    expect(result.summary.startupSourcePointers).toBeGreaterThanOrEqual(2);
  });

  it("writes the subagent preamble when requested", () => {
    const project = tmpDir("anamnesis-context-subagent-preamble-write-");

    const result = contextSubagentPreamble({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-07-09T00:00:00.000Z"),
    });

    expect(result.writtenPath).toBe(".anamnesis/context/subagent-preamble.md");
    expect(
      fs.readFileSync(
        path.join(project, ".anamnesis/context/subagent-preamble.md"),
        "utf8",
      ),
    ).toContain("# anamnesis subagent preamble");
  });
});
