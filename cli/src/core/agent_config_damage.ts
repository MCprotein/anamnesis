import * as fs from "node:fs";
import * as path from "node:path";
import type { Manifest } from "./manifest.js";

export type AgentConfigDamageSeverity = "warning" | "info";

export type AgentConfigDamageIssueCode =
  | "startup-handoff-archive-inlined"
  | "docs-adapter-parity-overclaim"
  | "bootstrap-ontology-hand-edited"
  | "managed-region-marker-duplicated";

export interface AgentConfigDamageIssue {
  severity: AgentConfigDamageSeverity;
  code: AgentConfigDamageIssueCode;
  target: string;
  message: string;
  repair: string;
}

export interface AgentConfigDamageStatus {
  ok: boolean;
  issues: AgentConfigDamageIssue[];
  summary: {
    total: number;
    warnings: number;
    info: number;
  };
}

export function analyzeAgentConfigDamage(opts: {
  projectRoot: string;
  manifest?: Manifest;
}): AgentConfigDamageStatus {
  const projectRoot = path.resolve(opts.projectRoot);
  const issues = [
    ...startupHandoffArchiveIssues(projectRoot),
    ...adapterParityOverclaimIssues(projectRoot),
    ...bootstrapOntologyEditIssues(projectRoot),
    ...managedRegionMarkerIssues(projectRoot, opts.manifest),
  ].sort((a, b) => a.target.localeCompare(b.target) || a.code.localeCompare(b.code));

  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const info = issues.filter((issue) => issue.severity === "info").length;
  return {
    ok: warnings === 0,
    issues,
    summary: {
      total: issues.length,
      warnings,
      info,
    },
  };
}

function startupHandoffArchiveIssues(
  projectRoot: string,
): AgentConfigDamageIssue[] {
  const issues: AgentConfigDamageIssue[] = [];
  for (const relPath of startupContextPaths(projectRoot)) {
    const text = fs.readFileSync(path.join(projectRoot, relPath), "utf8");
    const masked = maskFencedCode(text);
    if (!looksLikeInlinedHandoffArchive(masked)) continue;
    issues.push({
      severity: "warning",
      code: "startup-handoff-archive-inlined",
      target: relPath,
      message: `${relPath} appears to inline a full handoff archive in startup context`,
      repair:
        "Keep startup context compact: replace full archive bodies with active-task summaries and source pointers to `.anamnesis/handoff/*.md`.",
    });
  }
  return issues;
}

function adapterParityOverclaimIssues(
  projectRoot: string,
): AgentConfigDamageIssue[] {
  const issues: AgentConfigDamageIssue[] = [];
  for (const relPath of documentationPaths(projectRoot)) {
    const lines = fs.readFileSync(path.join(projectRoot, relPath), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!isAdapterParityOverclaim(line)) return;
      issues.push({
        severity: "warning",
        code: "docs-adapter-parity-overclaim",
        target: `${relPath}:${index + 1}`,
        message: "documentation appears to overclaim identical adapter parity",
        repair:
          "Describe user-facing parity instead of identical native UI or identical behavior; note adapter-specific limitations when relevant.",
      });
    });
  }
  return issues;
}

function bootstrapOntologyEditIssues(
  projectRoot: string,
): AgentConfigDamageIssue[] {
  const issues: AgentConfigDamageIssue[] = [];
  for (const relPath of bootstrapOntologyPaths(projectRoot)) {
    const text = fs.readFileSync(path.join(projectRoot, relPath), "utf8");
    const preamble = text.split(/\r?\n/).slice(0, 8).join("\n");
    if (
      /AUTO-GENERATED/i.test(preamble) &&
      /anamnesis ontology bootstrap/i.test(preamble)
    ) {
      continue;
    }
    issues.push({
      severity: "warning",
      code: "bootstrap-ontology-hand-edited",
      target: relPath,
      message: `${relPath} lacks the generated bootstrap header and may have been hand-authored or copied`,
      repair:
        "Do not hand-edit `.bootstrap.yaml` files. Re-run `anamnesis ontology bootstrap` and put semantic notes in the matching `.enriched.yaml` file.",
    });
  }
  return issues;
}

