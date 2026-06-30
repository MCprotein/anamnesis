#!/usr/bin/env node
// anamnesis Codex native shell-hook bridge.
//
// This wrapper adapts Codex JSON hook input into the environment expected by
// legacy Claude Code shell hooks. The shell script remains the source of the
// fragment-specific check; this file only handles Codex transport details.
// Declared side effects: local-write, repo-external-write

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG = {
  "event": "Stop",
  "scriptPath": ".anamnesis/codex-hooks/base-Stop-handoff-reminder.sh",
  "sideEffects": [
    "local-write",
    "repo-external-write"
  ]
};

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
  for (const line of safeString(command).split(/\r?\n/)) {
    const match =
      line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) ||
      line.match(/^\*\*\* Move to: (.+)$/);
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
    process.stdout.write(JSON.stringify({ decision: "block", reason: text }) + "\n");
    return;
  }
  if (CONFIG.event === "PostToolUse" || CONFIG.event === "UserPromptSubmit") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: CONFIG.event,
        additionalContext: text,
      },
    }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({ systemMessage: text }) + "\n");
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
    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
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

  outputMessage(Array.from(new Set(messages)).join("\n"));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("[anamnesis] Codex native shell-hook bridge failed: " + message + "\n");
});
