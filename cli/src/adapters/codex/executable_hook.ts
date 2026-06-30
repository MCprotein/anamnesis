// Codex adapter — executable_hook support.
//
// Codex native hooks are available through `.codex/hooks.json` when generated
// wrappers are allowed. AGENTS.md fallback regions remain the durable,
// tool-agnostic contract for environments without native hook installation.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  capabilitySideEffects,
  formatSideEffects,
  mergeSideEffects,
} from "../../core/capability_side_effects.js";
import { codexNativeNodeCommand } from "../../core/codex_native.js";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";
import type { CapabilitySideEffect } from "../../core/fragments.js";

const PRE_COMMIT_PATH = ".git/hooks/pre-commit";
const CODEX_NATIVE_SESSION_START_WRAPPER =
  ".anamnesis/codex-native-hooks/session-start.mjs";
const CODEX_NATIVE_SESSION_START_MATCHER = "startup|resume|clear";

const PRE_COMMIT_CONTENT = `#!/usr/bin/env bash
# anamnesis Codex pre-commit bridge.
# Auto-managed by anamnesis. Runs executable_hook fallbacks installed under
# .anamnesis/codex-hooks/ for each staged file.

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOK_DIR="$PROJECT_ROOT/.anamnesis/codex-hooks"

[[ -d "$HOOK_DIR" ]] || exit 0

STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR)"

status=0
shopt -s nullglob

for hook in "$HOOK_DIR"/*.sh; do
  if [[ -z "$STAGED_FILES" ]]; then
    CLAUDE_PROJECT_DIR="$PROJECT_ROOT" CODEX_PROJECT_DIR="$PROJECT_ROOT" "$hook" || status=$?
    continue
  fi

  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    CLAUDE_PROJECT_DIR="$PROJECT_ROOT" \\
    CODEX_PROJECT_DIR="$PROJECT_ROOT" \\
    CLAUDE_TOOL_FILE_PATH="$file" \\
    CODEX_TOOL_FILE_PATH="$file" \\
      "$hook" || status=$?
  done <<< "$STAGED_FILES"
done

exit "$status"
`;

export const executableHookRenderer: CapabilityRenderer = {
  type: "executable_hook",
  adapter: "codex",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "executable_hook") {
      throw new RenderError(
        `executable_hook (codex) given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' hook source not found: ${sourcePath}`,
      );
    }
    const basename = path.basename(capability.source);
    const scriptContent = fs.readFileSync(sourcePath, "utf8");
    const sideEffects = capabilitySideEffects(capability);

    // Region id: deterministic per fragment+hook so updates align.
    const regionId = `codex-hook-${basename.replace(/\.[^.]+$/, "")}`;
    const gitPreCommitEnabled = hasGitHooksDir(ctx.projectRoot);
    const nativeShellHook = codexNativeShellHookSupported(capability.event);

    const content = formatHookRegion({
      fragmentId: ctx.fragment.id,
      basename,
      event: capability.event,
      script: scriptContent,
      sideEffects,
      gitPreCommitEnabled,
      nativeCodexHook: nativeShellHook,
    });

    const scopePath = ctx.scopePath ?? ".";
    const targetFile =
      scopePath === "." || scopePath === ""
        ? ctx.settings.agents_md_path
        : path.posix.join(scopePath, ctx.settings.agents_md_path);

    const actions: RenderAction[] = [
      {
        kind: "region",
        file: targetFile,
        regionId,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
        sideEffects,
      },
    ];

    const nativeSessionStart = baseNativeSessionStartSupported({
      fragmentId: ctx.fragment.id,
      event: capability.event,
      basename,
      fragmentDir: ctx.fragmentDir,
    });
    if (nativeSessionStart) {
      actions.push({
        kind: "file",
        path: CODEX_NATIVE_SESSION_START_WRAPPER,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content: fs.readFileSync(nativeSessionStart.templatePath, "utf8"),
        mode: 0o755,
        sideEffects,
        codexHook: {
          event: "SessionStart",
          matcher: CODEX_NATIVE_SESSION_START_MATCHER,
          command: codexNativeNodeCommand(CODEX_NATIVE_SESSION_START_WRAPPER),
        },
      });
    }

    const scriptActionPath = path.posix.join(
      ".anamnesis/codex-hooks",
      codexHookFilename(ctx.fragment.id, capability.event, basename),
    );
    let scriptActionAdded = false;
    const addScriptAction = (): void => {
      if (scriptActionAdded) return;
      actions.push({
        kind: "file",
        path: scriptActionPath,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content: scriptContent,
        mode: 0o755,
        sideEffects,
      });
      scriptActionAdded = true;
    };

    if (nativeShellHook) {
      addScriptAction();
      const wrapperPath = path.posix.join(
        ".anamnesis/codex-native-hooks",
        codexNativeWrapperFilename(ctx.fragment.id, capability.event, basename),
      );
      actions.push({
        kind: "file",
        path: wrapperPath,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content: codexNativeShellWrapperContent({
          event: nativeShellHook.event,
          scriptPath: scriptActionPath,
          sideEffects,
        }),
        mode: 0o755,
        sideEffects,
        codexHook: {
          event: nativeShellHook.event,
          matcher: nativeShellHook.matcher,
          command: codexNativeNodeCommand(wrapperPath),
          statusMessage: nativeShellHook.statusMessage,
        },
      });
    }

    if (gitPreCommitEnabled && capability.event !== "SessionStart") {
      addScriptAction();
      actions.push(
        {
          kind: "file",
          path: PRE_COMMIT_PATH,
          fragmentId: ctx.fragment.id,
          fragmentVersion: ctx.fragment.version,
          content: PRE_COMMIT_CONTENT,
          mode: 0o755,
          sideEffects: mergeSideEffects(sideEffects, [
            "git-hook",
            "local-write",
          ]),
        },
      );
    }

    return actions;
  },
};

