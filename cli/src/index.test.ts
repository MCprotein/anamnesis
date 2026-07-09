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

function writeMinimalAgentfile(project: string): void {
  fs.writeFileSync(
    path.join(project, "Agentfile"),
    `version: 1
project:
  name: fixture
tools:
  - claude-code
fragments:
  - id: base
    version: 1
`,
  );
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

describe("CLI entrypoint", () => {
  it("prints the getting-started guide with no command", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", indexPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Start");
    expect(result.stdout).toContain("anamnesis init --dry-run");
    expect(result.stdout).toContain("anamnesis --help");
    expect(result.stdout).not.toContain("benchmark task-series");
  });

  it("keeps compact command help behind --help", () => {
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
    expect(result.stdout).toContain("Core Commands");
    expect(result.stdout).toContain("Workflow Namespaces");
    expect(result.stdout).toContain("apply");
    expect(result.stdout).toContain("Deprecated compatibility command for apply");
    expect(result.stdout).not.toContain("benchmark task-series");
  });

  it("keeps the full command reference behind --help --all", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", indexPath, "--help", "--all"],
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

  it("prints namespace help for bare advanced namespaces", () => {
    for (const namespace of ["context", "handoff", "benchmark"]) {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", indexPath, namespace],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`anamnesis ${namespace}`);
      expect(result.stdout).toContain("Subcommands");
      expect(result.stdout).not.toContain("unknown");
    }
  });

  it("prints context docs JSON from the CLI", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-cli-docs-"));
    writeFile(project, "README.md", "# Fixture\n\nSee [Guide](docs/guide.md).\n");
    writeFile(project, "docs/guide.md", "# Guide\n");

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        indexPath,
        "context",
        "docs",
        "--project-root",
        project,
        "--json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as {
      schema_version: string;
      summary: { pages: number; brokenLinks: number };
    };
    expect(parsed.schema_version).toBe("anamnesis.context_docs.v1");
    expect(parsed.summary.pages).toBe(2);
    expect(parsed.summary.brokenLinks).toBe(0);
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

  it("previews project changes through apply --dry-run", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-cli-apply-"));
    writeMinimalAgentfile(project);

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        indexPath,
        "apply",
        "--project-root",
        project,
        "--library",
        repoRoot,
        "--dry-run",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("anamnesis apply");
    expect(result.stdout).toContain("fixture");
    expect(result.stdout).toContain("mode");
    expect(result.stdout).toContain("preview");
    expect(result.stdout).toContain("dry-run");
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(false);
  });

  it("applies project changes by default through apply", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-cli-apply-write-"));
    writeMinimalAgentfile(project);

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        indexPath,
        "apply",
        "--project-root",
        project,
        "--library",
        repoRoot,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("anamnesis apply");
    expect(result.stdout).toContain("fixture");
    expect(result.stdout).toContain("applied");
    expect(result.stdout).toContain("evidence:");
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(true);
  });

  it("keeps update as a deprecated compatibility command", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-cli-update-"));
    writeMinimalAgentfile(project);

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        indexPath,
        "update",
        "--project-root",
        project,
        "--library",
        repoRoot,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("`anamnesis update` is deprecated");
    expect(result.stdout).toContain("anamnesis update");
    expect(result.stdout).toContain("fixture");
    expect(result.stdout).toContain("preview");
    expect(result.stdout).toContain("use `anamnesis apply` to write");
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(false);
  });
});
