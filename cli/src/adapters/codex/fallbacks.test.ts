import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executableHookRenderer } from "./executable_hook.js";
import { skillRenderer } from "./skill.js";
import { slashCommandRenderer } from "./slash_command.js";
import { codexNativeNodeCommand } from "../../core/codex_native.js";
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

  it("emits AGENTS.md region and Codex native wrapper for supported tool hooks", () => {
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
    expect(actions).toHaveLength(3);
    expect(actions[0]!.kind).toBe("region");
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.file).toBe("AGENTS.md");
      expect(actions[0]!.regionId).toBe("codex-hook-x");
      expect(actions[0]!.content).toContain("PostToolUse:Edit");
      expect(actions[0]!.content).toContain("Codex native path");
      expect(actions[0]!.content).toContain("echo hi");
    }
    const wrapper = actions.find(
      (a) =>
        a.kind === "file" &&
        a.path === ".anamnesis/codex-native-hooks/myfrag-PostToolUse-Edit-x.mjs",
    );
    expect(wrapper?.kind).toBe("file");
    if (wrapper?.kind === "file") {
      expect(wrapper.codexHook).toEqual({
        event: "PostToolUse",
        matcher: "Edit|Write|apply_patch",
        command: codexNativeNodeCommand(
          ".anamnesis/codex-native-hooks/myfrag-PostToolUse-Edit-x.mjs",
        ),
        statusMessage: "Running anamnesis PostToolUse hook",
      });
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

    expect(actions).toHaveLength(4);
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
        matcher: "startup|resume|clear",
        command: codexNativeNodeCommand(
          ".anamnesis/codex-native-hooks/session-start.mjs",
        ),
      });
    }
  });

  it("points to symlinked system_graph.yaml in the native SessionStart context", () => {
    if (process.platform === "win32") return;

    const projectRoot = tmpDir("anamnesis-codex-session-start-");
    fs.mkdirSync(path.join(projectRoot, ".anamnesis/ontology"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(projectRoot, "configs"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".anamnesis/ontology/base.yaml"),
      "schema_version: anamnesis.ontology.v1\nfragment: base\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectRoot, "configs/system_graph.yaml"),
      "aws:\n  required_profile: forecast\n",
      "utf8",
    );
    fs.symlinkSync(
      "configs/system_graph.yaml",
      path.join(projectRoot, "system_graph.yaml"),
    );

    fs.mkdirSync(path.join(fragmentDir, "adapters/codex/hooks"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/inject-ontology.sh"),
      "#!/bin/bash\necho ontology\n",
    );
    fs.copyFileSync(
      path.resolve("base/adapters/codex/hooks/session-start.mjs"),
      path.join(fragmentDir, "adapters/codex/hooks/session-start.mjs"),
    );
    const fragment: FragmentDefinition = {
      id: "base",
      version: 10,
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
      makeContext(fragmentDir, fragment, ".", projectRoot),
    );

    for (const action of actions) {
      if (action.kind !== "file") continue;
      const target = path.join(projectRoot, action.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, action.content, "utf8");
      if (action.mode) fs.chmodSync(target, action.mode);
    }

    const wrapperPath = path.join(
      projectRoot,
      ".anamnesis/codex-native-hooks/session-start.mjs",
    );
    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      input: JSON.stringify({ cwd: projectRoot, hook_event_name: "SessionStart" }),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = output.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("Mode: compact");
    expect(context).toContain("Source pointers:");
    expect(context).toContain(
      "- system_graph.yaml (34 bytes, 2 lines; user-managed top-level ontology)",
    );
    expect(context).toContain(
      "- .anamnesis/ontology/base.yaml (53 bytes, 2 lines; managed ontology slice)",
    );
    expect(context).not.toContain("required_profile: forecast");
    expect(context.indexOf("- system_graph.yaml")).toBeLessThan(
      context.indexOf("- .anamnesis/ontology/base.yaml"),
    );

    const full = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      input: JSON.stringify({ cwd: projectRoot, hook_event_name: "SessionStart" }),
      env: {
        ...process.env,
        ANAMNESIS_SESSION_CONTEXT_MODE: "full",
      },
      encoding: "utf8",
    });

    expect(full.status).toBe(0);
    expect(full.stderr).toBe("");
    const fullOutput = JSON.parse(full.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const fullContext = fullOutput.hookSpecificOutput?.additionalContext ?? "";
    expect(fullContext).toContain("--- .anamnesis/ontology/base.yaml ---");
    expect(fullContext).toContain("--- system_graph.yaml (user-managed) ---");
    expect(fullContext).toContain("required_profile: forecast");
    expect(fullContext.indexOf("--- system_graph.yaml")).toBeLessThan(
      fullContext.indexOf("--- .anamnesis/ontology/base.yaml ---"),
    );
  });

  it("registers Stop hooks natively without a matcher", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/stop.sh"),
      "#!/bin/bash\necho stop >&2\n",
    );
    const fragment: FragmentDefinition = {
      id: "base",
      version: 10,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };

    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "Stop",
        source: "adapters/claude-code/hooks/stop.sh",
        adapters_supported: ["codex"],
      },
      makeContext(fragmentDir, fragment),
    );

    const wrapper = actions.find(
      (a) =>
        a.kind === "file" &&
        a.path === ".anamnesis/codex-native-hooks/base-Stop-stop.mjs",
    );
    expect(wrapper?.kind).toBe("file");
    if (wrapper?.kind === "file") {
      expect(wrapper.codexHook).toEqual({
        event: "Stop",
        command: codexNativeNodeCommand(
          ".anamnesis/codex-native-hooks/base-Stop-stop.mjs",
        ),
        statusMessage: "Running anamnesis Stop hook",
      });
      expect(wrapper.content).toContain('"event": "Stop"');
      expect(wrapper.content).toContain('"scriptPath"');
    }
  });

  it("registers current Codex lifecycle shell hooks with event-aware matchers", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/x.sh"),
      "#!/bin/bash\necho lifecycle\n",
    );
    const fragment: FragmentDefinition = {
      id: "myfrag",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };

    const cases = [
      {
        event: "PreToolUse:Bash",
        wrapperPath:
          ".anamnesis/codex-native-hooks/myfrag-PreToolUse-Bash-x.mjs",
        codexHook: {
          event: "PreToolUse",
          matcher: "Bash",
          command: codexNativeNodeCommand(
            ".anamnesis/codex-native-hooks/myfrag-PreToolUse-Bash-x.mjs",
          ),
          statusMessage: "Running anamnesis PreToolUse hook",
        },
      },
      {
        event: "PermissionRequest:apply_patch",
        wrapperPath:
          ".anamnesis/codex-native-hooks/myfrag-PermissionRequest-apply_patch-x.mjs",
        codexHook: {
          event: "PermissionRequest",
          matcher: "apply_patch",
          command: codexNativeNodeCommand(
            ".anamnesis/codex-native-hooks/myfrag-PermissionRequest-apply_patch-x.mjs",
          ),
          statusMessage: "Running anamnesis PermissionRequest hook",
        },
      },
      {
        event: "UserPromptSubmit",
        wrapperPath:
          ".anamnesis/codex-native-hooks/myfrag-UserPromptSubmit-x.mjs",
        codexHook: {
          event: "UserPromptSubmit",
          command: codexNativeNodeCommand(
            ".anamnesis/codex-native-hooks/myfrag-UserPromptSubmit-x.mjs",
          ),
          statusMessage: "Running anamnesis UserPromptSubmit hook",
        },
      },
    ];

    for (const c of cases) {
      const actions = executableHookRenderer.plan(
        {
          type: "executable_hook",
          event: c.event,
          source: "adapters/claude-code/hooks/x.sh",
          adapters_supported: ["codex"],
        },
        makeContext(fragmentDir, fragment),
      );

      const wrapper = actions.find(
        (a) => a.kind === "file" && a.path === c.wrapperPath,
      );
      expect(wrapper?.kind).toBe("file");
      if (wrapper?.kind === "file") {
        expect(wrapper.codexHook).toEqual(c.codexHook);
        expect(wrapper.content).toContain(`"event": "${c.codexHook.event}"`);
      }
      const region = actions.find((a) => a.kind === "region");
      expect(region?.kind).toBe("region");
      if (region?.kind === "region") {
        expect(region.content).toContain("Codex native path");
      }
    }
  });

  it("adapts apply_patch targets for native Codex shell wrappers", () => {
    const projectRoot = tmpDir("anamnesis-codex-native-wrapper-");
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/x.sh"),
      [
        "#!/bin/bash",
        "set -euo pipefail",
        'mkdir -p "$CLAUDE_PROJECT_DIR/.probe"',
        'printf "%s\\n" "$CLAUDE_TOOL_FILE_PATH" >> "$CLAUDE_PROJECT_DIR/.probe/targets"',
        "",
      ].join("\n"),
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
      makeContext(fragmentDir, fragment, ".", projectRoot),
    );

    for (const action of actions) {
      if (action.kind !== "file") continue;
      const target = path.join(projectRoot, action.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, action.content, "utf8");
      if (action.mode) fs.chmodSync(target, action.mode);
    }

    const wrapperPath = path.join(
      projectRoot,
      ".anamnesis/codex-native-hooks/myfrag-PostToolUse-Edit-x.mjs",
    );
    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      input: JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "PostToolUse",
        tool_name: "apply_patch",
        tool_input: {
          command: [
            "*** Begin Patch",
            "*** Update File: prisma/schema.prisma",
            "@@",
            " unchanged",
            "*** End Patch",
          ].join("\n"),
        },
      }),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(
      fs.readFileSync(path.join(projectRoot, ".probe/targets"), "utf8"),
    ).toBe("prisma/schema.prisma\n");
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
