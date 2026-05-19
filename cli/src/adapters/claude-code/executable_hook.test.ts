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

  it("prints user-managed system_graph.yaml before managed ontology slices", () => {
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
    expect(result.stdout).toContain("--- system_graph.yaml (user-managed) ---");
    expect(result.stdout).toContain("project: forecasting");
    expect(result.stdout).toContain("--- .anamnesis/ontology/base.yaml ---");
    expect(result.stdout.indexOf("--- system_graph.yaml")).toBeLessThan(
      result.stdout.indexOf("--- .anamnesis/ontology/base.yaml ---"),
    );
  });
});
