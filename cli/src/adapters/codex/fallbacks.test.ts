import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { codexNativeNodeCommand } from "../../core/codex_native.js";
import type { FragmentDefinition } from "../../core/fragments.js";
import { type RenderContext, RenderError } from "../../core/render.js";
import { executableHookRenderer } from "./executable_hook.js";
import { skillRenderer } from "./skill.js";
import { slashCommandRenderer } from "./slash_command.js";

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
      expect(actions[0]!.content).toContain(
        "**Declared side effects:** `local-write`.",
      );
      expect(actions[0]!.content).toContain("echo hi");
      expect(actions[0]!.sideEffects).toEqual(["local-write"]);
    }
    const wrapper = actions.find(
      (a) =>
        a.kind === "file" &&
        a.path ===
          ".anamnesis/codex-native-hooks/myfrag-PostToolUse-Edit-x.mjs",
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
      expect(wrapper.sideEffects).toEqual(["local-write"]);
      expect(wrapper.content).toContain('"sideEffects": [');
      expect(wrapper.content).toContain('"local-write"');
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
        side_effects: ["read-only"],
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
      expect(preCommit.sideEffects).toEqual([
        "read-only",
        "git-hook",
        "local-write",
      ]);
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

  it("selects the dedicated base UserPromptSubmit wrapper", () => {
    fs.mkdirSync(path.join(fragmentDir, "adapters/codex/hooks"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/claude-code/hooks/work-briefing.sh"),
      "#!/bin/bash\n",
    );
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/codex/hooks/work-user-prompt.mjs"),
      "console.log('{}');\n",
    );
    const fragment: FragmentDefinition = {
      id: "base",
      version: 21,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };

    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "UserPromptSubmit",
        source: "adapters/claude-code/hooks/work-briefing.sh",
        adapters_supported: ["codex"],
        side_effects: ["local-write"],
      },
      makeContext(fragmentDir, fragment),
    );

    const wrapper = actions.find(
      (action) =>
        action.kind === "file" &&
        action.path === ".anamnesis/codex-native-hooks/work-user-prompt.mjs",
    );
    expect(wrapper?.kind).toBe("file");
    if (wrapper?.kind === "file") {
      expect(wrapper.codexHook).toEqual({
        event: "UserPromptSubmit",
        command: codexNativeNodeCommand(
          ".anamnesis/codex-native-hooks/work-user-prompt.mjs",
        ),
      });
      expect(wrapper.sideEffects).toEqual(["local-write"]);
    }
    expect(
      actions.some(
        (action) =>
          action.kind === "file" &&
          action.path.includes("base-UserPromptSubmit-work-briefing"),
      ),
    ).toBe(false);
  });

  it("selects the dedicated base PostToolUse Work wrapper", () => {
    fs.mkdirSync(path.join(fragmentDir, "adapters/codex/hooks"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fragmentDir, "adapters/codex/hooks/work-post-tool-use.mjs"),
      "console.log('{}');\n",
    );
    const fragment: FragmentDefinition = {
      id: "base",
      version: 22,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [],
    };
    const actions = executableHookRenderer.plan(
      {
        type: "executable_hook",
        event: "PostToolUse:^(Bash|apply_patch|Agent)$",
        source: "adapters/codex/hooks/work-post-tool-use.mjs",
        adapters_supported: ["codex"],
        side_effects: ["local-write"],
      },
      makeContext(fragmentDir, fragment),
    );

    const wrapper = actions.find(
      (action) =>
        action.kind === "file" &&
        action.path ===
          ".anamnesis/codex-native-hooks/work-post-tool-use.mjs",
    );
    expect(wrapper?.kind).toBe("file");
    if (wrapper?.kind === "file") {
      expect(wrapper.codexHook).toEqual({
        event: "PostToolUse",
        matcher: "^(Bash|apply_patch|Agent)$",
        command: codexNativeNodeCommand(
          ".anamnesis/codex-native-hooks/work-post-tool-use.mjs",
        ),
        additionalContextLimit: 4000,
      });
      expect(wrapper.codexHook).not.toHaveProperty("statusMessage");
    }
    expect(
      actions.some(
        (action) =>
          action.kind === "file" &&
          action.path.includes("base-PostToolUse-work-post-tool-use"),
      ),
    ).toBe(false);
  });

  it("sanitizes Codex PostToolUse before invoking the Work CLI", () => {
    const projectRoot = tmpDir("anamnesis-codex-work-boundary-");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-post-tool-use.mjs",
    );
    fs.writeFileSync(
      shimPath,
      [
        "#!/usr/bin/env node",
        "const chunks = [];",
        "for await (const chunk of process.stdin) chunks.push(chunk);",
        "const input = Buffer.concat(chunks).toString('utf8');",
        'if (process.argv.slice(2).join(" ") !== "work hook-post-tool-use --client codex") process.exit(41);',
        'if (input.includes("PRIVATE_INPUT") || input.includes("PRIVATE_OUTPUT") || input.includes("transcript")) process.exit(42);',
        'const value = JSON.parse(input);',
        'if (JSON.stringify(value) !== JSON.stringify({session_id:"session-1",turn_id:"turn-1",events:[{tool_name:"apply_patch",tool_use_id:"tool-1"}]})) process.exit(43);',
        'process.stdout.write("brief and continue\\n");',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      env: { ...process.env, ANAMNESIS_BIN: shimPath },
      input: `${JSON.stringify({
        cwd: projectRoot,
        session_id: "session-1",
        turn_id: "turn-1",
        hook_event_name: "PostToolUse",
        tool_name: "apply_patch",
        tool_use_id: "tool-1",
        tool_input: { patch: "PRIVATE_INPUT" },
        tool_response: "PRIVATE_OUTPUT",
        transcript_path: "/private/transcript",
      })}\n`,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "brief and continue\n",
      },
    });
    expect(result.stdout).not.toContain("PRIVATE");
  });

  it("skips unsupported Codex tools without launching the CLI", () => {
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-post-tool-use.mjs",
    );
    const result = spawnSync(process.execPath, [wrapperPath], {
      env: { ...process.env, ANAMNESIS_BIN: "/must/not/run" },
      input: `${JSON.stringify({ tool_name: "Read", tool_use_id: "tool-1" })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(result.stderr).toBe("");
  });

  it("skips Codex tool boundaries with missing stable IDs before launching the CLI", () => {
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-post-tool-use.mjs",
    );
    for (const payload of [
      { session_id: "session-1", tool_name: "Bash", tool_use_id: "tool-1" },
      {
        session_id: "session-1",
        turn_id: "turn-1",
        tool_name: "Bash",
        tool_use_id: "",
      },
    ]) {
      const result = spawnSync(process.execPath, [wrapperPath], {
        env: { ...process.env, ANAMNESIS_BIN: "/must/not/run" },
        input: `${JSON.stringify(payload)}\n`,
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({});
      expect(result.stderr).toBe("");
    }
  });

  it("skips an unlinked Codex session before resolving the foreground CLI", () => {
    const projectRoot = tmpDir("anamnesis-codex-work-boundary-unlinked-");
    const binDir = path.join(projectRoot, "bin");
    const marker = path.join(projectRoot, "unexpected-cli-call");
    fs.mkdirSync(binDir);
    const shim = path.join(binDir, "anamnesis");
    fs.writeFileSync(
      shim,
      `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 0\n`,
      "utf8",
    );
    fs.chmodSync(shim, 0o755);
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-post-tool-use.mjs",
    );
    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      env: { ...process.env, PATH: binDir },
      input: `${JSON.stringify({
        cwd: projectRoot,
        session_id: "unlinked-session",
        turn_id: "turn-1",
        tool_name: "Bash",
        tool_use_id: "tool-1",
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("fails open and UI-silent when the Codex boundary CLI is unavailable", () => {
    const projectRoot = tmpDir("anamnesis-codex-work-boundary-missing-");
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-post-tool-use.mjs",
    );
    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      env: { CODEX_PROJECT_DIR: projectRoot, PATH: "" },
      input: `${JSON.stringify({
        session_id: "session-1",
        turn_id: "turn-1",
        tool_name: "Bash",
        tool_use_id: "tool-1",
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(result.stderr).toBe("");
  });

  it("forwards exact UserPromptSubmit bytes and isolates child stderr", () => {
    const projectRoot = tmpDir("anamnesis-codex-work-prompt-");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-user-prompt.mjs",
    );
    const input = Buffer.from(
      `${JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "UserPromptSubmit",
        prompt: "private prompt sentinel",
        prompt_id: "prompt-123",
      })}\n`,
      "utf8",
    );
    fs.writeFileSync(
      shimPath,
      [
        "#!/usr/bin/env node",
        "const chunks = [];",
        "for await (const chunk of process.stdin) chunks.push(chunk);",
        "const input = Buffer.concat(chunks);",
        'if (process.argv.slice(2).join(" ") !== "work hook-user-prompt --client codex") process.exit(41);',
        'if (input.toString("base64") !== process.env.EXPECTED_INPUT_BASE64) process.exit(42);',
        'process.stderr.write("child stderr sentinel\\n");',
        'process.stdout.write("due briefing\\n");',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ANAMNESIS_BIN: shimPath,
        EXPECTED_INPUT_BASE64: input.toString("base64"),
      },
      input,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("child stderr sentinel");
    expect(result.stdout).not.toContain("private prompt sentinel");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "due briefing\n",
      },
    });
  });

  it("fails open with sanitized output when the Work CLI is unavailable", () => {
    const projectRoot = tmpDir("anamnesis-codex-work-prompt-missing-");
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-user-prompt.mjs",
    );
    const input = `${JSON.stringify({
      cwd: projectRoot,
      hook_event_name: "UserPromptSubmit",
      prompt: "missing cli private sentinel",
    })}\n`;

    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      env: { CODEX_PROJECT_DIR: projectRoot, PATH: "" },
      input,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(result.stdout).not.toContain("missing cli private sentinel");
    expect(result.stderr).toContain("executable unavailable");
    expect(result.stderr).not.toContain("missing cli private sentinel");
  });

  it("uses a built anamnesis source checkout when no installed CLI exists", () => {
    const projectRoot = tmpDir("anamnesis-codex-work-prompt-checkout-");
    const checkoutBin = path.join(projectRoot, "cli/dist/index.js");
    fs.mkdirSync(path.dirname(checkoutBin), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "@mcprotein/anamnesis" }),
    );
    fs.writeFileSync(
      checkoutBin,
      `#!${process.execPath}\nprocess.stdout.write("checkout briefing\\n");\n`,
    );
    fs.chmodSync(checkoutBin, 0o755);
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-user-prompt.mjs",
    );

    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      env: { CODEX_PROJECT_DIR: projectRoot, PATH: "" },
      input: `${JSON.stringify({ cwd: projectRoot })}\n`,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "checkout briefing\n",
      },
    });
  });

  it("returns empty hook JSON when the Work CLI emits no briefing", () => {
    const projectRoot = tmpDir("anamnesis-codex-work-prompt-empty-");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/work-user-prompt.mjs",
    );
    const input = `${JSON.stringify({
      cwd: projectRoot,
      hook_event_name: "UserPromptSubmit",
      prompt: "codex private empty sentinel",
    })}\n`;
    fs.writeFileSync(
      shimPath,
      [
        "#!/usr/bin/env node",
        'process.stderr.write("child empty stderr: codex private empty sentinel\\n");',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      env: { ...process.env, ANAMNESIS_BIN: shimPath },
      input,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(result.stdout).not.toContain("codex private empty sentinel");
    expect(result.stderr).toBe("");
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
      input: JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "SessionStart",
      }),
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
      input: JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "SessionStart",
      }),
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

  it("excludes closed recently completed archives from native handoff SessionStart context", () => {
    const projectRoot = tmpDir("anamnesis-codex-handoff-session-start-");
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

    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/session-start.mjs",
    );
    const compact = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      input: JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "SessionStart",
      }),
      encoding: "utf8",
    });

    expect(compact.status).toBe(0);
    expect(compact.stderr).toBe("");
    const output = JSON.parse(compact.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = output.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("Mode: compact");
    expect(context).toContain("- .anamnesis/handoff/active.md");
    expect(context).not.toContain("- .anamnesis/handoff/closed.md");
    expect(context).not.toContain("SECRET_COLD_BODY");
    expect(context).toContain("no warm archive is startup-active");

    const full = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      input: JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "SessionStart",
      }),
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
    expect(fullContext).toContain("Source: .anamnesis/handoff/active.md");
    expect(fullContext).not.toContain("SECRET_COLD_BODY");
    expect(fullContext).not.toContain("active referenced archived handoff");
  });

  it("respects zero warm handoff budget in native SessionStart without active.md", () => {
    const projectRoot = tmpDir("anamnesis-codex-handoff-session-start-policy-");
    const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      [
        "version: 1",
        "project: { name: fixture }",
        "tools: [codex]",
        "fragments: []",
        "settings:",
        "  max_warm_handoff_archives: 0",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(handoffDir, "latest.md"),
      "# Latest archive\n\nSECRET_WARM_FALLBACK\n",
      "utf8",
    );

    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/session-start.mjs",
    );
    const compact = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      input: JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "SessionStart",
      }),
      encoding: "utf8",
    });

    expect(compact.status).toBe(0);
    expect(compact.stderr).toBe("");
    expect(compact.stdout).toBe("");
  });

  it("uses warm handoff budget as archive count in native SessionStart without active.md", () => {
    const projectRoot = tmpDir("anamnesis-codex-handoff-session-start-budget-");
    const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      [
        "version: 1",
        "project: { name: fixture }",
        "tools: [codex]",
        "fragments: []",
        "settings:",
        "  max_warm_handoff_archives: 2",
        "",
      ].join("\n"),
      "utf8",
    );
    for (const name of ["old", "middle", "new"]) {
      fs.writeFileSync(
        path.join(handoffDir, `${name}.md`),
        `# ${name}\n\n${name.toUpperCase()}_BODY\n`,
        "utf8",
      );
    }
    fs.utimesSync(
      path.join(handoffDir, "old.md"),
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-01T00:00:00.000Z"),
    );
    fs.utimesSync(
      path.join(handoffDir, "middle.md"),
      new Date("2026-06-02T00:00:00.000Z"),
      new Date("2026-06-02T00:00:00.000Z"),
    );
    fs.utimesSync(
      path.join(handoffDir, "new.md"),
      new Date("2026-06-03T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );

    const wrapperPath = path.resolve(
      "base/adapters/codex/hooks/session-start.mjs",
    );
    const compact = spawnSync(process.execPath, [wrapperPath], {
      cwd: projectRoot,
      input: JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "SessionStart",
      }),
      encoding: "utf8",
    });

    expect(compact.status).toBe(0);
    expect(compact.stderr).toBe("");
    const output = JSON.parse(compact.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = output.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("- .anamnesis/handoff/new.md");
    expect(context).toContain("- .anamnesis/handoff/middle.md");
    expect(context).not.toContain("- .anamnesis/handoff/old.md");
    expect(context).toContain(
      "Retrieval rule: read the referenced warm archive",
    );
    expect(context).toContain("anamnesis context query");
    expect(context).toContain("source_path/stable_ref");
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
          side_effects: ["read-only"],
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
        expect(wrapper.sideEffects).toEqual(["read-only"]);
      }
      const region = actions.find((a) => a.kind === "region");
      expect(region?.kind).toBe("region");
      if (region?.kind === "region") {
        expect(region.content).toContain("Codex native path");
        expect(region.content).toContain(
          "**Declared side effects:** `read-only`.",
        );
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

describe("codex skill native surface and fallback", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-codex-skill-");
    fs.mkdirSync(path.join(fragmentDir, "skills/myskill"), { recursive: true });
  });

  it("emits native Codex skill files and strips frontmatter in fallback region", () => {
    const skillBody = "## Steps\n\n1. step one\n2. step two\n";
    fs.mkdirSync(path.join(fragmentDir, "skills/myskill/references"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fragmentDir, "skills/myskill/SKILL.md"),
      `---\nname: myskill\ndescription: a test skill\n---\n\n${skillBody}`,
    );
    fs.writeFileSync(
      path.join(fragmentDir, "skills/myskill/references/guide.md"),
      "supporting reference\n",
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
      {
        type: "skill",
        name: "myskill",
        source: "skills/myskill",
        side_effects: ["local-write"],
      },
      makeContext(fragmentDir, fragment),
    );
    expect(actions).toHaveLength(3);

    const skillFile = actions.find(
      (a) => a.kind === "file" && a.path === ".codex/skills/myskill/SKILL.md",
    );
    expect(skillFile?.kind).toBe("file");
    if (skillFile?.kind === "file") {
      expect(skillFile.sideEffects).toEqual(["local-write"]);
      expect(skillFile.content).toContain("description: a test skill");
      expect(skillFile.content).toContain("step one");
    }

    const referenceFile = actions.find(
      (a) =>
        a.kind === "file" &&
        a.path === ".codex/skills/myskill/references/guide.md",
    );
    expect(referenceFile?.kind).toBe("file");
    if (referenceFile?.kind === "file") {
      expect(referenceFile.content).toBe("supporting reference\n");
    }

    const fallback = actions.find(
      (a) => a.kind === "region" && a.regionId === "codex-skill-myskill",
    );
    expect(fallback?.kind).toBe("region");
    if (fallback?.kind === "region") {
      expect(fallback.sideEffects).toEqual(["local-write"]);
      expect(fallback.content).toContain(".codex/skills/myskill/SKILL.md");
      expect(fallback.content).toContain(
        "**Declared side effects:** `local-write`.",
      );
      // Body present, frontmatter not.
      expect(fallback.content).toContain("step one");
      expect(fallback.content).not.toContain("description: a test skill");
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
        side_effects: ["read-only"],
      },
      makeContext(fragmentDir, fragment),
    );
    expect(actions).toHaveLength(1);
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.regionId).toBe("codex-cmd-foo");
      expect(actions[0]!.sideEffects).toEqual(["read-only"]);
      expect(actions[0]!.content).toContain(
        "**Declared side effects:** `read-only`.",
      );
      expect(actions[0]!.content).toContain("Do foo by");
      expect(actions[0]!.content).not.toContain("description: do foo");
      expect(actions[0]!.content).toContain("/foo");
    }
  });
});
