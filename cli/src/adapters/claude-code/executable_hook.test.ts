import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executableHookRenderer } from "./executable_hook.js";
import { RenderError, type RenderContext } from "../../core/render.js";
import type { FragmentDefinition } from "../../core/fragments.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-hook-"));
}

function makeContext(
  fragmentDir: string,
  fragment: FragmentDefinition = {
    id: "prisma",
    version: 1,
    requires: [],
    conflicts: [],
    owns: [],
    capabilities: [
      {
        type: "executable_hook",
        event: "PostToolUse:Edit",
        source: "adapters/claude-code/hooks/prisma-validate.sh",
        adapters_supported: ["claude-code"],
      },
    ],
  },
): RenderContext {
  return {
    fragment,
    fragmentDir,
    projectRoot: "/tmp/project",
    settings: {
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
    },
    params: {},
  };
}

describe("executableHookRenderer (claude-code)", () => {
  let fragmentDir: string;
  const hookPath = "adapters/claude-code/hooks/prisma-validate.sh";

  beforeEach(() => {
    fragmentDir = tmpDir();
    fs.mkdirSync(path.join(fragmentDir, "adapters/claude-code/hooks"), {
      recursive: true,
    });
  });

  it("emits FileAction to .claude/hooks/<basename> with mode 0o755", () => {
    fs.writeFileSync(
      path.join(fragmentDir, hookPath),
      "#!/bin/bash\necho hi\n",
    );
    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "PostToolUse:Edit",
        source: hookPath,
        adapters_supported: ["claude-code"],
      },
      makeContext(fragmentDir),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("file");
    if (actions[0]!.kind === "file") {
      expect(actions[0]!.path).toBe(".claude/hooks/prisma-validate.sh");
      expect(actions[0]!.mode).toBe(0o755);
      expect(actions[0]!.content).toContain("#!/bin/bash");
      expect(actions[0]!.sideEffects).toEqual(["local-write"]);
    }
  });

  it("propagates declared hook side effects", () => {
    fs.writeFileSync(
      path.join(fragmentDir, hookPath),
      "#!/bin/bash\necho hi\n",
    );
    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "PostToolUse:Edit",
        source: hookPath,
        adapters_supported: ["claude-code"],
        side_effects: ["read-only", "git-hook"],
      },
      makeContext(fragmentDir),
    );
    expect(actions[0]?.kind).toBe("file");
    if (actions[0]?.kind === "file") {
      expect(actions[0].sideEffects).toEqual(["read-only", "git-hook"]);
    }
  });

  it("throws when hook source is missing", () => {
    expect(() =>
      executableHookRenderer.plan(
        {
          type: "executable_hook",
          event: "PostToolUse:Edit",
          source: "adapters/claude-code/hooks/missing.sh",
          adapters_supported: ["claude-code"],
        },
        makeContext(fragmentDir),
      ),
    ).toThrow(RenderError);
  });

  it("throws when given a non-executable_hook capability", () => {
    fs.writeFileSync(path.join(fragmentDir, hookPath), "x\n");
    expect(() =>
      executableHookRenderer.plan(
        { type: "ontology", source: "o.yaml" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/wrong capability type/);
  });

  it("points to user-managed system_graph.yaml before managed ontology slices", () => {
    if (process.platform === "win32") return;

    const projectRoot = tmpDir();
    fs.mkdirSync(path.join(projectRoot, ".anamnesis/ontology"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(projectRoot, "configs"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".anamnesis/ontology/base.yaml"),
      "managed_by: anamnesis\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectRoot, "configs/system_graph.yaml"),
      "project: forecasting\n",
      "utf8",
    );
    fs.symlinkSync(
      "configs/system_graph.yaml",
      path.join(projectRoot, "system_graph.yaml"),
    );

    const hook = path.resolve(
      "base/adapters/claude-code/hooks/inject-ontology.sh",
    );
    const result = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Mode: compact");
    expect(result.stdout).toContain("Source pointers:");
    expect(result.stdout).toContain(
      "- system_graph.yaml (user-managed top-level ontology;",
    );
    expect(result.stdout).toContain(
      "- .anamnesis/ontology/base.yaml (managed ontology slice;",
    );
    expect(result.stdout).not.toContain("project: forecasting");
    expect(result.stdout.indexOf("- system_graph.yaml")).toBeLessThan(
      result.stdout.indexOf("- .anamnesis/ontology/base.yaml"),
    );

    const full = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectRoot,
        ANAMNESIS_SESSION_CONTEXT_MODE: "full",
      },
      encoding: "utf8",
    });

    expect(full.status).toBe(0);
    expect(full.stderr).toBe("");
    expect(full.stdout).toContain("--- system_graph.yaml (user-managed) ---");
    expect(full.stdout).toContain("project: forecasting");
    expect(full.stdout).toContain("--- .anamnesis/ontology/base.yaml ---");
    expect(full.stdout.indexOf("--- system_graph.yaml")).toBeLessThan(
      full.stdout.indexOf("--- .anamnesis/ontology/base.yaml ---"),
    );
  });

  it("excludes closed recently completed archives from handoff SessionStart context", () => {
    if (process.platform === "win32") return;

    const projectRoot = tmpDir();
    const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(
      path.join(handoffDir, "active.md"),
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "",
        "## Active tasks",
        "",
        "## Recently completed",
        "- completed task — archive: `.anamnesis/handoff/closed.md`",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(handoffDir, "closed.md"),
      [
        "---",
        "handoff_status: closed",
        "retention_tier: cold",
        "---",
        "",
        "# Closed archive",
        "",
        "SECRET_COLD_BODY",
        "",
      ].join("\n"),
      "utf8",
    );

    const hook = path.resolve("base/adapters/claude-code/hooks/inject-handoff.sh");
    const compact = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      encoding: "utf8",
    });

    expect(compact.status).toBe(0);
    expect(compact.stderr).toBe("");
    expect(compact.stdout).toContain("Mode: compact");
    expect(compact.stdout).toContain("- .anamnesis/handoff/active.md");
    expect(compact.stdout).not.toContain("- .anamnesis/handoff/closed.md");
    expect(compact.stdout).not.toContain("SECRET_COLD_BODY");
    expect(compact.stdout).toContain("no warm archive is startup-active");

    const full = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectRoot,
        ANAMNESIS_SESSION_CONTEXT_MODE: "full",
      },
      encoding: "utf8",
    });

    expect(full.status).toBe(0);
    expect(full.stderr).toBe("");
    expect(full.stdout).toContain("Source: .anamnesis/handoff/active.md");
    expect(full.stdout).not.toContain("SECRET_COLD_BODY");
    expect(full.stdout).not.toContain("active referenced archived handoff");
  });

  it("dedupes handoff reminders for the same dirty git fingerprint", () => {
    if (process.platform === "win32") return;

    const projectRoot = tmpDir();
    const gitInit = spawnSync("git", ["init"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(gitInit.status).toBe(0);

    fs.writeFileSync(path.join(projectRoot, "first.txt"), "dirty\n", "utf8");

    const hook = path.resolve(
      "base/adapters/claude-code/hooks/handoff-reminder.sh",
    );
    const runHook = () =>
      spawnSync("bash", [hook], {
        cwd: projectRoot,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
        encoding: "utf8",
      });

    const first = runHook();
    expect(first.status).toBe(0);
    expect(first.stderr).toContain(
      "1 uncommitted change(s) are newer than the latest handoff",
    );
    expect(
      fs.existsSync(
        path.join(projectRoot, ".git/anamnesis/handoff-reminder.last"),
      ),
    ).toBe(true);

    const second = runHook();
    expect(second.status).toBe(0);
    expect(second.stderr).toBe("");

    fs.writeFileSync(path.join(projectRoot, "second.txt"), "new dirty\n", "utf8");

    const third = runHook();
    expect(third.status).toBe(0);
    expect(third.stderr).toContain(
      "2 uncommitted change(s) are newer than the latest handoff",
    );
  });
});
