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

function makeContext(
  fragmentDir: string,
  fragment: FragmentDefinition,
  scopePath: string = ".",
  projectRoot: string = "/tmp/proj",
): RenderContext {
  return {
    fragment,
    fragmentDir,
    projectRoot,
    scopePath,
    settings: {
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
    },
    params: {},
  };
}

// ---------------------------------------------------------------------------

describe("codex executable_hook fallback", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-codex-hook-");
    fs.mkdirSync(path.join(fragmentDir, "adapters/claude-code/hooks"), {
      recursive: true,
    });
  });

  it("emits AGENTS.md region with hook script body inline", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/x.sh"),
      "#!/bin/bash\necho hi\n",
    );
    const fragment: FragmentDefinition = {
      id: "myfrag",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };
    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "PostToolUse:Edit",
        source: "adapters/claude-code/hooks/x.sh",
        adapters_supported: ["codex"],
      },
      makeContext(fragmentDir, fragment),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("region");
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.file).toBe("AGENTS.md");
      expect(actions[0]!.regionId).toBe("codex-hook-x");
      expect(actions[0]!.content).toContain("PostToolUse:Edit");
      expect(actions[0]!.content).toContain("echo hi");
    }
  });

  it("installs a best-effort git pre-commit bridge when hooks dir exists", () => {
    const projectRoot = tmpDir("anamnesis-codex-git-");
    fs.mkdirSync(path.join(projectRoot, ".git", "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/x.sh"),
      "#!/bin/bash\necho hi\n",
    );
    const fragment: FragmentDefinition = {
      id: "myfrag",
      version: 2,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };

    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "PostToolUse:Edit",
        source: "adapters/claude-code/hooks/x.sh",
        adapters_supported: ["codex"],
      },
      makeContext(fragmentDir, fragment, ".", projectRoot),
    );

    expect(actions).toHaveLength(3);
    expect(actions.some((a) => a.kind === "region")).toBe(true);
    const script = actions.find(
      (a) => a.kind === "file" && a.path.startsWith(".anamnesis/codex-hooks/"),
    );
    expect(script?.kind).toBe("file");
    if (script?.kind === "file") {
      expect(script.path).toBe(
        ".anamnesis/codex-hooks/myfrag-PostToolUse-Edit-x.sh",
      );
      expect(script.mode).toBe(0o755);
      expect(script.content).toContain("echo hi");
    }

    const preCommit = actions.find(
      (a) => a.kind === "file" && a.path === ".git/hooks/pre-commit",
    );
    expect(preCommit?.kind).toBe("file");
    if (preCommit?.kind === "file") {
      expect(preCommit.mode).toBe(0o755);
      expect(preCommit.content).toContain(".anamnesis/codex-hooks");
      expect(preCommit.content).toContain("git diff --cached --name-only");
    }
  });

  it("installs Codex native SessionStart wrapper for the base continuity hooks", () => {
    fs.mkdirSync(path.join(fragmentDir, "adapters/codex/hooks"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/inject-ontology.sh"),
      "#!/bin/bash\necho ontology\n",
    );
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/codex/hooks/session-start.mjs"),
      "console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'x'}}));\n",
    );
    const fragment: FragmentDefinition = {
      id: "base",
      version: 9,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };

    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "SessionStart",
        source: "adapters/claude-code/hooks/inject-ontology.sh",
        adapters_supported: ["codex"],
      },
      makeContext(fragmentDir, fragment),
    );

    const wrapper = actions.find(
      (a) =>
        a.kind === "file" &&
        a.path === ".anamnesis/codex-native-hooks/session-start.mjs",
    );
    expect(wrapper?.kind).toBe("file");
    if (wrapper?.kind === "file") {
      expect(wrapper.mode).toBe(0o755);
      expect(wrapper.content).toContain("hookSpecificOutput");
      expect(wrapper.codexHook).toEqual({
        event: "SessionStart",
        matcher: "startup|resume",
        command: 'node ".anamnesis/codex-native-hooks/session-start.mjs"',
      });
    }
  });

  it("scopes target file to sub-scope when scopePath given", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/x.sh"),
      "#!/bin/sh\n",
    );
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };
    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "SessionStart",
        source: "adapters/claude-code/hooks/x.sh",
      },
      makeContext(fragmentDir, fragment, "apps/api"),
    );
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.file).toBe("apps/api/AGENTS.md");
    }
  });

  it("throws when source missing", () => {
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };
    expect(() =>
      executableHookRenderer.plan(
        {
          type: "executable_hook",
          event: "SessionStart",
          source: "missing.sh",
        },
        makeContext(fragmentDir, fragment),
      ),
    ).toThrow(RenderError);
  });
});

// ---------------------------------------------------------------------------

describe("codex skill fallback", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-codex-skill-");
    fs.mkdirSync(path.join(fragmentDir, "skills/myskill"), { recursive: true });
  });

  it("strips frontmatter and emits region with body only", () => {
    const skillBody = "## Steps\n\n1. step one\n2. step two\n";
    fs.writeFileSync(
      path.join(fragmentDir, "skills/myskill/SKILL.md"),
      `---\nname: myskill\ndescription: a test skill\n---\n\n${skillBody}`,
    );
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };
    const actions = skillRenderer.plan(
      { type: "skill", name: "myskill", source: "skills/myskill" },
      makeContext(fragmentDir, fragment),
    );
    expect(actions).toHaveLength(1);
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.regionId).toBe("codex-skill-myskill");
      // Body present, frontmatter not.
      expect(actions[0]!.content).toContain("step one");
      expect(actions[0]!.content).not.toContain("description: a test skill");
    }
  });

  it("throws when SKILL.md missing", () => {
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };
    expect(() =>
      skillRenderer.plan(
        { type: "skill", name: "myskill", source: "skills/myskill" },
        makeContext(fragmentDir, fragment),
      ),
    ).toThrow(/missing SKILL\.md/);
  });
});

// ---------------------------------------------------------------------------

describe("codex slash_command fallback", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-codex-cmd-");
    fs.mkdirSync(path.join(fragmentDir, "adapters/claude-code/commands"), {
      recursive: true,
    });
  });

  it("strips frontmatter and emits region instructing the agent", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/commands/foo.md"),
      `---\ndescription: do foo\n---\n\nDo foo by:\n1. step\n`,
    );
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };
    const actions = slashCommandRenderer.plan(
      {
        type: "slash_command",
        name: "foo",
        source: "adapters/claude-code/commands/foo.md",
      },
      makeContext(fragmentDir, fragment),
    );
    expect(actions).toHaveLength(1);
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.regionId).toBe("codex-cmd-foo");
      expect(actions[0]!.content).toContain("Do foo by");
      expect(actions[0]!.content).not.toContain("description: do foo");
      expect(actions[0]!.content).toContain("/foo");
    }
  });
});
