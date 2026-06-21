import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { readEvidenceSummary } from "../core/evidence.js";
import {
  contextDiagnostics,
  type ContextDiagnosticIssue,
} from "./context_diagnostics.js";

export const CONTEXT_RESUME_SCHEMA_VERSION = "anamnesis.context_resume.v1";
export const CONTEXT_RESUME_PATH = ".anamnesis/context/resume.md";

export interface ContextResumeTouchedFile {
  status: string;
  path: string;
}

export interface ContextResumeResult {
  schema_version: typeof CONTEXT_RESUME_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  outputPath: string;
  bundle: string;
  activeHandoff?: string;
  latestArchive?: string;
  activeTasks: string[];
  touchedFiles: ContextResumeTouchedFile[];
  latestEvidence?: {
    kind: string;
    generated_at: string;
    summary: string;
  };
  diagnostics: {
    warnings: number;
    info: number;
    issues: ContextDiagnosticIssue[];
  };
  summary: {
    lines: number;
    chars: number;
    estimatedTokens: number;
    activeTasks: number;
    touchedFiles: number;
    diagnosticsWarnings: number;
    evidenceRecords: number;
  };
  writtenPath?: string;
}

export interface ContextResumeOptions {
  projectRoot: string;
  write?: boolean;
  outputPath?: string;
  now?: () => Date;
  maxTasks?: number;
  maxTouchedFiles?: number;
  maxDiagnostics?: number;
}

export function contextResume(opts: ContextResumeOptions): ContextResumeResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const outputPath = opts.outputPath ?? CONTEXT_RESUME_PATH;
  const maxTasks = opts.maxTasks ?? 4;
  const maxTouchedFiles = opts.maxTouchedFiles ?? 8;
  const maxDiagnostics = opts.maxDiagnostics ?? 5;

  const activeHandoff = activeHandoffPath(projectRoot);
  const activeTasks = readActiveTasks(projectRoot, activeHandoff).slice(
    0,
    maxTasks,
  );
  const latestArchive = newestHandoffArchive(projectRoot)?.rel;
  const touchedFiles = gitTouchedFiles(projectRoot).slice(0, maxTouchedFiles);
  const evidence = readEvidenceSummary(projectRoot, {
    now: new Date(generatedAt),
  });
  const latestEvidence = evidence.latest
    ? {
        kind: evidence.latest.kind,
        generated_at: evidence.latest.generated_at,
        summary: summarizeEvidence(evidence.latest.summary),
      }
    : undefined;
  const diagnosticsResult = contextDiagnostics({
    projectRoot,
    now: () => new Date(generatedAt),
  });
  const diagnosticIssues = diagnosticsResult.issues.slice(0, maxDiagnostics);

  const bundle = renderResumeBundle({
    generatedAt,
    activeHandoff,
    latestArchive,
    activeTasks,
    touchedFiles,
    latestEvidence,
    evidenceRecords: evidence.total,
    diagnosticIssues,
    diagnosticsWarnings: diagnosticsResult.summary.warnings,
    diagnosticsInfo: diagnosticsResult.summary.info,
  });
  const summary = summarizeBundle({
    bundle,
    activeTasks,
    touchedFiles,
    diagnosticsWarnings: diagnosticsResult.summary.warnings,
    evidenceRecords: evidence.total,
  });

  let writtenPath: string | undefined;
  if (opts.write === true) {
    const absOutput = path.resolve(projectRoot, outputPath);
    fs.mkdirSync(path.dirname(absOutput), { recursive: true });
    fs.writeFileSync(absOutput, `${bundle}\n`, "utf8");
    writtenPath = displayPathFromProject(projectRoot, absOutput);
  }

  return {
    schema_version: CONTEXT_RESUME_SCHEMA_VERSION,
    projectRoot: ".",
    generatedAt,
    outputPath,
    bundle,
    activeHandoff,
    latestArchive,
    activeTasks,
    touchedFiles,
    latestEvidence,
    diagnostics: {
      warnings: diagnosticsResult.summary.warnings,
      info: diagnosticsResult.summary.info,
      issues: diagnosticIssues,
    },
    summary,
    writtenPath,
  };
}