function managedRegionMarkerIssues(
  projectRoot: string,
  manifest: Manifest | undefined,
): AgentConfigDamageIssue[] {
  if (!manifest) return [];

  const issues: AgentConfigDamageIssue[] = [];
  const seen = new Set<string>();
  for (const region of manifest.regions) {
    const key = `${region.file}\0${region.region_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const absPath = path.join(projectRoot, region.file);
    if (!fs.existsSync(absPath)) continue;
    const text = fs.readFileSync(absPath, "utf8");
    const count = countRegionOpenMarkers(text, region.region_id);
    if (count <= 1) continue;
    issues.push({
      severity: "warning",
      code: "managed-region-marker-duplicated",
      target: `${region.file} [region:${region.region_id}]`,
      message: `managed region '${region.region_id}' appears ${count} times in ${region.file}`,
      repair:
        "Keep exactly one managed region anchor per id. Move user prose outside managed anchors and remove copied generated regions before running update.",
    });
  }
  return issues;
}

function startupContextPaths(projectRoot: string): string[] {
  const paths = new Set<string>();
  for (const relPath of ["AGENTS.md", "CLAUDE.md"]) {
    if (fs.existsSync(path.join(projectRoot, relPath))) paths.add(relPath);
  }
  for (const relPath of walkFiles(projectRoot, ".cursor/rules")) {
    if (relPath.endsWith(".mdc") || relPath.endsWith(".md")) paths.add(relPath);
  }
  return [...paths].sort();
}

function documentationPaths(projectRoot: string): string[] {
  const paths = new Set<string>();
  for (const relPath of ["README.md", "AGENTS.md", "CLAUDE.md"]) {
    if (fs.existsSync(path.join(projectRoot, relPath))) paths.add(relPath);
  }
  for (const relPath of walkFiles(projectRoot, "docs")) {
    if (!relPath.endsWith(".md")) continue;
    if (relPath.startsWith("docs/deprecated/")) continue;
    if (relPath.startsWith("docs/benchmark-evidence/")) continue;
    paths.add(relPath);
  }
  return [...paths].sort();
}

function bootstrapOntologyPaths(projectRoot: string): string[] {
  return walkProjectFiles(projectRoot).filter((relPath) =>
    /(?:^|\/)\.anamnesis\/ontology\/.+\.bootstrap\.ya?ml$/.test(relPath),
  );
}

function looksLikeInlinedHandoffArchive(text: string): boolean {
  if (!/^#\s+Handoff\s+[—-]/m.test(text)) return false;
  const headings = [
    /^##\s+Goal\s*$/m,
    /^##\s+Done so far\s*$/m,
    /^##\s+In flight\s*$/m,
    /^##\s+Decisions\s*$/m,
    /^##\s+Open questions \/ blockers\s*$/m,
    /^##\s+Next steps\s*$/m,
  ].filter((pattern) => pattern.test(text)).length;
  return headings >= 4;
}

function isAdapterParityOverclaim(line: string): boolean {
  const text = line.trim();
  if (text === "" || text.startsWith("|")) return false;
  if (!/\b(adapter|adapters|Claude Code|Codex|Cursor)\b/i.test(text)) {
    return false;
  }
  if (
    /\b(do not|does not|not|no|without|rather than|more than|instead of)\b.{0,40}\b(identical|same|complete|perfect|full)\b/i.test(text) ||
    /\b(identical|same|complete|perfect|full)\b.{0,40}\b(is not|are not|isn't|aren't|does not|do not)\b/i.test(text)
  ) {
    return false;
  }
  return (
    /\bidentical\s+(native\s+)?(?:UI|behavior|semantics|surfaces?)\b/i.test(text) ||
    /\b(?:complete|perfect|full)\s+adapter\s+parity\b/i.test(text) ||
    /\bguarantees?\b.{0,80}\b(?:identical|same)\b.{0,80}\b(?:adapter|Claude Code|Codex|Cursor)\b/i.test(text)
  );
}

function countRegionOpenMarkers(text: string, id: string): number {
  const pattern = new RegExp(
    `<!--\\s*anamnesis:region\\s+id=${escapeRegExp(id)}\\s+fragment=[A-Za-z0-9_-]+@\\d+\\s*-->`,
    "g",
  );
  return Array.from(text.matchAll(pattern)).length;
}

function maskFencedCode(text: string): string {
  let inFence = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

function walkFiles(projectRoot: string, relDir: string): string[] {
  const absDir = path.join(projectRoot, relDir);
  if (!fs.existsSync(absDir)) return [];
  const result: string[] = [];
  const stack = [absDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        result.push(displayPathFromProject(projectRoot, absPath));
      }
    }
  }
  return result.sort();
}

function walkProjectFiles(projectRoot: string): string[] {
  const result: string[] = [];
  const stack = [projectRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipDirectory(entry.name)) continue;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        result.push(displayPathFromProject(projectRoot, absPath));
      }
    }
  }
  return result.sort();
}

function shouldSkipDirectory(name: string): boolean {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
  ].includes(name);
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
