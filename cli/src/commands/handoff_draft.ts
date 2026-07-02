import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { readEvidenceSummary } from "../core/evidence.js";

export const HANDOFF_DRAFT_SCHEMA_VERSION = "anamnesis.handoff_draft.v1";
export const HANDOFF_DRAFT_PATH = ".anamnesis/handoff/drafts/latest.md";

export interface HandoffDraftTouchedFile {
  status: string;
  path: string;
}

export interface HandoffDraftResult {
  schema_version: typeof HANDOFF_DRAFT_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  outputPath: string;
  draft: string;
  gitRef: string;
  recentCommits: string[];
  activeHandoff?: string;
  latestArchive?: string;
  touchedFiles: HandoffDraftTouchedFile[];
  latestEvidence?: {
    kind: string;
    generated_at: string;
    summary: string;
  };
  summary: {
    lines: number;
    chars: number;
    estimatedTokens: number;
    recentCommits: number;
    touchedFiles: number;
    evidenceRecords: number;
  };
  writtenPath?: string;
}

export interface HandoffDraftOptions {
  projectRoot: string;
  write?: boolean;
  outputPath?: string;
  now?: () => Date;
  maxCommits?: number;
  maxTouchedFiles?: number;
  runner?: HandoffDraftRunner;
}

export type HandoffDraftRunner = (
  command: string,
  args: string[],
  cwd: string,
) => { status: number | null; stdout: string };

export function handoffDraft(opts: HandoffDraftOptions): HandoffDraftResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const outputPath = opts.outputPath ?? HANDOFF_DRAFT_PATH;
  const runner = opts.runner ?? runCommand;
  const maxCommits = opts.maxCommits ?? 5;
  const maxTouchedFiles = opts.maxTouchedFiles ?? 40;

  const gitRef = gitOutput(projectRoot, runner, ["rev-parse", "HEAD"]) ?? "unknown";
  const recentCommits = (
    gitOutput(projectRoot, runner, ["log", "--oneline", `-${maxCommits}`]) ?? ""
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const touchedFiles = gitTouchedFiles(projectRoot, runner).slice(
    0,
    maxTouchedFiles,
  );
  const activeHandoff = activeHandoffPath(projectRoot);
  const latestArchive = newestHandoffArchive(projectRoot)?.rel;
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

  const draft = renderHandoffDraft({
    generatedAt,
    gitRef,
    recentCommits,
    touchedFiles,
    activeHandoff,
    latestArchive,
    latestEvidence,
    evidenceRecords: evidence.total,
  });
  const summary = summarizeDraft({
    draft,
    recentCommits,
    touchedFiles,
    evidenceRecords: evidence.total,
  });

  let writtenPath: string | undefined;
  if (opts.write === true) {
    const absOutput = path.resolve(projectRoot, outputPath);
    fs.mkdirSync(path.dirname(absOutput), { recursive: true });
    fs.writeFileSync(absOutput, `${draft}\n`, "utf8");
    writtenPath = displayPathFromProject(projectRoot, absOutput);
  }

  return {
    schema_version: HANDOFF_DRAFT_SCHEMA_VERSION,
    projectRoot: ".",
    generatedAt,
    outputPath,
    draft,
    gitRef,
    recentCommits,
    activeHandoff,
    latestArchive,
    touchedFiles,
    latestEvidence,
    summary,
    writtenPath,
  };
}

function renderHandoffDraft(input: {
  generatedAt: string;
  gitRef: string;
  recentCommits: string[];
  touchedFiles: HandoffDraftTouchedFile[];
  activeHandoff?: string;
  latestArchive?: string;
  latestEvidence?: { kind: string; generated_at: string; summary: string };
  evidenceRecords: number;
}): string {
  const lines = [
    "---",
    `created: ${input.generatedAt}`,
    "agent: unknown",
    `git_ref: ${input.gitRef}`,
    "draft: true",
    "---",
    "",
    "# Handoff Draft - confirm before finalizing",
    "",
    "> Draft only. Do not treat this as a finalized handoff until an agent confirms goal, decisions, blockers, rejected options, and next steps.",
    "",
    "## Snapshot",
    `- active_handoff: ${input.activeHandoff ?? "(none)"}`,
    `- latest_archive: ${input.latestArchive ?? "(none)"}`,
    input.latestEvidence
      ? `- latest_evidence: ${input.latestEvidence.kind} at ${input.latestEvidence.generated_at}: ${input.latestEvidence.summary}`
      : "- latest_evidence: (none)",
    `- evidence_records: ${input.evidenceRecords}`,
    "",
    "## Recent commits",
    ...listOrNone(input.recentCommits),
    "",
    "## Touched files",
    ...listOrNone(
      input.touchedFiles.map((file) => `${file.status} ${file.path}`),
    ),
    "",
    "## Goal",
    "- TODO(agent): summarize the user objective in 2-3 sentences.",
    "",
    "## Done so far",
    "- TODO(agent): confirm completed work with file paths and commit shas where relevant.",
    "",
    "## In flight",
    "- TODO(agent): list unfinished changes and why they exist.",
    "",
    "## Decisions",
    "- TODO(agent): record decisions, constraints, and rejected alternatives.",
    "",
    "## Open questions / blockers",
    "- TODO(agent): list any unresolved user, tool, credential, or external blockers.",
    "",
    "## Next steps",
    "1. TODO(agent): write the next concrete action.",
    "",
    "## Finalization rule",
    "- After semantic confirmation, write a timestamped archive and update `.anamnesis/handoff/active.md` via `/handoff-prepare` or an equivalent agent-authored finalization path.",
  ];
  return lines.join("\n");
}

function listOrNone(items: readonly string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- (none)"];
}

function summarizeDraft(input: {
  draft: string;
  recentCommits: readonly string[];
  touchedFiles: readonly HandoffDraftTouchedFile[];
  evidenceRecords: number;
}): HandoffDraftResult["summary"] {
  const lines = input.draft.split(/\r?\n/).length;
  const chars = input.draft.length;
  return {
    lines,
    chars,
    estimatedTokens: Math.ceil(chars / 4),
    recentCommits: input.recentCommits.length,
    touchedFiles: input.touchedFiles.length,
    evidenceRecords: input.evidenceRecords,
  };
}

function activeHandoffPath(projectRoot: string): string | undefined {
  const rel = ".anamnesis/handoff/active.md";
  return fs.existsSync(path.join(projectRoot, rel)) ? rel : undefined;
}

function newestHandoffArchive(
  projectRoot: string,
): { rel: string; mtimeMs: number } | undefined {
  const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
  if (!fs.existsSync(handoffDir)) return undefined;
  return fs
    .readdirSync(handoffDir)
    .filter((name) => name.endsWith(".md") && name !== "active.md" && name !== "draft.md")
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

function gitTouchedFiles(
  projectRoot: string,
  runner: HandoffDraftRunner,
): HandoffDraftTouchedFile[] {
  const result = runner(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    projectRoot,
  );
  if (result.status !== 0) return [];
  const stdout = result.stdout.trimEnd();
  if (!stdout) return [];
  return stdout
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

function gitOutput(
  projectRoot: string,
  runner: HandoffDraftRunner,
  args: string[],
): string | undefined {
  const result = runner("git", args, projectRoot);
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): { status: number | null; stdout: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
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

function displayPathFromProject(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}
