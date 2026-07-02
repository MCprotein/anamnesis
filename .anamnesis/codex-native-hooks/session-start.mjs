#!/usr/bin/env node
// anamnesis Codex SessionStart hook.
//
// Codex native hooks expect JSON output. This wrapper reads the same context
// that the Claude Code SessionStart shell hooks expose, then returns compact
// source pointers by default as hookSpecificOutput.additionalContext. Set
// ANAMNESIS_SESSION_CONTEXT_MODE=full to emit full file bodies for
// compatibility/debugging.

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
    if (
      !entry.name.endsWith(".md") ||
      entry.name === "active.md" ||
      entry.name === "draft.md"
    ) {
      continue;
    }
    const abs = join(handoffDir, entry.name);
    if (isInactiveHandoffArchive(abs)) continue;
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

function activeHandoffArchiveRefs(activePath) {
  if (!fileExists(activePath)) return [];
  const refs = new Set();
  const lines = readFileSync(activePath, "utf8").split(/\r?\n/);
  let inOpenSection = false;
  const pattern =
    /\.anamnesis\/handoff\/(?!active\.md)(?!draft\.md)(?!drafts\/)[^`\s)]+\.md/g;
  for (const line of lines) {
    if (line === "## Current focus" || line === "## Active tasks") {
      inOpenSection = true;
      continue;
    }
    if (line.startsWith("## ")) {
      inOpenSection = false;
      continue;
    }
    if (!inOpenSection || !line.startsWith("- ")) continue;
    for (const match of line.matchAll(pattern)) {
      refs.add(match[0]);
    }
  }
  return [...refs].sort();
}

function archivePathFromRef(projectRoot, ref) {
  if (
    typeof ref !== "string" ||
    ref.includes("..") ||
    !ref.startsWith(".anamnesis/handoff/") ||
    !ref.endsWith(".md") ||
    ref.startsWith(".anamnesis/handoff/drafts/")
  ) {
    return "";
  }
  const abs = resolve(projectRoot, ref);
  if (abs !== projectRoot && !abs.startsWith(`${projectRoot}${sep}`)) return "";
  return abs;
}

function handoffFrontmatter(filePath) {
  if (!fileExists(filePath)) return {};
  const text = readFileSync(filePath, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const out = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!item) continue;
    out[item[1]] = item[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return out;
}

function isInactiveHandoffArchive(filePath) {
  const frontmatter = handoffFrontmatter(filePath);
  const status = safeString(frontmatter.handoff_status).toLowerCase();
  const tier = safeString(frontmatter.retention_tier).toLowerCase();
  return (
    status === "closed" ||
    status === "deprecated" ||
    status === "superseded" ||
    tier === "cold" ||
    tier === "deprecated" ||
    safeString(frontmatter.superseded_by).length > 0
  );
}

function selectedHandoffArchives(projectRoot, activePath, handoffDir) {
  if (!fileExists(activePath)) {
    const latest = newestArchivedHandoff(handoffDir);
    return latest ? [latest] : [];
  }
  return activeHandoffArchiveRefs(activePath)
    .map((ref) => archivePathFromRef(projectRoot, ref))
    .filter((filePath) => filePath && fileExists(filePath))
    .filter((filePath) => !isInactiveHandoffArchive(filePath));
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

function sessionContextMode() {
  return process.env.ANAMNESIS_SESSION_CONTEXT_MODE === "full" ? "full" : "compact";
}

function fileStats(filePath) {
  const body = readFileSync(filePath, "utf8");
  return {
    bytes: Buffer.byteLength(body, "utf8"),
    lines: body.length === 0 ? 0 : body.split(/\r?\n/).length - (body.endsWith("\n") ? 1 : 0),
  };
}

function sourcePointer(projectRoot, filePath, label) {
  const rel = relative(projectRoot, filePath).split(sep).join("/");
  const stats = fileStats(filePath);
  const suffix = label ? `; ${label}` : "";
  return `- ${rel} (${stats.bytes} bytes, ${stats.lines} lines${suffix})`;
}

function activeHandoffSummary(activePath) {
  if (!fileExists(activePath)) return [];
  const lines = readFileSync(activePath, "utf8").split(/\r?\n/);
  const out = [];
  let inSummarySection = false;
  for (const line of lines) {
    if (line === "## Current focus" || line === "## Active tasks") {
      inSummarySection = true;
      continue;
    }
    if (line.startsWith("## ")) {
      inSummarySection = false;
      continue;
    }
    if (inSummarySection && line.startsWith("- ")) {
      out.push(line);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function invariantDigest(files, projectRoot, maxLines = 12) {
  const out = [];
  const pattern =
    /(must|never|always|invariant|rule|severity:\s*"?must|필수|금지|항상|절대)/i;
  for (const filePath of files) {
    if (!fileExists(filePath)) continue;
    const rel = relative(projectRoot, filePath).split(sep).join("/");
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!pattern.test(line)) continue;
      out.push(`- ${rel}: ${line.trimStart()}`);
      if (out.length >= maxLines) return out;
    }
  }
  return out;
}

function buildOntologySection(projectRoot, budget, mode = sessionContextMode()) {
  const ontologyFiles = walkOntologyFiles(projectRoot);
  const systemGraph = join(projectRoot, "system_graph.yaml");
  if (ontologyFiles.length === 0 && !fileExists(systemGraph)) return null;

  const sections = [
    [
      "=== anamnesis: ontology context ===",
      "",
      "Project ontology and invariants. Read exact source files before relying on relationships, paths, or operational rules.",
    ].join("\n"),
  ];
  if (mode !== "full") {
    sections.push("Mode: compact (set ANAMNESIS_SESSION_CONTEXT_MODE=full for full file injection)");
    sections.push("Source pointers:");
    if (fileExists(systemGraph)) {
      sections.push(sourcePointer(projectRoot, systemGraph, "user-managed top-level ontology"));
    }
    for (const filePath of ontologyFiles) {
      sections.push(sourcePointer(projectRoot, filePath, "managed ontology slice"));
    }
    const digest = invariantDigest(
      [fileExists(systemGraph) ? systemGraph : "", ...ontologyFiles].filter(Boolean),
      projectRoot,
    );
    sections.push("", "Invariant digest:");
    if (digest.length > 0) {
      sections.push(...digest);
    } else {
      sections.push("- (none detected; use source pointers for exact project context)");
    }
    sections.push(
      "",
      "Retrieval rule: read the exact source file before relying on an invariant, relationship, entity, path, or operational rule.",
    );
    return sections.join("\n");
  }
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

function buildHandoffSection(projectRoot, budget, mode = sessionContextMode()) {
  const handoffDir = join(projectRoot, ".anamnesis", "handoff");
  if (!dirExists(handoffDir)) return null;

  const active = join(handoffDir, "active.md");
  const archives = selectedHandoffArchives(projectRoot, active, handoffDir);
  if (!fileExists(active) && archives.length === 0) return null;

  const sections = [
    [
      "=== anamnesis: handoff ===",
      "",
      "Previous-session handoff. Use active.md as the compact index; read active warm archive pointers for detail.",
      "Cold/deprecated archives are excluded from SessionStart.",
    ].join("\n"),
  ];
  if (mode !== "full") {
    sections.push("Mode: compact (set ANAMNESIS_SESSION_CONTEXT_MODE=full for full file injection)");
    sections.push("Source pointers:");
    if (fileExists(active)) sections.push(sourcePointer(projectRoot, active));
    for (const archive of archives) sections.push(sourcePointer(projectRoot, archive));
    const summary = activeHandoffSummary(active);
    if (summary.length > 0) {
      sections.push("", "Active task summary:", ...summary);
    }
    const retrieval =
      archives.length > 0
        ? "Retrieval rule: read active.md and the referenced warm archive before continuing non-trivial in-flight work."
        : "Retrieval rule: read active.md before continuing non-trivial in-flight work; no warm archive is startup-active.";
    sections.push("", retrieval, "--- end of handoff ---");
    return sections.join("\n");
  }
  pushFileSection(sections, projectRoot, `Source: ${relative(projectRoot, active).split(sep).join("/")}`, active, budget);
  for (const archive of archives) {
    const rel = relative(projectRoot, archive).split(sep).join("/");
    pushFileSection(sections, projectRoot, `--- active referenced archived handoff: ${rel} ---`, archive, budget);
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
