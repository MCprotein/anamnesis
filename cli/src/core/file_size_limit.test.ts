import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FileSizePolicy = {
  maxLines: 2000,
  excludedPrefixes: [
    "cli/dist/",
    "docs/benchmark-evidence/",
    "base/.versions/",
    ".anamnesis/backups/",
    "_workspace/",
  ],
  excludedNames: ["package-lock.json"],
} as const;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function isChecked(file: string): boolean {
  if (FileSizePolicy.excludedPrefixes.some((prefix) => file.startsWith(prefix)))
    return false;
  return !FileSizePolicy.excludedNames.some(
    (name) => path.basename(file) === name,
  );
}

function lineCount(absPath: string): number {
  const text = fs.readFileSync(absPath, "utf8");
  return text.split("\n").length - 1;
}

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\0").filter((file) => file.length > 0);
}

describe("file size limit", () => {
  it(`keeps every hand-written tracked file at ${FileSizePolicy.maxLines} lines or fewer`, () => {
    const oversized = trackedFiles()
      .filter(isChecked)
      .map((file) => ({ file, abs: path.join(repoRoot, file) }))
      .filter(({ abs }) => fs.existsSync(abs) && fs.statSync(abs).isFile())
      .map(({ file, abs }) => ({ file, lines: lineCount(abs) }))
      .filter(({ lines }) => lines > FileSizePolicy.maxLines)
      .map(({ file, lines }) => `${file}: ${lines}`);
    expect(oversized).toEqual([]);
  });

  it("excludes only generated or archived paths", () => {
    expect(isChecked("cli/src/index.ts")).toBe(true);
    expect(isChecked("docs/ROADMAP.md")).toBe(true);
    expect(isChecked("package-lock.json")).toBe(false);
    expect(isChecked("docs/benchmark-evidence/a/results.json")).toBe(false);
    expect(isChecked("cli/dist/index.js")).toBe(false);
    expect(isChecked("base/.versions/x/AGENTS.md")).toBe(false);
    expect(isChecked("_workspace/notes.md")).toBe(false);
    expect(isChecked(".anamnesis/backups/a.md")).toBe(false);
  });
});
