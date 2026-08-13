#!/usr/bin/env node
// anamnesis Work safe-boundary hook for Codex PostToolUse.
//
// Privacy boundary: only stable event identifiers are sent to the CLI. Tool
// input/output, transcripts, prompts, and arbitrary hook fields are discarded.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

const EVENT = "PostToolUse";
const MAX_STABLE_ID_LENGTH = 512;
const SUPPORTED_TOOLS = new Set(["Bash", "apply_patch", "Agent"]);

function isExecutable(candidate) {
  if (!candidate) return false;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function validStableId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_STABLE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function findOnPath(name) {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, name);
    if (isExecutable(candidate)) return candidate;
  }
  return "";
}

function findExecutable(projectRoot) {
  const explicit = process.env.ANAMNESIS_BIN ?? "";
  if (explicit && isAbsolute(explicit) && isExecutable(explicit)) return explicit;
  const fromPath = findOnPath("anamnesis");
  if (fromPath) return fromPath;
  const local = join(projectRoot, "node_modules", ".bin", "anamnesis");
  if (isExecutable(local)) return local;
  const checkout = join(projectRoot, "cli", "dist", "index.js");
  try {
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf8"),
    );
    if (packageJson?.name === "@mcprotein/anamnesis" && isExecutable(checkout)) {
      return checkout;
    }
  } catch {
    // Source-checkout fallback is optional.
  }
  return "";
}

async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  try {
    return safeObject(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return {};
  }
}

function sanitizedEnvelope(payload) {
  const toolName = safeString(payload.tool_name);
  if (!SUPPORTED_TOOLS.has(toolName)) return null;
  if (
    !validStableId(payload.session_id) ||
    !validStableId(payload.turn_id) ||
    !validStableId(payload.tool_use_id)
  ) {
    return null;
  }
  return {
    session_id: payload.session_id,
    turn_id: payload.turn_id,
    events: [
      {
        tool_name: toolName,
        tool_use_id: payload.tool_use_id,
      },
    ],
  };
}

function findGitMarker(start) {
  let current = start;
  while (true) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function canonicalStateRoot(projectRoot) {
  if (!findGitMarker(projectRoot)) {
    try {
      return join(realpathSync(projectRoot), ".anamnesis");
    } catch {
      return null;
    }
  }
  const git = spawnSync(
    "git",
    ["-C", projectRoot, "worktree", "list", "--porcelain", "-z"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 500 },
  );
  if (!git.error && git.status === 0) {
    const first = git.stdout
      .split("\0")
      .find((entry) => entry.startsWith("worktree "))
      ?.slice("worktree ".length);
    return first ? join(realpathSync(first), ".anamnesis") : null;
  }
  return null;
}

function sessionCursorMayExist(projectRoot, sessionId) {
  // An explicit executable is an operator/test override; let the CLI decide.
  if (process.env.ANAMNESIS_BIN) return true;
  const stateRoot = canonicalStateRoot(projectRoot);
  if (!stateRoot) return true;
  const digest = createHash("sha256")
    .update(`codex\0${sessionId}`, "utf8")
    .digest("hex");
  return existsSync(join(stateRoot, "work-cursors", `hook_${digest}.yaml`));
}

function writeContext(stdout) {
  if (stdout.length === 0) {
    process.stdout.write("{}\n");
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: EVENT,
        additionalContext: stdout.toString("utf8"),
      },
    }) + "\n",
  );
}

function failOpen() {
  process.stdout.write("{}\n");
}

async function main() {
  const payload = await readPayload();
  const envelope = sanitizedEnvelope(payload);
  if (!envelope) {
    process.stdout.write("{}\n");
    return;
  }
  const projectRoot = resolve(
    safeString(payload.cwd).trim() ||
      process.env.CODEX_PROJECT_DIR ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
  if (!sessionCursorMayExist(projectRoot, envelope.session_id)) {
    failOpen();
    return;
  }
  const executable = findExecutable(projectRoot);
  if (!executable) {
    failOpen();
    return;
  }
  const result = spawnSync(
    executable,
    ["work", "hook-post-tool-use", "--client", "codex"],
    {
      cwd: projectRoot,
      env: process.env,
      input: Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8"),
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 35_000,
    },
  );
  if (result.error || result.status !== 0) {
    failOpen();
    return;
  }
  writeContext(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0));
}

main().catch(() => failOpen());
