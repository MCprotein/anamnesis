import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gc, GcError } from "./gc.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function writeHarness(project: string, name: string, body: string): void {
  writeFile(project, `.anamnesis/task-harnesses/${name}.yaml`, body);
}

function writeManifest(project: string, managedPaths: string[]): void {
  writeFile(
    project,
    ".anamnesis/manifest.json",
    JSON.stringify(
      {
        version: 1,
        regions: [],
        files: managedPaths.map((managedPath, index) => ({
          path: managedPath,
          fragment_id: "base",
          fragment_version: 14,
          last_applied_hash: `sha256:${String(index + 1).repeat(64)}`,
          current_user_hash: `sha256:${String(index + 1).repeat(64)}`,
        })),
      },
      null,
      2,
    ),
  );
}

describe("gc", () => {
  it("reports no candidates for a fresh reusable managed harness", () => {
    const project = tmpDir("anamnesis-gc-fresh-");
    writeHarness(
      project,
      "context-continuity",
      [
        'schema_version: "anamnesis.task_harness.v1"',
        'id: "context-continuity"',
        "lifecycle:",
        '  kind: "reusable"',
        "  use_count: 2",
        "  deprecated: false",
        "",
      ].join("\n"),
    );
    writeManifest(project, [
      ".anamnesis/task-harnesses/context-continuity.yaml",
    ]);

    const result = gc({
      projectRoot: project,
      now: () => new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(result.applied).toBe(false);
    expect(result.summary.total).toBe(1);
    expect(result.summary.managed).toBe(1);
    expect(result.summary.candidates).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it("marks stale current harnesses as managed delete candidates", () => {
    const project = tmpDir("anamnesis-gc-stale-current-");
    writeHarness(
      project,
      "old-current",
      [
        'schema_version: "anamnesis.task_harness.v1"',
        'id: "old-current"',
        "lifecycle:",
        '  kind: "current"',
        '  last_used: "2026-06-01T00:00:00.000Z"',
        "",
      ].join("\n"),
    );
    writeManifest(project, [".anamnesis/task-harnesses/old-current.yaml"]);

    const result = gc({
      projectRoot: project,
      maxCurrentAgeDays: 14,
      now: () => new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(result.summary.current).toBe(1);
    expect(result.summary.deleteCandidates).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      path: ".anamnesis/task-harnesses/old-current.yaml",
      lifecycle: "current",
      origin: "managed",
      recommendation: "delete-candidate",
      reasons: ["stale-current"],
    });
  });

  it("asks for review before cleanup of user-authored deprecated reusable harnesses", () => {
    const project = tmpDir("anamnesis-gc-user-authored-");
    writeHarness(
      project,
      "old-template",
      [
        'schema_version: "anamnesis.task_harness.v1"',
        'id: "old-template"',
        "lifecycle:",
        '  kind: "reusable"',
        "  deprecated: true",
        '  superseded_by: "new-template"',
        "",
      ].join("\n"),
    );
    writeManifest(project, []);

    const result = gc({
      projectRoot: project,
      now: () => new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(result.summary.userAuthored).toBe(1);
    expect(result.summary.reviewUserAuthored).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      origin: "user-authored",
      recommendation: "review-user-authored",
      reasons: ["deprecated-reusable", "superseded-reusable"],
    });
  });

  it("reports current and reusable count pressure plus disk budget pressure", () => {
    const project = tmpDir("anamnesis-gc-budget-");
    for (const name of ["a", "b", "c"]) {
      writeHarness(
        project,
        `current-${name}`,
        [
          'schema_version: "anamnesis.task_harness.v1"',
          `id: "current-${name}"`,
          "lifecycle:",
          '  kind: "current"',
          `  last_used: "2026-06-0${name === "a" ? "1" : name === "b" ? "2" : "3"}T00:00:00.000Z"`,
          "padding: " + "x".repeat(80),
          "",
        ].join("\n"),
      );
    }
    writeHarness(
      project,
      "deprecated",
      [
        'schema_version: "anamnesis.task_harness.v1"',
        'id: "deprecated"',
        "lifecycle:",
        '  kind: "reusable"',
        "  deprecated: true",
        "padding: " + "x".repeat(80),
        "",
      ].join("\n"),
    );
    writeManifest(project, [
      ".anamnesis/task-harnesses/current-a.yaml",
      ".anamnesis/task-harnesses/current-b.yaml",
      ".anamnesis/task-harnesses/current-c.yaml",
      ".anamnesis/task-harnesses/deprecated.yaml",
    ]);

    const result = gc({
      projectRoot: project,
      maxCurrentHarnesses: 2,
      maxTotalBytes: 100,
      now: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    expect(result.summary.diskBudgetExceeded).toBe(true);
    expect(
      result.candidates.some((candidate) =>
        candidate.reasons.includes("current-over-count"),
      ),
    ).toBe(true);
    expect(
      result.candidates.some((candidate) =>
        candidate.reasons.includes("disk-budget-exceeded"),
      ),
    ).toBe(true);
  });

  it("refuses apply mode because deletion is not implemented yet", () => {
    const project = tmpDir("anamnesis-gc-apply-");

    expect(() => gc({ projectRoot: project, apply: true })).toThrow(GcError);
  });
});
