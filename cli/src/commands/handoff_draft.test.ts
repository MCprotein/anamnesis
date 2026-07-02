import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendEvidenceRecord, EVIDENCE_SCHEMA_VERSION } from "../core/evidence.js";
import { handoffDraft, type HandoffDraftRunner } from "./handoff_draft.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

describe("handoffDraft", () => {
  it("writes a semantic confirmation draft from git, evidence, and handoff pointers", () => {
    const project = tmpDir("anamnesis-handoff-draft-");
    writeFile(
      project,
      ".anamnesis/handoff/2026-07-01T00-00-00Z.md",
      "# Handoff - previous\n",
    );
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- continue draft fixture - archive: `.anamnesis/handoff/2026-07-01T00-00-00Z.md`",
        "",
      ].join("\n"),
    );
    appendEvidenceRecord(project, {
      schema_version: EVIDENCE_SCHEMA_VERSION,
      kind: "dogfood-check",
      generated_at: "2026-07-01T01:00:00.000Z",
      command: ["anamnesis", "dogfood", "check"],
      project: { name: "draft-fixture" },
      summary: {
        ok: true,
        score: "5/5",
      },
    });
    const runner: HandoffDraftRunner = (_command, args) => {
      const key = args.join(" ");
      if (key === "rev-parse HEAD") {
        return { status: 0, stdout: "abc123\n" };
      }
      if (key === "log --oneline -5") {
        return { status: 0, stdout: "abc123 current work\nbbb222 previous\n" };
      }
      if (key === "status --porcelain --untracked-files=all") {
        return {
          status: 0,
          stdout: " M cli/src/index.ts\n?? .env\n?? notes.md\n",
        };
      }
      return { status: 1, stdout: "" };
    };

    const result = handoffDraft({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
      runner,
    });

    expect(result.writtenPath).toBe(".anamnesis/handoff/drafts/latest.md");
    expect(result.gitRef).toBe("abc123");
    expect(result.recentCommits).toHaveLength(2);
    expect(result.touchedFiles).toEqual([
      { status: "M", path: "cli/src/index.ts" },
      { status: "??", path: "notes.md" },
    ]);
    expect(result.latestEvidence).toMatchObject({
      kind: "dogfood-check",
      summary: "ok=true, score=5/5",
    });
    const written = fs.readFileSync(
      path.join(project, ".anamnesis", "handoff", "drafts", "latest.md"),
      "utf8",
    );
    expect(written).toContain("draft: true");
    expect(written).toContain("active_handoff: .anamnesis/handoff/active.md");
    expect(written).toContain(
      "latest_archive: .anamnesis/handoff/2026-07-01T00-00-00Z.md",
    );
    expect(written).toContain("TODO(agent): summarize the user objective");
    expect(written).toContain("Finalization rule");
    expect(written.endsWith("\n")).toBe(true);
  });
});
