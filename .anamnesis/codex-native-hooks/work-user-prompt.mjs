#!/usr/bin/env node
// anamnesis Work UserPromptSubmit hook for Codex.
//
// Reads the complete native hook payload as bytes and forwards those exact
// bytes only through stdin. Child stderr and hook input are never returned as
// model context. Every failure is fail-open with a sanitized diagnostic.

import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

const EVENT = "UserPromptSubmit";

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

function payloadCwd(input) {
  try {
    const payload = safeObject(JSON.parse(input.toString("utf8")));
    return typeof payload.cwd === "string" && payload.cwd.trim()
      ? payload.cwd
      : "";
  } catch {
    return "";
  }
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
  if (explicit && isAbsolute(explicit) && isExecutable(explicit)) {
    return explicit;
  }
  const fromPath = findOnPath("anamnesis");
  if (fromPath) return fromPath;
  const local = join(projectRoot, "node_modules", ".bin", "anamnesis");
  if (isExecutable(local)) return local;
  const checkout = join(projectRoot, "cli", "dist", "index.js");
  try {
    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf8"),
    );
    if (
      packageJson?.name === "@mcprotein/anamnesis" &&
      isExecutable(checkout)
    ) {
      return checkout;
    }
  } catch {
    // A source-checkout fallback is optional; normal installations use PATH.
  }
  return "";
}

async function readStdinBuffer() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
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

function failOpen(reason) {
  process.stderr.write(`[anamnesis] Work prompt hook skipped: ${reason}.\n`);
  process.stdout.write("{}\n");
}

async function main() {
  const input = await readStdinBuffer();
  const projectRoot = resolve(
    payloadCwd(input) ||
      process.env.CODEX_PROJECT_DIR ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
  const executable = findExecutable(projectRoot);
  if (!executable) {
    failOpen("executable unavailable");
    return;
  }

  const result = spawnSync(
    executable,
    ["work", "hook-user-prompt", "--client", "codex"],
    {
      cwd: projectRoot,
      env: process.env,
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    failOpen("command failed");
    return;
  }
  writeContext(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0));
}

main().catch(() => failOpen("unexpected failure"));
