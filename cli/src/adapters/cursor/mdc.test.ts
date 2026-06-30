import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executableHookRenderer } from "./executable_hook.js";
import { skillRenderer } from "./skill.js";
import { slashCommandRenderer } from "./slash_command.js";
import { RenderError, type RenderContext } from "../../core/render.js";
import type { FragmentDefinition } from "../../core/fragments.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeContext(fragmentDir: string): RenderContext {
  const fragment: FragmentDefinition = {
    id: "myfrag",
    version: 1,
    requires: [],
    conflicts: [],
    owns: [],
    capabilities: [],
  };
  return {
    fragment,
    fragmentDir,
    projectRoot: "/tmp/proj",
    settings: {
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
    },
    params: {},
  };
}

// ---------------------------------------------------------------------------

describe("cursor executable_hook → .cursor/rules/<id>.mdc", () => {
  let fragmentDir: string;
  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-cur-hook-");
    fs.mkdirSync(path.join(fragmentDir, "adapters/claude-code/hooks"), {
      recursive: true,
    });
  });

  it("produces an MDC file with frontmatter + script body", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/x.sh"),
      "#!/bin/bash\necho hi\n",
    );
    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "PostToolUse:Edit",
        source: "adapters/claude-code/hooks/x.sh",
        side_effects: ["read-only"],
      },
      makeContext(fragmentDir),
    );
    expect(actions).toHaveLength(1);
    if (actions[0]!.kind === "file") {
      expect(actions[0]!.path).toBe(".cursor/rules/x.mdc");
      expect(actions[0]!.content).toMatch(/^---\n/);
      expect(actions[0]!.content).toContain("agentRequested: true");
      expect(actions[0]!.content).toContain("PostToolUse:Edit");
      expect(actions[0]!.content).toContain(
        "**Declared side effects:** `read-only`.",
      );
      expect(actions[0]!.content).toContain("echo hi");
      expect(actions[0]!.sideEffects).toEqual(["read-only"]);
    }
  });

  it("throws when source missing", () => {
    expect(() =>
      executableHookRenderer.plan(
        {
          type: "executable_hook",
          event: "SessionStart",
          source: "missing.sh",
        },
        makeContext(fragmentDir),
      ),
    ).toThrow(RenderError);
  });
});

// ---------------------------------------------------------------------------

describe("cursor skill → .cursor/rules/<name>.mdc", () => {
  let fragmentDir: string;
  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-cur-skill-");
    fs.mkdirSync(path.join(fragmentDir, "skills/myskill"), { recursive: true });
  });

  it("strips frontmatter and emits MDC with skill body", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "skills/myskill/SKILL.md"),
      "---\nname: myskill\n---\n\n## Steps\n\n1. step one\n",
    );
    const actions = skillRenderer.plan(
      {
        type: "skill",
        name: "myskill",
        source: "skills/myskill",
        side_effects: ["local-write"],
      },
      makeContext(fragmentDir),
    );
    if (actions[0]!.kind === "file") {
      expect(actions[0]!.path).toBe(".cursor/rules/myskill.mdc");
      expect(actions[0]!.content).toContain("agentRequested: true");
      expect(actions[0]!.content).toContain(
        "**Declared side effects:** `local-write`.",
      );
      expect(actions[0]!.content).toContain("step one");
      expect(actions[0]!.content).not.toMatch(/name: myskill/);
      expect(actions[0]!.sideEffects).toEqual(["local-write"]);
    }
  });

  it("throws when SKILL.md missing", () => {
    expect(() =>
      skillRenderer.plan(
        { type: "skill", name: "myskill", source: "skills/myskill" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/missing SKILL\.md/);
  });
});

// ---------------------------------------------------------------------------

describe("cursor slash_command → .cursor/rules/<name>-cmd.mdc", () => {
  let fragmentDir: string;
  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-cur-cmd-");
    fs.mkdirSync(path.join(fragmentDir, "adapters/claude-code/commands"), {
      recursive: true,
    });
  });

  it("strips frontmatter and emits MDC for command", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/commands/foo.md"),
      "---\ndescription: do foo\n---\n\nDo foo:\n1. step\n",
    );
    const actions = slashCommandRenderer.plan(
      {
        type: "slash_command",
        name: "foo",
        source: "adapters/claude-code/commands/foo.md",
        side_effects: ["read-only"],
      },
      makeContext(fragmentDir),
    );
    if (actions[0]!.kind === "file") {
      expect(actions[0]!.path).toBe(".cursor/rules/foo-cmd.mdc");
      expect(actions[0]!.content).toContain("agentRequested: true");
      expect(actions[0]!.content).toContain(
        "**Declared side effects:** `read-only`.",
      );
      expect(actions[0]!.content).toContain("/foo");
      expect(actions[0]!.content).toContain("Do foo");
      expect(actions[0]!.content).not.toContain("description: do foo");
      expect(actions[0]!.sideEffects).toEqual(["read-only"]);
    }
  });
});
