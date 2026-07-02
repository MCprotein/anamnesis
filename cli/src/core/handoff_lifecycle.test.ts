import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { analyzeHandoffLifecycle } from "./handoff_lifecycle.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-handoff-life-"));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function writeHandoff(project: string, name: string, body: string): string {
  const relPath = `.anamnesis/handoff/${name}`;
  writeFile(project, relPath, body);
  return relPath;
}

describe("handoff lifecycle analysis", () => {
  it("classifies active, warm, cold, and deprecated handoff artifacts", () => {
    const project = tmpProject();
    const activeArchive = writeHandoff(
      project,
      "2026-07-01T00-00-00Z.md",
      [
        "---",
        "created: 2026-07-01T00:00:00.000Z",
        "---",
        "# Handoff - active",
        "",
      ].join("\n"),
    );
    writeHandoff(
      project,
      "2026-01-01T00-00-00Z.md",
      [
        "---",
        "handoff_status: closed",
        "closed_at: 2026-01-01T00:00:00.000Z",
        "---",
        "# Handoff - old",
        "",
      ].join("\n"),
    );
    writeHandoff(
      project,
      "2026-02-01T00-00-00Z.md",
      [
        "---",
        "handoff_status: superseded",
        "superseded_by: .anamnesis/handoff/2026-07-01T00-00-00Z.md",
        "---",
        "# Handoff - superseded",
        "",
      ].join("\n"),
    );
    writeHandoff(
      project,
      "active.md",
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
    writeHandoff(project, "draft.md", "# Handoff Draft - not finalized\n");

    const report = analyzeHandoffLifecycle({
      projectRoot: project,
      now: new Date("2026-07-02T00:00:00.000Z"),
      thresholds: {
        maxWarmArchives: 0,
        maxColdAgeDays: 30,
        maxTotalBytes: 1024 * 1024,
      },
    });

    expect(report.summary).toMatchObject({
      activeIndex: 1,
      archives: 3,
      hot: 1,
      warm: 1,
      cold: 1,
      deprecated: 1,
      activeReferences: 1,
      protectedByActiveReference: 1,
      candidates: 2,
    });
    expect(report.entries.find((entry) => entry.path === activeArchive)).toMatchObject({
      tier: "warm",
      activeReferenced: true,
    });
    expect(report.candidates.map((candidate) => candidate.path)).toEqual([
      ".anamnesis/handoff/2026-02-01T00-00-00Z.md",
      ".anamnesis/handoff/2026-01-01T00-00-00Z.md",
    ]);
    expect(report.candidates[0]?.reasons).toEqual([
      "deprecated-handoff",
      "superseded-handoff",
    ]);
    expect(report.candidates[1]?.reasons).toEqual(["handoff-over-age"]);
  });

  it("uses disk budget pressure only against non-active cold or deprecated archives", () => {
    const project = tmpProject();
    const activeArchive = writeHandoff(
      project,
      "2026-07-01T00-00-00Z.md",
      `# Handoff - active\n\n${"x".repeat(200)}\n`,
    );
    writeHandoff(
      project,
      "2026-06-01T00-00-00Z.md",
      [
        "---",
        "retention_tier: cold",
        "last_referenced_at: 2026-06-01T00:00:00.000Z",
        "---",
        `# Handoff - cold\n\n${"y".repeat(200)}\n`,
      ].join("\n"),
    );
    writeHandoff(
      project,
      "active.md",
      `# Active handoff index\n\n- current - archive: \`${activeArchive}\`\n`,
    );

    const report = analyzeHandoffLifecycle({
      projectRoot: project,
      now: new Date("2026-07-02T00:00:00.000Z"),
      thresholds: {
        maxWarmArchives: 0,
        maxColdAgeDays: 90,
        maxTotalBytes: 100,
      },
    });

    expect(report.summary.diskBudgetExceeded).toBe(true);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      path: ".anamnesis/handoff/2026-06-01T00-00-00Z.md",
      tier: "cold",
      reasons: ["handoff-disk-budget-exceeded"],
    });
    expect(
      report.candidates.some((candidate) => candidate.path === activeArchive),
    ).toBe(false);
  });

  it("does not treat recently completed pointers as active references", () => {
    const project = tmpProject();
    const closedArchive = writeHandoff(
      project,
      "2026-06-01T00-00-00Z.md",
      [
        "---",
        "handoff_status: closed",
        "retention_tier: cold",
        "closed_at: 2026-06-01T00:00:00.000Z",
        "---",
        "# Handoff - closed",
        "",
      ].join("\n"),
    );
    writeHandoff(
      project,
      "active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "",
        "## Active tasks",
        "",
        "## Recently completed",
        `- completed task - archive: \`${closedArchive}\``,
        "",
      ].join("\n"),
    );

    const report = analyzeHandoffLifecycle({
      projectRoot: project,
      now: new Date("2026-07-02T00:00:00.000Z"),
      thresholds: {
        maxWarmArchives: 0,
        maxColdAgeDays: 1,
        maxTotalBytes: 1024 * 1024,
      },
    });

    expect(report.summary.activeReferences).toBe(0);
    expect(report.summary.protectedByActiveReference).toBe(0);
    expect(report.entries.find((entry) => entry.path === closedArchive)).toMatchObject({
      tier: "cold",
      activeReferenced: false,
    });
    expect(report.candidates.map((candidate) => candidate.path)).toEqual([
      closedArchive,
    ]);
  });
});
