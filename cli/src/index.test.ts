import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const indexPath = path.join(repoRoot, "cli/src/index.ts");

describe("CLI entrypoint", () => {
  it("prints the getting-started guide with no command", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", indexPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Get started:");
    expect(result.stdout).toContain("anamnesis init --dry-run");
    expect(result.stdout).toContain("anamnesis --help");
    expect(result.stdout).not.toContain("benchmark task-series");
  });

  it("keeps the full command reference behind --help", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", indexPath, "--help"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("benchmark task-series");
  });

  it("prints first-install next steps after init reports", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-cli-init-"));
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        indexPath,
        "init",
        "--project-root",
        project,
        "--tools",
        "all",
        "--allow-exec-adapters",
        "--dry-run",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("  next steps:");
    expect(result.stdout).toContain(
      "apply reviewed plan: anamnesis init --tools all --allow-exec-adapters",
    );
    expect(result.stdout).toContain("semantic ontology: /ontology-enrich");
    expect(result.stdout).toContain("task handoff: /handoff-prepare");
  });
});
