import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gc, GcError } from "./gc.js";
import { EVIDENCE_LOG_PATH } from "../core/evidence.js";
import { readManifest } from "../core/manifest.js";
import { sha256 } from "../util/hash.js";

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

function writeManagedHarness(
  project: string,
  name: string,
  body: string,
  opts: { userModified?: boolean } = {},
): void {
  const relPath = `.anamnesis/task-harnesses/${name}.yaml`;
  writeFile(project, relPath, body);
  const appliedHash = sha256(body);
  if (opts.userModified) {
    writeFile(project, relPath, `${body}# user note\n`);
  }
  writeFile(
    project,
    ".anamnesis/manifest.json",
    JSON.stringify(
      {
        version: 1,
        regions: [],
        files: [
          {
            path: relPath,
            fragment_id: "base",
            fragment_version: 14,
            last_applied_hash: appliedHash,
            current_user_hash: appliedHash,
          },
        ],
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

  it("reports handoff lifecycle candidates without deleting active references", () => {
    const project = tmpDir("anamnesis-gc-handoff-");
    const activeArchive = ".anamnesis/handoff/2026-07-01T00-00-00Z.md";
    writeFile(
      project,
      activeArchive,
      [
        "---",
        "created: 2026-07-01T00:00:00.000Z",
        "---",
        "# Handoff - active",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/2026-01-01T00-00-00Z.md",
      [
        "---",
        "handoff_status: closed",
        "closed_at: 2026-01-01T00:00:00.000Z",
        "---",
        "# Handoff - old",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/2026-02-01T00-00-00Z.md",
      [
        "---",
        "handoff_status: superseded",
        `superseded_by: ${activeArchive}`,
        "---",
        "# Handoff - superseded",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "---",
        "updated: 2026-07-02T00:00:00.000Z",
        "---",
        "# Active handoff index",
        "",
        "## Current focus",
        `- continue task - archive: \`${activeArchive}\``,
        "",
      ].join("\n"),
    );

    const result = gc({
      projectRoot: project,
      maxWarmHandoffArchives: 1,
      maxColdHandoffAgeDays: 30,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(result.handoff.summary).toMatchObject({
      archives: 3,
      activeReferences: 1,
      protectedByActiveReference: 1,
      candidates: 2,
      reviewUserAuthored: 2,
    });
    expect(result.handoff.candidates.map((candidate) => candidate.path)).toEqual([
      ".anamnesis/handoff/2026-02-01T00-00-00Z.md",
      ".anamnesis/handoff/2026-01-01T00-00-00Z.md",
    ]);
    expect(
      result.handoff.candidates.some((candidate) => candidate.path === activeArchive),
    ).toBe(false);
  });

  it("apply deletes clean managed harness candidates and updates manifest", () => {
    const project = tmpDir("anamnesis-gc-apply-");
    writeManagedHarness(
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

    const result = gc({
      projectRoot: project,
      apply: true,
      maxCurrentAgeDays: 14,
      now: () => new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(result.mode).toBe("apply");
    expect(result.applied).toBe(true);
    expect(result.deleted.taskHarnesses).toEqual([
      ".anamnesis/task-harnesses/old-current.yaml",
    ]);
    expect(result.backedUpTaskHarnesses).toEqual([
      ".anamnesis/task-harnesses/old-current.yaml",
    ]);
    expect(result.backupDir).toBe(
      ".anamnesis/backups/gc-2026-06-27T00-00-00-000Z",
    );
    expect(
      fs.existsSync(
        path.join(project, ".anamnesis/task-harnesses/old-current.yaml"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          project,
          ".anamnesis/backups/gc-2026-06-27T00-00-00-000Z/.anamnesis/task-harnesses/old-current.yaml",
        ),
      ),
    ).toBe(true);
    expect(readManifest(project).files).toEqual([]);
    expect(
      fs.existsSync(path.join(project, EVIDENCE_LOG_PATH)),
    ).toBe(true);
    expect(fs.readFileSync(path.join(project, EVIDENCE_LOG_PATH), "utf8")).toContain(
      '"kind":"gc-apply"',
    );
  });

  it("apply keeps user-authored, user-modified, and handoff candidates review-only", () => {
    const project = tmpDir("anamnesis-gc-apply-safe-");
    const managedBody = [
      'schema_version: "anamnesis.task_harness.v1"',
      'id: "managed-edited"',
      "lifecycle:",
      '  kind: "current"',
      '  last_used: "2026-06-01T00:00:00.000Z"',
      "",
    ].join("\n");
    writeManagedHarness(project, "managed-edited", managedBody, {
      userModified: true,
    });
    writeHarness(
      project,
      "user-template",
      [
        'schema_version: "anamnesis.task_harness.v1"',
        'id: "user-template"',
        "lifecycle:",
        '  kind: "reusable"',
        "  deprecated: true",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/2026-01-01T00-00-00Z.md",
      [
        "---",
        "handoff_status: deprecated",
        "retention_tier: deprecated",
        "---",
        "# Handoff - old",
        "",
      ].join("\n"),
    );

    const result = gc({
      projectRoot: project,
      apply: true,
      maxCurrentAgeDays: 14,
      maxColdHandoffAgeDays: 1,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(result.deleted.taskHarnesses).toEqual([]);
    expect(result.skipped.userAuthoredTaskHarnesses).toEqual([
      ".anamnesis/task-harnesses/user-template.yaml",
    ]);
    expect(result.skipped.userModifiedTaskHarnesses).toEqual([
      ".anamnesis/task-harnesses/managed-edited.yaml",
    ]);
    expect(result.skipped.handoffs).toEqual([
      ".anamnesis/handoff/2026-01-01T00-00-00Z.md",
    ]);
    expect(
      fs.existsSync(
        path.join(project, ".anamnesis/task-harnesses/managed-edited.yaml"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".anamnesis/task-harnesses/user-template.yaml"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(project, ".anamnesis/handoff/2026-01-01T00-00-00Z.md"),
      ),
    ).toBe(true);
  });

  it("rejects conflicting dry-run and apply flags", () => {
    const project = tmpDir("anamnesis-gc-flags-");

    expect(() => gc({ projectRoot: project, dryRun: true, apply: true })).toThrow(
      GcError,
    );
  });
});
