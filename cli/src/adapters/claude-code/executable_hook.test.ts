import { describe, it, expect, beforeEach } from "vitest";
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
});