function hasGitHooksDir(projectRoot: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, ".git", "hooks")).isDirectory();
  } catch {
    return false;
  }
}

function codexHookFilename(
  fragmentId: string,
  event: string,
  basename: string,
): string {
  return `${fragmentId}-${event}-${basename}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

function codexNativeWrapperFilename(
  fragmentId: string,
  event: string,
  basename: string,
): string {
  return `${fragmentId}-${event}-${basename.replace(/\.[^.]+$/, "")}.mjs`
    .replace(/[^A-Za-z0-9._-]/g, "-");
}

function parseHookEvent(event: string): { event: string; matcher?: string } {
  const colon = event.indexOf(":");
  if (colon < 0) return { event };
  return {
    event: event.slice(0, colon),
    matcher: event.slice(colon + 1),
  };
}

function codexNativeShellHookSupported(
  capabilityEvent: string,
): { event: string; matcher?: string; statusMessage?: string } | null {
  const parsed = parseHookEvent(capabilityEvent);
  if (
    parsed.event === "PreToolUse" ||
    parsed.event === "PermissionRequest" ||
    parsed.event === "PostToolUse"
  ) {
    if (!parsed.matcher) return null;
    return {
      event: parsed.event,
      matcher: codexMatcherForClaudeMatcher(parsed.matcher),
      statusMessage: `Running anamnesis ${parsed.event} hook`,
    };
  }
  if (parsed.event === "Stop" || parsed.event === "UserPromptSubmit") {
    return {
      event: parsed.event,
      statusMessage: `Running anamnesis ${parsed.event} hook`,
    };
  }
  return null;
}

function codexMatcherForClaudeMatcher(matcher: string): string {
  if (matcher === "Edit") return "Edit|Write|apply_patch";
  return matcher;
}

function formatHookRegion(params: {
  fragmentId: string;
  basename: string;
  event: string;
  script: string;
  sideEffects: readonly CapabilitySideEffect[];
  gitPreCommitEnabled: boolean;
  nativeCodexHook: { event: string; matcher?: string } | null;
}): string {
  return [
    `### ${params.fragmentId} hook: \`${params.basename}\``,
    "",
    `**When:** \`${params.event}\` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).`,
    "",
    params.event === "SessionStart"
      ? "**Codex native path:** when executable adapter writes are allowed, anamnesis installs `.anamnesis/codex-native-hooks/session-start.mjs` and registers it in `.codex/hooks.json`. This region remains the manual fallback."
      : params.nativeCodexHook
        ? `**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under \`.anamnesis/codex-native-hooks/\` and registers \`${params.nativeCodexHook.event}${params.nativeCodexHook.matcher ? `:${params.nativeCodexHook.matcher}` : ""}\` in \`.codex/hooks.json\`. This region remains the manual fallback.`
      : params.gitPreCommitEnabled
        ? "**Codex fallback:** eligible for best-effort Git `pre-commit` installation under `.anamnesis/codex-hooks/` when executable adapter writes are allowed and no user-owned hook blocks it."
        : "**Codex fallback:** documented here only; no `.git/hooks/` directory was present during rendering.",
    "",
    params.sideEffects.length > 0
      ? `**Declared side effects:** ${formatSideEffects(params.sideEffects)}.`
      : "",
    params.sideEffects.length > 0 ? "" : "",
    `**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).`,
    "",
    "```bash",
    params.script.trimEnd(),
    "```",
  ].join("\n");
}

