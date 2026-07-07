import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeHandoffOpenTaskLines,
  extractArchiveRefs,
  isCompletedHandoffTaskLine,
  newestHandoffArchive,
} from "./handoff_active_text.js";

describe("activeHandoffOpenTaskLines", () => {
  it("collects bullet lines under Current focus and Active tasks", () => {
    const text = [
      "# Active handoff index",
      "",
      "## Current focus",
      "- focus line one",
      "",
      "## Active tasks",
      "- [in-flight] task one",
      "- [blocked] task two",
      "",
      "## Recently completed",
      "- not collected",
    ].join("\n");

    expect(activeHandoffOpenTaskLines(text)).toEqual([
      "- focus line one",
      "- [in-flight] task one",
      "- [blocked] task two",
    ]);
  });

  it("returns an empty array when the open sections have no bullets", () => {
    const text = ["## Current focus", "", "## Active tasks", "", "## Recently completed", "- x"].join("\n");
    expect(activeHandoffOpenTaskLines(text)).toEqual([]);
  });

  it("ignores non-bullet lines inside an open section", () => {
    const text = ["## Active tasks", "not a bullet", "- [in-flight] real task"].join("\n");
    expect(activeHandoffOpenTaskLines(text)).toEqual(["- [in-flight] real task"]);
  });
});

describe("isCompletedHandoffTaskLine", () => {
  it.each([
    ["- task [done]", true],
    ["- task [completed]", true],
    ["- task [closed]", true],
    ["- task [deprecated]", true],
    ["- task [superseded]", true],
    ["- task completed in v1.9", true],
    ["- task closed at 2026-07-01", true],
    ["- task deprecated by v2.0", true],
    ["- task superseded by newer plan", true],
    ["- [in-flight] still working", false],
  ])("classifies %j as completed=%s", (line, expected) => {
    expect(isCompletedHandoffTaskLine(line)).toBe(expected);
  });
});

describe("extractArchiveRefs", () => {
  it("extracts backtick-quoted archive references", () => {
    const text = "- task — archive: `.anamnesis/handoff/2026-07-01T00-00-00Z.md`";
    expect(extractArchiveRefs(text)).toEqual([".anamnesis/handoff/2026-07-01T00-00-00Z.md"]);
  });

  it("extracts bare archive references and strips trailing punctuation", () => {
    const text = "- task — archive: .anamnesis/handoff/2026-07-01T00-00-00Z.md.";
    expect(extractArchiveRefs(text)).toEqual([".anamnesis/handoff/2026-07-01T00-00-00Z.md"]);
  });

  it("dedupes and sorts references", () => {
    const text = [
      "- archive: `.anamnesis/handoff/b.md`",
      "- archive: `.anamnesis/handoff/a.md`",
      "- archive: `.anamnesis/handoff/b.md`",
    ].join("\n");
    expect(extractArchiveRefs(text)).toEqual([
      ".anamnesis/handoff/a.md",
      ".anamnesis/handoff/b.md",
    ]);
  });

  it("returns an empty array when there are no archive references", () => {
    expect(extractArchiveRefs("- plain task with no archive")).toEqual([]);
  });
});

describe("newestHandoffArchive", () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-active-text-"));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  function writeArchive(name: string, mtime: Date): void {
    const dir = path.join(project, ".anamnesis", "handoff");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, "content", "utf8");
    fs.utimesSync(file, mtime, mtime);
  }

  it("returns undefined when the handoff directory does not exist", () => {
    expect(newestHandoffArchive(project)).toBeUndefined();
  });

  it("excludes active.md by default", () => {
    writeArchive("active.md", new Date("2026-07-02T00:00:00.000Z"));
    expect(newestHandoffArchive(project)).toBeUndefined();
  });

  it("picks the archive with the most recent mtime", () => {
    writeArchive("2026-07-01T00-00-00Z.md", new Date("2026-07-01T00:00:00.000Z"));
    writeArchive("2026-07-02T00-00-00Z.md", new Date("2026-07-02T00:00:00.000Z"));
    writeArchive("active.md", new Date("2026-07-03T00:00:00.000Z"));

    const newest = newestHandoffArchive(project);
    expect(newest?.rel).toBe(".anamnesis/handoff/2026-07-02T00-00-00Z.md");
  });

  it("breaks mtime ties deterministically by rel path", () => {
    const sameTime = new Date("2026-07-01T00:00:00.000Z");
    writeArchive("b.md", sameTime);
    writeArchive("a.md", sameTime);

    const newest = newestHandoffArchive(project);
    expect(newest?.rel).toBe(".anamnesis/handoff/a.md");
  });

  it("respects a custom exclude list", () => {
    writeArchive("draft.md", new Date("2026-07-02T00:00:00.000Z"));
    writeArchive("2026-07-01T00-00-00Z.md", new Date("2026-07-01T00:00:00.000Z"));

    const newest = newestHandoffArchive(project, {
      exclude: ["active.md", "draft.md"],
    });
    expect(newest?.rel).toBe(".anamnesis/handoff/2026-07-01T00-00-00Z.md");
  });
});
