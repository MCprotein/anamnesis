import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

  it("registers the base Work hook for UserPromptSubmit", () => {
    const workHookPath = "adapters/claude-code/hooks/work-briefing.sh";
    fs.writeFileSync(path.join(fragmentDir, workHookPath), "#!/bin/bash\n");
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
        source: workHookPath,
        adapters_supported: ["claude-code"],
        side_effects: ["local-write"],
      },
      makeContext(fragmentDir, fragment),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("file");
    if (actions[0]?.kind === "file") {
      expect(actions[0].path).toBe(".claude/hooks/work-briefing.sh");
      expect(actions[0].settingsHook).toEqual({ event: "UserPromptSubmit" });
    }
  });

  it("registers the base Work safe-boundary hook for PostToolBatch", () => {
    const hookPath = "adapters/claude-code/hooks/work-post-tool-batch.mjs";
    fs.writeFileSync(path.join(fragmentDir, hookPath), "#!/usr/bin/env node\n");
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
        event: "PostToolBatch",
        source: hookPath,
        adapters_supported: ["claude-code"],
        side_effects: ["local-write"],
      },
      makeContext(fragmentDir, fragment),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("file");
    if (actions[0]?.kind === "file") {
      expect(actions[0].path).toBe(
        ".claude/hooks/work-post-tool-batch.mjs",
      );
      expect(actions[0].settingsHook).toEqual({ event: "PostToolBatch" });
    }
  });

  it("sanitizes Claude PostToolBatch and filters read-only calls", () => {
    const projectRoot = tmpDir();
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    const hook = path.resolve(
      "base/adapters/claude-code/hooks/work-post-tool-batch.mjs",
    );
    fs.writeFileSync(
      shimPath,
      [
        "#!/usr/bin/env node",
        "const chunks = [];",
        "for await (const chunk of process.stdin) chunks.push(chunk);",
        "const input = Buffer.concat(chunks).toString('utf8');",
        'if (process.argv.slice(2).join(" ") !== "work hook-post-tool-use --client claude-code") process.exit(41);',
        'if (input.includes("PRIVATE") || input.includes("transcript")) process.exit(42);',
        'const value = JSON.parse(input);',
        'if (JSON.stringify(value) !== JSON.stringify({session_id:"session-c",prompt_id:"prompt-c",events:[{tool_name:"Edit",tool_use_id:"edit-1"},{tool_name:"Agent",tool_use_id:"agent-1"}]})) process.exit(43);',
        'process.stdout.write("claude boundary briefing\\n");',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(shimPath, 0o755);
    const result = spawnSync(process.execPath, [hook], {
      cwd: projectRoot,
      env: { ...process.env, ANAMNESIS_BIN: shimPath },
      input: `${JSON.stringify({
        cwd: projectRoot,
        session_id: "session-c",
        prompt_id: "prompt-c",
        transcript_path: "/PRIVATE/transcript",
        tool_calls: [
          { tool_name: "Read", tool_use_id: "read-1", tool_input: "PRIVATE" },
          { tool_name: "Edit", tool_use_id: "edit-1", tool_response: "PRIVATE" },
          { tool_name: "Agent", tool_use_id: "agent-1", tool_input: "PRIVATE" },
        ],
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolBatch",
        additionalContext: "claude boundary briefing\n",
      },
    });
  });

  it("skips Claude subagent and read-only batches without launching the CLI", () => {
    const hook = path.resolve(
      "base/adapters/claude-code/hooks/work-post-tool-batch.mjs",
    );
    for (const payload of [
      {
        agent_id: "child-1",
        tool_calls: [{ tool_name: "Edit", tool_use_id: "edit-1" }],
      },
      { tool_calls: [{ tool_name: "Read", tool_use_id: "read-1" }] },
    ]) {
      const result = spawnSync(process.execPath, [hook], {
        env: { ...process.env, ANAMNESIS_BIN: "/must/not/run" },
        input: `${JSON.stringify(payload)}\n`,
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    }
  });

  it("skips Claude batches with missing stable IDs before launching the CLI", () => {
    const hook = path.resolve(
      "base/adapters/claude-code/hooks/work-post-tool-batch.mjs",
    );
    for (const payload of [
      {
        session_id: "session-c",
        tool_calls: [{ tool_name: "Edit", tool_use_id: "edit-1" }],
      },
      {
        session_id: "session-c",
        prompt_id: "prompt-c",
        tool_calls: [{ tool_name: "Edit", tool_use_id: "" }],
      },
    ]) {
      const result = spawnSync(process.execPath, [hook], {
        env: { ...process.env, ANAMNESIS_BIN: "/must/not/run" },
        input: `${JSON.stringify(payload)}\n`,
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    }
  });

  it("skips an unlinked Claude session before resolving the foreground CLI", () => {
    const projectRoot = tmpDir();
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
    const hook = path.resolve(
      "base/adapters/claude-code/hooks/work-post-tool-batch.mjs",
    );
    const result = spawnSync(process.execPath, [hook], {
      cwd: projectRoot,
      env: { ...process.env, PATH: binDir },
      input: `${JSON.stringify({
        cwd: projectRoot,
        session_id: "unlinked-session",
        prompt_id: "prompt-1",
        tool_calls: [{ tool_name: "Edit", tool_use_id: "edit-1" }],
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("fails open and UI-silent when the Claude boundary CLI is unavailable", () => {
    const projectRoot = tmpDir();
    const hook = path.resolve(
      "base/adapters/claude-code/hooks/work-post-tool-batch.mjs",
    );
    const result = spawnSync(process.execPath, [hook], {
      cwd: projectRoot,
      env: { CLAUDE_PROJECT_DIR: projectRoot, PATH: "" },
      input: `${JSON.stringify({
        session_id: "session-c",
        prompt_id: "prompt-c",
        tool_calls: [{ tool_name: "Write", tool_use_id: "write-1" }],
      })}\n`,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("forwards exact Claude stdin bytes for quoted flow-map capture policy", () => {
    const projectRoot = tmpDir();
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    const hook = path.resolve(
      "base/adapters/claude-code/hooks/work-briefing.sh",
    );
    const input = Buffer.from(
      `${JSON.stringify({
        cwd: projectRoot,
        hook_event_name: "UserPromptSubmit",
        session_id: "session-claude-1",
        prompt: "exact prompt bytes",
        prompt_id: "prompt-claude-1",
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
        'if (process.argv.slice(2).join(" ") !== "work hook-user-prompt --client claude-code") process.exit(41);',
        'if (input.toString("base64") !== process.env.EXPECTED_INPUT_BASE64) process.exit(42);',
        'process.stdout.write("claude briefing\\n");',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(shimPath, 0o755);
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      'version: 2\n"settings": { "work_prompt_capture": { "preset": "bounded" } }\n',
    );

    const result = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ANAMNESIS_BIN: shimPath,
        ANAMNESIS_NODE: process.execPath,
        ANAMNESIS_WORK_PROMPT_CAPTURE: "1",
        CLAUDE_PROJECT_DIR: projectRoot,
        EXPECTED_INPUT_BASE64: input.toString("base64"),
      },
      input,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("claude briefing\n");
  });

  it("defers quoted flow-map reconciliation policy to the Work CLI", () => {
    const projectRoot = tmpDir();
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nprocess.stdout.write("reconciliation briefing\\n");\n`,
    );
    fs.chmodSync(shimPath, 0o755);
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      'version: 2\n"settings": { "work_policy": { "reconciliation": { "preset": "custom" } } }\n',
    );

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: "reconciliation-session",
          prompt_id: "reconciliation-prompt",
          prompt: "private reconciliation prompt",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("reconciliation briefing\n");
  });

  it("uses a built anamnesis source checkout when no installed CLI exists", () => {
    const projectRoot = tmpDir();
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
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      "version: 2\nsettings:\n  work_prompt_capture: { preset: bounded }\n",
    );

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          CLAUDE_PROJECT_DIR: projectRoot,
          ANAMNESIS_NODE: process.execPath,
          ANAMNESIS_WORK_PROMPT_CAPTURE: "1",
          PATH: "/usr/bin:/bin",
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: "checkout-session",
          prompt_id: "checkout-prompt",
          prompt: "checkout",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("checkout briefing\n");
  });

  it("fails open without leaking Claude Work command stderr or prompt", () => {
    const projectRoot = tmpDir();
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    const hook = path.resolve(
      "base/adapters/claude-code/hooks/work-briefing.sh",
    );
    const input = `${JSON.stringify({
      cwd: projectRoot,
      hook_event_name: "UserPromptSubmit",
      session_id: "failure-session",
      prompt_id: "failure-prompt",
      prompt: "claude private failure sentinel",
    })}\n`;
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      "version: 2\nsettings:\n  work_prompt_capture:\n    preset: bounded\n",
    );
    fs.writeFileSync(
      shimPath,
      [
        "#!/usr/bin/env node",
        'process.stderr.write("child failure detail: claude private failure sentinel\\n");',
        "process.exit(23);",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ANAMNESIS_BIN: shimPath,
        ANAMNESIS_NODE: process.execPath,
        ANAMNESIS_WORK_PROMPT_CAPTURE: "1",
        CLAUDE_PROJECT_DIR: projectRoot,
      },
      input,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("command failed");
    expect(result.stderr).not.toContain("child failure detail");
    expect(result.stderr).not.toContain("claude private failure sentinel");
  });

  it("does not start the Work CLI for a clear default-off unlinked Claude prompt", () => {
    const projectRoot = tmpDir();
    const marker = path.join(projectRoot, "invoked");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    fs.chmodSync(shimPath, 0o755);
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      'version: 2\n"settings": { "work_prompt_capture": { "preset": "off" } }\n',
    );

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
          ANAMNESIS_WORK_PROMPT_CAPTURE: "1",
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: "off-claude-session",
          prompt_id: "off-claude-prompt",
          prompt: "must not be forwarded",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("does not start the Work CLI for a full-root flow-map off policy", () => {
    const projectRoot = tmpDir();
    const marker = path.join(projectRoot, "invoked");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    fs.chmodSync(shimPath, 0o755);
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      "{version: 2, settings: {work_prompt_capture: {preset: off}}}\n",
    );

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
          ANAMNESIS_WORK_PROMPT_CAPTURE: "1",
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: "flow-off-claude-session",
          prompt_id: "flow-off-claude-prompt",
          prompt: "must not be forwarded",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("silently fails open before parsing or forwarding oversized Claude stdin", () => {
    const projectRoot = tmpDir();
    const marker = path.join(projectRoot, "invoked");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
        },
        input: Buffer.alloc(10 * 1024 * 1024 + 1, "x"),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("does not start capture unless the Claude environment opt-in is exactly 1", () => {
    const projectRoot = tmpDir();
    const marker = path.join(projectRoot, "invoked");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      "version: 2\nsettings:\n  work_prompt_capture:\n    preset: bounded\n",
    );
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
          ANAMNESIS_WORK_PROMPT_CAPTURE: "true",
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: "no-env-session",
          prompt_id: "no-env-prompt",
          prompt: "must not be forwarded",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("does not start full-root flow-map capture without the environment opt-in", () => {
    const projectRoot = tmpDir();
    const marker = path.join(projectRoot, "invoked");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      "{version: 2, settings: {work_prompt_capture: {preset: bounded}}}\n",
    );
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: "flow-no-env-claude-session",
          prompt_id: "flow-no-env-claude-prompt",
          prompt: "must not be forwarded",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("requires a native Claude prompt_id before capture can start the CLI", () => {
    const projectRoot = tmpDir();
    const marker = path.join(projectRoot, "invoked");
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      "version: 2\nsettings:\n  work_prompt_capture:\n    preset: bounded\n",
    );
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: "capture-claude-session",
          prompt: "must not be forwarded",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("skips a linked Claude session without prompt_id", () => {
    const projectRoot = tmpDir();
    const marker = path.join(projectRoot, "invoked");
    const sessionId = "linked-claude-session";
    const digest = createHash("sha256")
      .update(`claude\0${sessionId}`, "utf8")
      .digest("hex");
    fs.mkdirSync(path.join(projectRoot, ".anamnesis/work-cursors"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectRoot, ".anamnesis/work-cursors", `hook_${digest}.yaml`),
      "linked: true\n",
    );
    const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
    fs.writeFileSync(
      shimPath,
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    fs.chmodSync(shimPath, 0o755);

    const result = spawnSync(
      "bash",
      [path.resolve("base/adapters/claude-code/hooks/work-briefing.sh")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ANAMNESIS_BIN: shimPath,
          ANAMNESIS_NODE: process.execPath,
        },
        input: `${JSON.stringify({
          cwd: projectRoot,
          session_id: sessionId,
          prompt: "brief only",
        })}\n`,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
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

  it("respects zero warm handoff budget when active.md is absent", () => {
    if (process.platform === "win32") return;

    const projectRoot = tmpDir();
    const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      [
        "version: 1",
        "project: { name: fixture }",
        "tools: [claude-code]",
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

    const hook = path.resolve("base/adapters/claude-code/hooks/inject-handoff.sh");
    const compact = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      encoding: "utf8",
    });

    expect(compact.status).toBe(0);
    expect(compact.stderr).toBe("");
    expect(compact.stdout).toBe("");
  });

  it("uses warm handoff budget as an archive count when active.md is absent", () => {
    if (process.platform === "win32") return;

    const projectRoot = tmpDir();
    const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
    fs.mkdirSync(handoffDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "Agentfile"),
      [
        "version: 1",
        "project: { name: fixture }",
        "tools: [claude-code]",
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

    const hook = path.resolve("base/adapters/claude-code/hooks/inject-handoff.sh");
    const compact = spawnSync("bash", [hook], {
      cwd: projectRoot,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
      encoding: "utf8",
    });

    expect(compact.status).toBe(0);
    expect(compact.stderr).toBe("");
    expect(compact.stdout).toContain("- .anamnesis/handoff/new.md");
    expect(compact.stdout).toContain("- .anamnesis/handoff/middle.md");
    expect(compact.stdout).not.toContain("- .anamnesis/handoff/old.md");
    expect(compact.stdout).toContain(
      "Retrieval rule: read the referenced warm archive",
    );
    expect(compact.stdout).toContain("anamnesis context query");
    expect(compact.stdout).toContain("source_path/stable_ref");
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
