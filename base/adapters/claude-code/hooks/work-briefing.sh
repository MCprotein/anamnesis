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

function promptCaptureFieldsAreValid(entries) {
  const allowed = new Set([
    "preset",
    "ttl",
    "max_entry_bytes",
    "max_total_bytes",
    "max_entries",
  ]);
  const values = new Map();
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.replace(/^["']|["']$/gu, "");
    if (!allowed.has(key) || values.has(key)) return false;
    values.set(key, rawValue.trim());
  }
  const scalar = (value) => value?.replace(/^["']|["']$/gu, "");
  if (scalar(values.get("preset")) !== "bounded") return false;

  const ttl = scalar(values.get("ttl"));
  if (ttl !== undefined) {
    const match = /^PT(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(ttl);
    if (!match) return false;
    const milliseconds =
      ((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60 +
        Number(match[3] ?? 0)) *
      1_000;
    if (
      !Number.isSafeInteger(milliseconds) ||
      milliseconds <= 0 ||
      milliseconds > 30 * 24 * 60 * 60 * 1_000
    ) {
      return false;
    }
  }

  const boundedInteger = (key, fallback, maximum) => {
    const value = values.get(key);
    if (value === undefined) return fallback;
    if (!/^[1-9]\d*$/u.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
  };
  const entry = boundedInteger("max_entry_bytes", 256 * 1024, 8 * 1024 * 1024);
  const total = boundedInteger(
    "max_total_bytes",
    2 * 1024 * 1024,
    64 * 1024 * 1024,
  );
  const count = boundedInteger("max_entries", 64, 1_024);
  return entry !== null && total !== null && count !== null && total >= entry;
}

function parseFlowPromptCaptureFields(body) {
  if (body.trim() === "") return null;
  const entries = [];
  for (const part of body.split(",")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*|"[^"]+"|'[^']+')\s*:\s*([^,{}\n]+?)\s*$/u.exec(
      part,
    );
    if (!match) return null;
    entries.push([match[1], match[2]]);
  }
  return entries;
}

function yamlRootShapeIsUnambiguous(source) {
  const allowed = new Set([
    "version",
    "project",
    "tools",
    "fragments",
    "declined",
    "overrides",
    "settings",
  ]);
  const required = ["version", "project", "tools", "fragments", "settings"];
  const rootEntries = [];
  const trimmed = source.trimStart();

  if (trimmed.startsWith("{")) {
    const key = /(?:^|[\n{,])\s*([A-Za-z_][A-Za-z0-9_]*|"[^"]+"|'[^']+')\s*:/gu;
    let single = false;
    let double = false;
    let depth = 0;
    const depths = new Array(source.length + 1).fill(0);
    for (let index = 0; index < source.length; index += 1) {
      depths[index] = depth;
      const char = source[index];
      if (char === "'" && !double) single = !single;
      if (char === '"' && !single && source[index - 1] !== "\\") double = !double;
      if (single || double) continue;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth < 0) return false;
    }
    if (depth !== 0 || single || double) return false;
    for (const match of source.matchAll(key)) {
      const keyOffset = match[0].indexOf(match[1]);
      if (depths[(match.index ?? 0) + keyOffset] !== 1) continue;
      const colon = (match.index ?? 0) + match[0].lastIndexOf(":");
      rootEntries.push([
        match[1].replace(/^["']|["']$/gu, ""),
        source.slice(colon + 1),
      ]);
    }
  } else {
    for (const line of source.split("\n")) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*|"[^"]+"|'[^']+')\s*:\s*(.*)$/u.exec(
        line,
      );
      if (!match) continue;
      rootEntries.push([match[1].replace(/^["']|["']$/gu, ""), match[2]]);
    }
  }

  const root = new Map();
  for (const [key, remainder] of rootEntries) {
    if (!allowed.has(key) || root.has(key)) return false;
    root.set(key, remainder);
  }
  if (required.some((key) => !root.has(key))) return false;
  return /^2(?=\s*(?:$|[,}]))/u.test(
    root.get("version")?.trim() ?? "",
  );
}

function yamlCaptureIsClearlyBounded(source) {
  if (!yamlRootShapeIsUnambiguous(source)) return false;
  const capturePattern = yamlKeyPattern("work_prompt_capture");
  const occurrences = source.match(
    new RegExp(`(?:^|[\\n{,])\\s*${capturePattern}\\s*:`, "gu"),
  );
  if (occurrences?.length !== 1) return false;

  const settingsPattern = yamlKeyPattern("settings");
  const strictFlow = new RegExp(
    `(?:^|[\\n{,])\\s*${settingsPattern}\\s*:\\s*\\{\\s*${capturePattern}\\s*:\\s*\\{([^{}\\n]*)\\}\\s*\\}`,
    "u",
  ).exec(source);
  if (strictFlow) {
    const entries = parseFlowPromptCaptureFields(strictFlow[1]);
    return entries !== null && promptCaptureFieldsAreValid(entries);
  }

  const lines = source.split("\n");
  const captureLine = new RegExp(
    `^([ \\t]*)${capturePattern}\\s*:\\s*(?:\\{([^{}]*)\\})?\\s*$`,
    "u",
  );
  const anyKeyLine = /^([ \t]*)(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]+"|'[^']+')\s*:/u;
  for (let index = 0; index < lines.length; index += 1) {
    const match = captureLine.exec(lines[index]);
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
    if (foundAncestors.join("\0") !== "settings") return false;
    if (match[2] !== undefined) {
      const entries = parseFlowPromptCaptureFields(match[2]);
      return entries !== null && promptCaptureFieldsAreValid(entries);
    }

    const entries = [];
    let childIndent = null;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === "") continue;
      const indent = /^([ \t]*)/u.exec(lines[next])?.[1].length ?? 0;
      if (indent <= parentIndent) break;
      if (childIndent === null) childIndent = indent;
      if (indent !== childIndent) return false;
      const child = /^\s*([A-Za-z_][A-Za-z0-9_]*|"[^"]+"|'[^']+')\s*:\s*([^{}\[\],\n]+?)\s*$/u.exec(
        lines[next],
      );
      if (!child) return false;
      entries.push([child[1], child[2]]);
    }
    return entries.length > 0 && promptCaptureFieldsAreValid(entries);
  }
  return false;
}

function projectPolicySignals(projectRoot) {
  try {
    const found = AGENTFILE_CANDIDATES.map((name) => join(projectRoot, name)).filter(
      (candidate) => existsSync(candidate),
    );
    if (found.length === 0) {
      return { valid: true, capture: false, reconciliation: false };
    }
    if (found.length !== 1 || statSync(found[0]).size > MAX_AGENTFILE_BYTES) {
      return { valid: false, capture: false, reconciliation: false };
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
      return { valid: false, capture: false, reconciliation: false };
    }
    return {
      valid: true,
      capture: hasCapture && yamlCaptureIsClearlyBounded(source),
      reconciliation:
        hasReconciliation &&
        !yamlKeyIsClearlyOff(source, "reconciliation", [
          "settings",
          "work_policy",
        ]),
    };
  } catch {
    return { valid: false, capture: false, reconciliation: false };
  }
}

function sanitizedPromptInput(payload) {
  return Buffer.from(
    `${JSON.stringify({
      cwd: safeString(payload.cwd),
      hook_event_name: safeString(payload.hook_event_name),
      session_id: safeString(payload.session_id),
      prompt_id: safeString(payload.prompt_id),
      prompt: "",
    })}\n`,
    "utf8",
  );
}

function capturePolicyIsValid(executable, projectRoot) {
  const result = spawnSync(
    executable,
    ["work", "hook-policy-probe", "--project-root", projectRoot],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    },
  );
  if (result.error || result.status !== 0) return false;
  try {
    const output = safeObject(
      JSON.parse(Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : ""),
    );
    return (
      output.schema_version === "anamnesis.work-prompt-policy-probe.v1" &&
      output.capture_enabled === true
    );
  } catch {
    return false;
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
  if (!policy.valid) {
    failOpen();
    return;
  }
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
  const captureAuthorized =
    policy.capture && capturePolicyIsValid(executable, projectRoot);
  if (!captureAuthorized && !policy.reconciliation && !cursorExists) {
    failOpen();
    return;
  }
  const result = spawnSync(
    executable,
    ["work", "hook-user-prompt", "--client", "claude-code"],
    {
      cwd: projectRoot,
      env: process.env,
      input: captureAuthorized ? input : sanitizedPromptInput(payload),
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
