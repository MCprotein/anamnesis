#!/usr/bin/env node
// anamnesis Codex SessionStart hook.
//
// Codex native hooks expect JSON output. This wrapper reads the same context
// that the Claude Code SessionStart shell hooks print, then returns it as
// hookSpecificOutput.additionalContext.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 768 * 1024;
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
]);

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

function projectRootFromPayload(payload) {
  return resolve(
    safeString(payload.cwd).trim() ||
      process.env.CODEX_PROJECT_DIR ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.cwd(),
  );
}

function readBoundedFile(filePath, remainingBudget) {
  const limit = Math.max(0, Math.min(MAX_FILE_BYTES, remainingBudget));
  if (limit === 0) return "";
  const buffer = readFileSync(filePath);
  const sliced = buffer.subarray(0, limit).toString("utf8");
  return buffer.length > limit
    ? `${sliced}\n\n[anamnesis: truncated ${buffer.length - limit} bytes]\n`
    : sliced;
}

function isUnderOntologyDir(filePath) {
  const normalized = filePath.split(sep).join("/");
  return /\/\.anamnesis\/ontology\/[^/]+\.yaml$/.test(normalized);
}

function walkOntologyFiles(projectRoot) {
  const out = [];
  const stack = [projectRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      if (entry.isFile() && isUnderOntologyDir(abs)) {
        out.push(abs);
      }
    }
  }
  return out.sort((a, b) => relative(projectRoot, a).localeCompare(relative(projectRoot, b)));
}

function newestArchivedHandoff(handoffDir) {
  let newest = "";
  let newestMtime = -1;
  let entries;
  try {
    entries = readdirSync(handoffDir, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md") || entry.name === "active.md") continue;
    const abs = join(handoffDir, entry.name);
    let mtime = 0;
    try {
      mtime = statSync(abs).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newest = abs;
    }
  }
  return newest;
}

function fileExists(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function pushFileSection(sections, projectRoot, title, filePath, budget) {
  if (!filePath || !fileExists(filePath) || budget.remaining <= 0) return;
  const rel = relative(projectRoot, filePath).split(sep).join("/");
  const body = readBoundedFile(filePath, budget.remaining);
  budget.remaining -= Buffer.byteLength(body, "utf8");
  sections.push([title ?? `--- ${rel} ---`, body.trimEnd()].join("\n"));
}

function buildOntologySection(projectRoot, budget) {
  const ontologyFiles = walkOntologyFiles(projectRoot);
  const systemGraph = join(projectRoot, "system_graph.yaml");
  if (ontologyFiles.length === 0 && !fileExists(systemGraph)) return null;

  const sections = [
    [
      "=== anamnesis: ontology context ===",
      "",
      "Project ontology and invariants. Check this before re-deriving architecture from filenames or logs.",
    ].join("\n"),
  ];
  pushFileSection(
    sections,
    projectRoot,
    "--- system_graph.yaml (user-managed) ---",
    systemGraph,
    budget,
  );
  for (const filePath of ontologyFiles) {
    pushFileSection(
      sections,
      projectRoot,
      `--- ${relative(projectRoot, filePath).split(sep).join("/")} ---`,
      filePath,
      budget,
    );
  }
  return sections.join("\n\n");
}

function buildHandoffSection(projectRoot, budget) {
  const handoffDir = join(projectRoot, ".anamnesis", "handoff");
  if (!dirExists(handoffDir)) return null;

  const active = join(handoffDir, "active.md");
  const latest = newestArchivedHandoff(handoffDir);
  if (!fileExists(active) && !latest) return null;

  const sections = [
    [
      "=== anamnesis: handoff ===",
      "",
      "Previous-session handoff. Use it to resume work; ignore it when git history shows it is stale.",
    ].join("\n"),
  ];
  pushFileSection(sections, projectRoot, `Source: ${relative(projectRoot, active).split(sep).join("/")}`, active, budget);
  if (latest) {
    const rel = relative(projectRoot, latest).split(sep).join("/");
    pushFileSection(sections, projectRoot, `--- most recent archived handoff: ${rel} ---`, latest, budget);
  }
  sections.push("--- end of handoff ---");
  return sections.join("\n\n");
}

async function main() {
  const payload = await readStdinJson();
  const projectRoot = projectRootFromPayload(payload);
  const budget = { remaining: MAX_TOTAL_BYTES };
  const sections = [
    buildOntologySection(projectRoot, budget),
    buildHandoffSection(projectRoot, budget),
  ].filter(Boolean);

  if (sections.length === 0) return;
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: sections.join("\n\n"),
      },
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `[anamnesis] Codex SessionStart hook failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
});
