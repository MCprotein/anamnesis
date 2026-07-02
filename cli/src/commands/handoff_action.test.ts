import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handoffAction, HandoffActionError } from "./handoff_action.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

describe("handoffAction", () => {
  it("closes an active handoff archive and removes it from active startup sections", () => {
    const project = tmpDir("anamnesis-handoff-close-");
    const archive = ".anamnesis/handoff/2026-07-01T00-00-00Z.md";
    writeFile(
      project,
      archive,
      [
        "---",
        "created: 2026-07-01T00:00:00.000Z",
        "agent: codex",
        "---",
        "",
        "# Handoff - close me",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "---",
        "updated: 2026-07-01T00:00:00.000Z",
        "---",
        "",
        "# Active handoff index",
        "",
        "## Current focus",
        `- finish lifecycle workflow — archive: \`${archive}\``,
        "",
        "## Active tasks",
        "- [in-flight] other task — next: continue — archive: `.anamnesis/handoff/other.md`",
        "",
        "## Recently completed",
        "- old task — completed in abc123",
        "",
      ].join("\n"),
    );

    const result = handoffAction({
      projectRoot: project,
      mode: "close",
      archive,
      apply: true,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(result.applied).toBe(true);
    expect(result.handoffStatus).toBe("closed");
    expect(result.retentionTier).toBe("cold");
    expect(result.removedActiveEntries).toEqual([
      `finish lifecycle workflow — archive: \`${archive}\``,
    ]);
    expect(result.writtenPaths).toEqual([
      archive,
      ".anamnesis/handoff/active.md",
    ]);
    const archiveText = fs.readFileSync(path.join(project, archive), "utf8");
    expect(archiveText).toContain("handoff_status: closed");
    expect(archiveText).toContain("retention_tier: cold");
    expect(archiveText).toContain("closed_at: 2026-07-02T00:00:00.000Z");
    const activeText = fs.readFileSync(
      path.join(project, ".anamnesis", "handoff", "active.md"),
      "utf8",
    );
    expect(activeText).not.toContain("## Current focus\n- finish lifecycle workflow");
    expect(activeText).toContain(
      `- finish lifecycle workflow — closed at 2026-07-02T00:00:00.000Z — archive: \`${archive}\``,
    );
    expect(activeText).toContain("other task");
  });

  it("previews deprecating a superseded archive without writing by default", () => {
    const project = tmpDir("anamnesis-handoff-deprecate-");
    const archive = ".anamnesis/handoff/2026-06-01T00-00-00Z.md";
    const supersededBy = ".anamnesis/handoff/2026-07-01T00-00-00Z.md";
    writeFile(project, archive, "# Handoff - stale\n");
    writeFile(project, supersededBy, "# Handoff - replacement\n");
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      `# Active handoff index\n\n## Active tasks\n- [blocked] stale task — archive: \`${archive}\`\n`,
    );

    const result = handoffAction({
      projectRoot: project,
      mode: "deprecate",
      archive,
      supersededBy,
      summary: "stale task",
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(result.applied).toBe(false);
    expect(result.handoffStatus).toBe("superseded");
    expect(result.retentionTier).toBe("deprecated");
    expect(result.changed).toEqual({
      archiveFrontmatter: true,
      activeHandoff: true,
    });
    expect(result.writtenPaths).toEqual([]);
    expect(result.preview).toContain("dry-run");
    expect(fs.readFileSync(path.join(project, archive), "utf8")).toBe(
      "# Handoff - stale\n",
    );
  });

  it("does not update active.md when the target archive is not active", () => {
    const project = tmpDir("anamnesis-handoff-inactive-");
    const archive = ".anamnesis/handoff/2026-06-01T00-00-00Z.md";
    writeFile(project, archive, "# Handoff - old\n");
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      "# Active handoff index\n\n## Current focus\n- current task — archive: `.anamnesis/handoff/current.md`\n",
    );

    const result = handoffAction({
      projectRoot: project,
      mode: "deprecate",
      archive,
      apply: true,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(result.removedActiveEntries).toEqual([]);
    expect(result.changed.activeHandoff).toBe(false);
    expect(result.writtenPaths).toEqual([archive]);
    expect(
      fs.readFileSync(path.join(project, ".anamnesis", "handoff", "active.md"), "utf8"),
    ).not.toContain("2026-06-01T00-00-00Z.md");
  });

  it("rejects active and draft paths as lifecycle action targets", () => {
    const project = tmpDir("anamnesis-handoff-invalid-");

    expect(() =>
      handoffAction({
        projectRoot: project,
        mode: "close",
        archive: ".anamnesis/handoff/active.md",
      }),
    ).toThrow(HandoffActionError);
    expect(() =>
      handoffAction({
        projectRoot: project,
        mode: "close",
        archive: ".anamnesis/handoff/drafts/latest.md",
      }),
    ).toThrow(HandoffActionError);
  });
});
