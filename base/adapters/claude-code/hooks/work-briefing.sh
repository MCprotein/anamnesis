#!/bin/sh
':' //; set -eu
':' //; exec "${ANAMNESIS_NODE:-node}" -e 'require(process.argv[1])' "$0" "$@"
// anamnesis Work UserPromptSubmit hook for Claude Code.
// This shell/Node polyglot keeps the installed hook path stable while using a
// byte-preserving JSON preflight. Raw prompt bytes never enter argv, logs, or
// temporary files.

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} = require("node:fs");
const { delimiter, dirname, isAbsolute, join, resolve } = require("node:path");

const MAX_STABLE_ID_LENGTH = 512;
const MAX_AGENTFILE_BYTES = 256 * 1024;
// Includes the native JSON envelope around the 8 MiB decoded prompt hard cap.
const MAX_HOOK_INPUT_BYTES = 10 * 1024 * 1024;
const AGENTFILE_CANDIDATES = [
  "Agentfile",
  "agentfile.yaml",
  "agentfile.yml",
  ".anamnesis/agentfile.yaml",
];

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

function isExecutable(candidate) {
  if (!candidate) return false;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
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

async function readStdinBuffer() {
  const chunks = [];
  let totalBytes = 0;
  let oversized = false;
  for await (const chunk of process.stdin) {
    if (oversized) continue;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.length;
    if (totalBytes > MAX_HOOK_INPUT_BYTES) {
      oversized = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  return oversized ? null : Buffer.concat(chunks, totalBytes);
}

function stripYamlComment(line) {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !double) single = !single;
    if (char === '"' && !single && line[index - 1] !== "\\") double = !double;
    if (char === "#" && !single && !double) return line.slice(0, index);
  }
  return line;
}

function yamlKeyPattern(key) {
  return `(?:${key}|"${key}"|'${key}')`;
}

function yamlHasKey(source, key) {
  return new RegExp(
    `(?:^|[\\n{,])\\s*${yamlKeyPattern(key)}\\s*:`,
    "u",
  ).test(source);
}

function yamlKeyIsClearlyOff(source, key, ancestors) {
  const keyPattern = yamlKeyPattern(key);
  const presetPattern = yamlKeyPattern("preset");
  const offPattern = `(?:off|"off"|'off')`;
  const occurrences = source.match(
    new RegExp(`(?:^|[\\n{,])\\s*${keyPattern}\\s*:`, "gu"),
  );
  if (occurrences?.length !== 1) return false;

  const flowPath = ancestors
    .map(
      (ancestor) =>
        `${yamlKeyPattern(ancestor)}\\s*:\\s*\\{[^{}\\n]*`,
    )
    .join("");
  if (
    new RegExp(
      `(?:^|[\\n{,])\\s*${flowPath}${keyPattern}\\s*:\\s*\\{\\s*${presetPattern}\\s*:\\s*${offPattern}\\s*\\}`,
      "u",
    ).test(source)
  ) {
    return true;
  }

  const lines = source.split("\n");
  const keyLine = new RegExp(`^([ \\t]*)${keyPattern}\\s*:\\s*$`, "u");
  const anyKeyLine = /^([ \t]*)(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]+"|'[^']+')\s*:/u;
  for (let index = 0; index < lines.length; index += 1) {
    const match = keyLine.exec(lines[index]);
    if (!match) continue;
    const parentIndent = match[1].length;
    const foundAncestors = [];
    let enclosingIndent = parentIndent;
    for (let back = index - 1; back >= 0; back -= 1) {
      const candidate = anyKeyLine.exec(lines[back]);
      if (!candidate || candidate[1].length >= enclosingIndent) continue;
      foundAncestors.unshift(
        candidate[0]
          .slice(candidate[1].length, candidate[0].lastIndexOf(":"))
          .replace(/^["']|["']$/gu, ""),
      );
      enclosingIndent = candidate[1].length;
    }
    if (foundAncestors.slice(-ancestors.length).join("\0") !== ancestors.join("\0")) {
      continue;
    }
    let next = index + 1;
    while (next < lines.length && lines[next].trim() === "") next += 1;
    const preset = new RegExp(
      `^([ \\t]+)${presetPattern}\\s*:\\s*${offPattern}\\s*$`,
      "u",
    ).exec(lines[next] ?? "");
    if (!preset || preset[1].length <= parentIndent) continue;
    next += 1;
    while (next < lines.length && lines[next].trim() === "") next += 1;
    const followingIndent = /^([ \t]*)/u.exec(lines[next] ?? "")?.[1].length ?? 0;
    if (next === lines.length || followingIndent <= parentIndent) return true;
  }
  return false;
}

function projectPolicySignals(projectRoot) {
  const captureOptIn = process.env.ANAMNESIS_WORK_PROMPT_CAPTURE === "1";
  try {
    const found = AGENTFILE_CANDIDATES.map((name) => join(projectRoot, name)).filter(
      (candidate) => existsSync(candidate),
    );
    if (found.length === 0) return { capture: false, reconciliation: false };
    if (found.length !== 1 || statSync(found[0]).size > MAX_AGENTFILE_BYTES) {
      return { capture: captureOptIn, reconciliation: true };
    }
    const source = readFileSync(found[0], "utf8")
      .split(/\r?\n/u)
      .map((line) => stripYamlComment(line).replace(/[ \t]+$/u, ""))
      .join("\n");
    const hasCapture = yamlHasKey(source, "work_prompt_capture");
    const hasReconciliation = yamlHasKey(source, "reconciliation");
    const isVersion2 = /(?:^|[\n{,])\s*(?:version|"version"|'version')\s*:\s*(?:2|"2"|'2')(?=\s*(?:$|[\n,}]))/mu.test(
      source,
    );
    if ((hasCapture || hasReconciliation) && !isVersion2) {
      return { capture: captureOptIn && hasCapture, reconciliation: true };
    }
    return {
      capture:
        captureOptIn &&
        hasCapture &&
        !yamlKeyIsClearlyOff(source, "work_prompt_capture", ["settings"]),
      reconciliation:
        hasReconciliation &&
        !yamlKeyIsClearlyOff(source, "reconciliation", [
          "settings",
          "work_policy",
        ]),
    };
  } catch {
    return { capture: captureOptIn, reconciliation: true };
  }
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

function sessionCursorExists(projectRoot, sessionId) {
  const stateRoot = canonicalStateRoot(projectRoot);
  if (!stateRoot) return false;
  const digest = createHash("sha256")
    .update(`claude\0${sessionId}`, "utf8")
    .digest("hex");
  return existsSync(join(stateRoot, "work-cursors", `hook_${digest}.yaml`));
}

function writeOutput(stdout) {
  if (stdout.length > 0) process.stdout.write(stdout);
}

function failOpen(reason = "") {
  if (reason) {
    process.stderr.write(`[anamnesis] Work prompt hook skipped: ${reason}.\n`);
  }
}

async function main() {
  const input = await readStdinBuffer();
  if (input === null) {
    failOpen();
    return;
  }
  let payload = {};
  try {
    payload = safeObject(JSON.parse(input.toString("utf8")));
  } catch {
    failOpen();
    return;
  }
  if (!validStableId(payload.session_id)) {
    failOpen();
    return;
  }
  if (!validStableId(payload.prompt_id)) {
    failOpen();
    return;
  }
  const projectRoot = resolve(
    safeString(payload.cwd).trim() ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.CODEX_PROJECT_DIR ||
      process.cwd(),
  );
  const cursorExists = sessionCursorExists(projectRoot, payload.session_id);
  const policy = projectPolicySignals(projectRoot);
  if (
    !cursorExists &&
    !policy.capture &&
    !policy.reconciliation
  ) {
    failOpen();
    return;
  }
  const executable = findExecutable(projectRoot);
  if (!executable) {
    failOpen("executable unavailable");
    return;
  }
  const result = spawnSync(
    executable,
    ["work", "hook-user-prompt", "--client", "claude-code"],
    {
      cwd: projectRoot,
      env: process.env,
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 35_000,
    },
  );
  if (result.error || result.status !== 0) {
    failOpen("command failed");
    return;
  }
  writeOutput(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0));
}

main().catch(() => failOpen("unexpected failure"));
