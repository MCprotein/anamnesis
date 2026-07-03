import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init } from "./init.js";
import { releaseCheck } from "./release_check.js";
import { update } from "./update.js";
import { readAgentfile } from "../core/agentfile.js";
import { upsertRegion } from "../core/regions.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupReleaseProject(): { project: string; library: string } {
  const library = process.cwd();
  const project = tmpDir("anamnesis-release-check-");
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: true,
    noBootstrap: true,
    tools: ["claude-code"],
  });
  update({
    projectRoot: project,
    libraryRoot: library,
    apply: true,
    allowExecAdapters: true,
    now: () => new Date("2026-07-03T00:00:00.000Z"),
  });
  return { project, library };
}

describe("release check", () => {
  it("passes a clean managed project and can append runtime evidence", () => {
    const { project, library } = setupReleaseProject();

    const result = releaseCheck({
      projectRoot: project,
      libraryRoot: library,
      append: true,
      now: () => new Date("2026-07-03T00:05:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.summary.fail).toBe(0);
    expect(result.evidencePath).toBe(".anamnesis/evidence/events.jsonl");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "update-dry-run-clean",
          status: "pass",
        }),
        expect.objectContaining({
          id: "hook-registration",
          status: "pass",
        }),
        expect.objectContaining({
          id: "published-upgrade-smoke",
          status: "skip",
        }),
      ]),
    );

    const evidenceLines = fs
      .readFileSync(
        path.join(project, ".anamnesis", "evidence", "events.jsonl"),
        "utf8",
      )
      .trim()
      .split(/\r?\n/);
    const latest = JSON.parse(evidenceLines.at(-1)!) as {
      kind: string;
      summary: Record<string, unknown>;
    };
    expect(latest).toMatchObject({
      kind: "release-check",
      summary: {
        ok: true,
        fail: 0,
      },
    });
  });

  it("fails when managed surfaces have unmerged local edits", () => {
    const { project, library } = setupReleaseProject();
    const agentsPath = path.join(project, "AGENTS.md");
    fs.writeFileSync(
      agentsPath,
      upsertRegion(fs.readFileSync(agentsPath, "utf8"), {
        id: "anamnesis-base",
        fragmentId: "base",
        fragmentVersion:
          readAgentfile(project).fragments.find((f) => f.id === "base")!.version,
        content: "USER-MODIFIED RELEASE CHECK FIXTURE\n",
      }),
    );

    const result = releaseCheck({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-07-03T00:10:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "update-dry-run-clean",
          status: "fail",
        }),
        expect.objectContaining({
          id: "manifest-drift",
          status: "fail",
        }),
      ]),
    );
  });
});