function codexNativeShellWrapperContent(params: {
  event: string;
  scriptPath: string;
  sideEffects: readonly CapabilitySideEffect[];
}): string {
  const config = JSON.stringify(params, null, 2);
  return `#!/usr/bin/env node
// anamnesis Codex native shell-hook bridge.
//
// This wrapper adapts Codex JSON hook input into the environment expected by
// legacy Claude Code shell hooks. The shell script remains the source of the
// fragment-specific check; this file only handles Codex transport details.
// Declared side effects: ${params.sideEffects.join(", ")}

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG = ${config};

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return safeObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function findGitRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status === 0 && result.stdout.trim()) {
    return resolve(result.stdout.trim());
  }
  return resolve(cwd);
}

function stringify(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function extractPatchTargets(command) {
  const targets = [];
  for (const line of safeString(command).split(/\\r?\\n/)) {
    const match =
      line.match(/^\\*\\*\\* (?:Add|Update|Delete) File: (.+)$/) ||
      line.match(/^\\*\\*\\* Move to: (.+)$/);
    if (match?.[1]) targets.push(match[1].trim());
  }
  return Array.from(new Set(targets));
}

function extractTargets(payload) {
  const input = safeObject(payload.tool_input);
  const direct = [
    input.file_path,
    input.path,
    input.file,
    input.target,
  ].filter((value) => typeof value === "string" && value.trim());
  const fromPatch = extractPatchTargets(input.command ?? input.patch);
  return Array.from(new Set([...direct, ...fromPatch]));
}

function outputMessage(message) {
  const text = message.trim();
  if (!text) return;
  if (CONFIG.event === "Stop") {
    process.stdout.write(JSON.stringify({ decision: "block", reason: text }) + "\\n");
    return;
  }
  if (CONFIG.event === "PostToolUse" || CONFIG.event === "UserPromptSubmit") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: CONFIG.event,
        additionalContext: text,
      },
    }) + "\\n");
    return;
  }
  process.stdout.write(JSON.stringify({ systemMessage: text }) + "\\n");
}

async function main() {
  const payload = await readStdinJson();
  const cwd = resolve(
    safeString(payload.cwd).trim() ||
      process.env.CODEX_PROJECT_DIR ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
  const projectRoot = findGitRoot(cwd);
  const scriptPath = resolve(projectRoot, CONFIG.scriptPath);

  if (!existsSync(scriptPath)) {
    outputMessage("[anamnesis] Codex native hook script is missing: " + CONFIG.scriptPath);
    return;
  }

  const targets = extractTargets(payload);
  const runs = targets.length > 0 ? targets : [""];
  const messages = [];

  for (const target of runs) {
    const env = {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectRoot,
      CODEX_PROJECT_DIR: projectRoot,
      CLAUDE_TOOL_FILE_PATH: target,
      CODEX_TOOL_FILE_PATH: target,
      CODEX_HOOK_EVENT_NAME: safeString(payload.hook_event_name) || CONFIG.event,
      CODEX_TOOL_NAME: safeString(payload.tool_name),
      CODEX_TOOL_INPUT: stringify(payload.tool_input),
      CODEX_TOOL_RESPONSE: stringify(payload.tool_response),
    };
    const result = spawnSync("bash", [scriptPath], {
      cwd: projectRoot,
      env,
      encoding: "utf8",
    });
    const combined = [result.stdout, result.stderr].filter(Boolean).join("\\n").trim();
    if (combined) messages.push(combined);
    if (typeof result.status === "number" && result.status !== 0 && !combined) {
      messages.push(
        "[anamnesis] Codex native hook script exited with status " +
          result.status +
          ": " +
          CONFIG.scriptPath,
      );
    }
  }

  outputMessage(Array.from(new Set(messages)).join("\\n"));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("[anamnesis] Codex native shell-hook bridge failed: " + message + "\\n");
});
`;
}

function baseNativeSessionStartSupported(params: {
  fragmentId: string;
  event: string;
  basename: string;
  fragmentDir: string;
}): { templatePath: string } | null {
  if (params.fragmentId !== "base") return null;
  if (params.event !== "SessionStart") return null;
  if (
    params.basename !== "inject-ontology.sh" &&
    params.basename !== "inject-handoff.sh"
  ) {
    return null;
  }
  const templatePath = path.join(
    params.fragmentDir,
    "adapters/codex/hooks/session-start.mjs",
  );
  if (!fs.existsSync(templatePath)) {
    throw new RenderError(
      `base Codex SessionStart wrapper not found: ${templatePath}`,
    );
  }
  return { templatePath };
}