function renderResumeBundle(input: {
  generatedAt: string;
  activeHandoff?: string;
  latestArchive?: string;
  activeTasks: string[];
  touchedFiles: ContextResumeTouchedFile[];
  latestEvidence?: { kind: string; generated_at: string; summary: string };
  evidenceRecords: number;
  diagnosticIssues: ContextDiagnosticIssue[];
  diagnosticsWarnings: number;
  diagnosticsInfo: number;
}): string {
  const lines = [
    "# anamnesis resume bundle",
    `generated: ${input.generatedAt}`,
    "",
    "## pointers",
    `active_handoff: ${input.activeHandoff ?? "(none)"}`,
    `latest_archive: ${input.latestArchive ?? "(none)"}`,
    "",
    "## active_tasks",
    ...listOrNone(input.activeTasks),
    "",
    "## touched_files",
    ...listOrNone(
      input.touchedFiles.map((file) => `${file.status} ${file.path}`),
    ),
    "",
    "## latest_evidence",
    input.latestEvidence
      ? `- ${input.latestEvidence.kind} at ${input.latestEvidence.generated_at}: ${input.latestEvidence.summary}`
      : "- (none)",
    `- records: ${input.evidenceRecords}`,
    "",
    "## diagnostics",
    `- warnings: ${input.diagnosticsWarnings}, info: ${input.diagnosticsInfo}`,
    ...listOrNone(
      input.diagnosticIssues.map(
        (issue) =>
          `${issue.severity} ${issue.code} ${issue.source_path} ${issue.stable_ref}`,
      ),
    ),
    "",
    "## retrieval_rule",
    "- Read the exact active_handoff/latest_archive source before relying on task details.",
    "- Use `anamnesis context query` for deeper source pointers instead of expanding startup context.",
  ];
  return lines.join("\n");
}

function listOrNone(items: readonly string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- (none)"];
}

function summarizeBundle(input: {
  bundle: string;
  activeTasks: readonly string[];
  touchedFiles: readonly ContextResumeTouchedFile[];
  diagnosticsWarnings: number;
  evidenceRecords: number;
}): ContextResumeResult["summary"] {
  const lines = input.bundle.split(/\r?\n/).length;
  const chars = input.bundle.length;
  return {
    lines,
    chars,
    estimatedTokens: Math.ceil(chars / 4),
    activeTasks: input.activeTasks.length,
    touchedFiles: input.touchedFiles.length,
    diagnosticsWarnings: input.diagnosticsWarnings,
    evidenceRecords: input.evidenceRecords,
  };
}

function activeHandoffPath(projectRoot: string): string | undefined {
  const rel = ".anamnesis/handoff/active.md";
  return fs.existsSync(path.join(projectRoot, rel)) ? rel : undefined;
}

function readActiveTasks(
  projectRoot: string,
  activeHandoff: string | undefined,
): string[] {
  if (!activeHandoff) return [];
  const content = fs.readFileSync(path.join(projectRoot, activeHandoff), "utf8");
  return extractActiveTasks(content);
}

function extractActiveTasks(content: string): string[] {
  const tasks: string[] = [];
  let inOpenSection = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^##\s+(Current focus|Active tasks)\s*$/.test(line)) {
      inOpenSection = true;
      continue;
    }
    if (/^##\s+/.test(line)) {
      inOpenSection = false;
      continue;
    }
    if (!inOpenSection || !line.trim().startsWith("- ")) continue;
    tasks.push(cleanTaskLine(line));
  }
  return tasks;
}

function cleanTaskLine(line: string): string {
  return cleanText(line.replace(/^\s*-\s*/, ""), 180);
}

function newestHandoffArchive(
  projectRoot: string,
): { rel: string; mtimeMs: number } | undefined {
  const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
  if (!fs.existsSync(handoffDir)) return undefined;
  return fs
    .readdirSync(handoffDir)
    .filter((name) => name.endsWith(".md") && name !== "active.md")
    .map((name) => {
      const rel = path.join(".anamnesis", "handoff", name);
      const abs = path.join(projectRoot, rel);
      return {
        rel: rel.split(path.sep).join("/"),
        mtimeMs: fs.statSync(abs).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel))[0];
}

function gitTouchedFiles(projectRoot: string): ContextResumeTouchedFile[] {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const status = line.slice(0, 2).trim() || "??";
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes(" -> ")
        ? rawPath.split(" -> ").at(-1)!
        : rawPath;
      return { status, path: filePath };
    })
    .filter((file) => !shouldHideTouchedPath(file.path));
}

function shouldHideTouchedPath(relPath: string): boolean {
  const parts = relPath.split("/");
  const name = parts.at(-1) ?? relPath;
  return (
    parts.includes(".git") ||
    parts.includes("node_modules") ||
    name === ".env" ||
    name.startsWith(".env.") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".tfstate") ||
    name.endsWith(".tfstate.backup")
  );
}

function summarizeEvidence(summary: Record<string, unknown>): string {
  const parts = Object.entries(summary)
    .filter(([, value]) => isScalar(value))
    .map(([key, value]) => `${key}=${String(value)}`)
    .slice(0, 4);
  return parts.length > 0 ? parts.join(", ") : "(no scalar summary)";
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function cleanText(value: string, maxChars: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 3)}...`;
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}
