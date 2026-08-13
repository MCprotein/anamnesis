#!/usr/bin/env node
// anamnesis Work safe-boundary hook for Claude Code PostToolBatch.
//
// Privacy boundary: tool input/output, transcripts, prompts, and arbitrary
// fields never cross this adapter. A batch containing a top-level agent_id is
// a subagent-internal boundary and is ignored.

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

const EVENT = "PostToolBatch";
const MAX_STABLE_ID_LENGTH = 512;
const SUPPORTED_TOOLS = new Set([
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "Agent",
]);

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
  if (Object.hasOwn(payload, "agent_id")) return null;
  if (
    !validStableId(payload.session_id) ||
    !validStableId(payload.prompt_id)
  ) {
    return null;
  }
  const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : [];
  const events = [];
  for (const rawEvent of toolCalls) {
    const event = safeObject(rawEvent);
    const toolName = safeString(event.tool_name);
    if (!SUPPORTED_TOOLS.has(toolName)) continue;
    if (!validStableId(event.tool_use_id)) return null;
    events.push({ tool_name: toolName, tool_use_id: event.tool_use_id });
  }
  if (events.length === 0) return null;
  return {
    session_id: payload.session_id,
    prompt_id: payload.prompt_id,
    events,
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
    .update(`claude\0${sessionId}`, "utf8")
    .digest("hex");
  return existsSync(join(stateRoot, "work-cursors", `hook_${digest}.yaml`));
}

function writeContext(stdout) {
  if (stdout.length === 0) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: EVENT,
        additionalContext: stdout.toString("utf8"),
      },
    }) + "\n",
  );
}

function failOpen() {}

async function main() {
  const payload = await readPayload();
  const envelope = sanitizedEnvelope(payload);
  if (!envelope) return;
  const projectRoot = resolve(
    safeString(payload.cwd).trim() ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.CODEX_PROJECT_DIR ||
      process.cwd(),
  );
  if (!sessionCursorMayExist(projectRoot, envelope.session_id)) return;
  const executable = findExecutable(projectRoot);
  if (!executable) {
    failOpen();
    return;
  }
  const result = spawnSync(
    executable,
    ["work", "hook-post-tool-use", "--client", "claude-code"],
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
