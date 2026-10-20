import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readEvidenceSummary } from "../core/evidence.js";
import {
  analyzeHandoffLifecycle,
  type HandoffLifecycleReport,
} from "../core/handoff_lifecycle.js";
import {
  handoffPolicyToLifecycleThresholds,
  resolveHandoffRetentionPolicy,
} from "../core/handoff_policy.js";
import {
  contextDiagnostics,
  type ContextDiagnosticIssue,
} from "./context_diagnostics.js";
import {
  sessionContextBudget,
  type SessionContextBudgetSource,
} from "./session_context_budget.js";
import { type WorkSubagentContext, workSubagentContext } from "./work.js";

export const CONTEXT_RESUME_SCHEMA_VERSION = "anamnesis.context_resume.v1";
export const CONTEXT_RESUME_PATH = ".anamnesis/context/resume.md";
export const CONTEXT_SUBAGENT_PREAMBLE_SCHEMA_VERSION =
  "anamnesis.context_subagent_preamble.v1";
export const CONTEXT_SUBAGENT_PREAMBLE_PATH =
  ".anamnesis/context/subagent-preamble.md";

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

export interface ContextSubagentPreambleResult {
  schema_version: typeof CONTEXT_SUBAGENT_PREAMBLE_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  outputPath: string;
  preamble: string;
  startupSources: SessionContextBudgetSource[];
  agentControlSources: string[];
  /** Present with `--work`: the Work slice for this worker. */
  work?: WorkSubagentContext;
  /** AGENTS.md region holding team rules, when the team fragment is installed. */
  teamRulesSource: string | null;
  /** User-global instruction files that exist (paths only, never content). */
  globalInstructionSources: string[];
  resume: ContextResumeResult;
  summary: {
    lines: number;
    chars: number;
    estimatedTokens: number;
    startupSourcePointers: number;
    agentControlSources: number;
    resumeTokens: number;
    workConstraints: number;
  };
  writtenPath?: string;
}

export interface ContextSubagentPreambleOptions {
  projectRoot: string;
  write?: boolean;
  outputPath?: string;
  now?: () => Date;
  /** Add the Work contract slice: constraints and, with laneId, the lane. */
  workId?: string;
  laneId?: string;
  stateRoot?: string;
}

export function contextResume(opts: ContextResumeOptions): ContextResumeResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const outputPath = opts.outputPath ?? CONTEXT_RESUME_PATH;
  const maxTasks = opts.maxTasks ?? 4;
  const maxTouchedFiles = opts.maxTouchedFiles ?? 8;
  const maxDiagnostics = opts.maxDiagnostics ?? 5;
  const handoffPolicy = resolveHandoffRetentionPolicy({ projectRoot });
  const handoffLifecycle = analyzeHandoffLifecycle({
    projectRoot,
    now: new Date(generatedAt),
    thresholds: handoffPolicyToLifecycleThresholds(handoffPolicy),
  });

  const activeHandoff = activeHandoffPath(projectRoot);
  const activeTasks = readActiveTasks(projectRoot, activeHandoff).slice(
    0,
    maxTasks,
  );
  const latestArchive = latestWarmHandoffArchive(handoffLifecycle);
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
    handoffRetentionPolicy: handoffPolicy,
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

export function contextSubagentPreamble(
  opts: ContextSubagentPreambleOptions,
): ContextSubagentPreambleResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const stableNow = () => new Date(generatedAt);
  const outputPath = opts.outputPath ?? CONTEXT_SUBAGENT_PREAMBLE_PATH;
  const resume = contextResume({
    projectRoot,
    now: stableNow,
  });
  const budget = sessionContextBudget({
    projectRoot,
    now: stableNow,
  });
  const agentControlSources = agentControlSourcePaths(projectRoot);
  if (opts.laneId !== undefined && opts.workId === undefined)
    throw new Error("--lane requires --work");
  const work =
    opts.workId === undefined
      ? undefined
      : workSubagentContext({
          project_root: projectRoot,
          state_root: opts.stateRoot,
          work_id: opts.workId,
          lane_id: opts.laneId,
        });
  const teamRulesSource = teamRulesRegion(projectRoot);
  const globalInstructionSources = globalInstructionPaths();
  const preamble = renderSubagentPreamble({
    generatedAt,
    agentControlSources,
    startupSources: budget.sources,
    resume,
    work,
    teamRulesSource,
    globalInstructionSources,
  });
  const summary = summarizePreamble({
    preamble,
    startupSources: budget.sources,
    agentControlSources,
    resume,
    workConstraints: work?.constraints.length ?? 0,
  });

  let writtenPath: string | undefined;
  if (opts.write === true) {
    const absOutput = path.resolve(projectRoot, outputPath);
    fs.mkdirSync(path.dirname(absOutput), { recursive: true });
    fs.writeFileSync(absOutput, `${preamble}\n`, "utf8");
    writtenPath = displayPathFromProject(projectRoot, absOutput);
  }

  return {
    schema_version: CONTEXT_SUBAGENT_PREAMBLE_SCHEMA_VERSION,
    projectRoot: ".",
    generatedAt,
    outputPath,
    preamble,
    startupSources: budget.sources,
    agentControlSources,
    ...(work ? { work } : {}),
    teamRulesSource,
    globalInstructionSources,
    resume,
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
    "- When work depends on project facts, ontology, prior decisions, roadmap items, or document evidence, run `anamnesis context query \"<terms>\"` and read the returned `source_path` / `stable_ref` before claiming or editing.",
    "- Treat query snippets as source pointers, not authority, and avoid expanding startup context with broad results.",
  ];
  return lines.join("\n");
}

function renderSubagentPreamble(input: {
  generatedAt: string;
  agentControlSources: string[];
  startupSources: SessionContextBudgetSource[];
  resume: ContextResumeResult;
  work?: WorkSubagentContext;
  teamRulesSource: string | null;
  globalInstructionSources: string[];
}): string {
  const lines = [
    "# anamnesis subagent preamble",
    `generated: ${input.generatedAt}`,
    "lane: separate-process-startup",
    "enforcement: launcher-wrapper",
    "",
    "## purpose",
    "- This preamble is intended to be prepended by a launcher or worker wrapper before the subagent task prompt.",
    "- It makes external subagent hydration enforceable by controlling process startup input.",
    "- Same-session native subagents still need prompt-contract evidence; do not claim SessionStart injection for them from this preamble alone.",
    "",
    "## required_agent_control_sources",
    ...listOrNone(input.agentControlSources),
    "",
    "## team_rules",
    input.teamRulesSource
      ? `- ${input.teamRulesSource} (read before acting; it is the project's team rule set)`
      : "- (none; no team rules region in AGENTS.md)",
    "",
    "## global_instruction_sources",
    ...(input.globalInstructionSources.length > 0
      ? [
          ...input.globalInstructionSources.map(
            (item) => `- ${item} (exists; the user's own rules also apply to you)`,
          ),
        ]
      : ["- (none found)"]),
    "",
    ...(input.work ? renderWorkSection(input.work) : []),
    "## startup_source_pointers",
    ...listOrNone(input.startupSources.map(sourcePointerLine)),
    "",
    "## resume_bundle",
    input.resume.bundle,
    "",
    "## required_subagent_response",
    "- Before context-sensitive work, read the exact source files needed from the pointers above.",
    "- If the needed source is not listed above, run `anamnesis context query \"<terms>\"` and read the returned `source_path` / `stable_ref`.",
    "- Report `anamnesis_context_sources` with the exact paths and stable refs read.",
    "- If no listed source is relevant, explicitly say why before proceeding.",
  ];
  return lines.join("\n");
}

function renderWorkSection(work: WorkSubagentContext): string[] {
  const lines = [
    "## work_contract",
    `- work_id: ${work.work_id}`,
    `- contract_revision: ${work.contract_revision} (${work.contract_hash ?? "no hash"})`,
    `- lifecycle: ${work.lifecycle}`,
    `- title: ${cleanText(work.title ?? "(none)", 300)}`,
    `- completion_contract: ${cleanText(work.completion_contract ?? "(none)", 700)}`,
    `- authoritative status: anamnesis work status --work ${work.work_id} --json`,
    "",
    "## work_constraints",
    work.constraints.length > 0
      ? `- ${work.constraints.length} active, hash ${work.constraints_hash}. Every rule applies to you; none is a progress item.`
      : "- (none recorded)",
    ...work.constraints.map(
      (item) =>
        `- ${item.id} [${item.kind}] ${cleanText(item.text, 600)}${item.expires ? ` (expires: ${cleanText(item.expires, 120)})` : ""} (source: ${item.source_event_ids.join(", ")})`,
    ),
  ];
  if (work.lane) {
    const lane = work.lane;
    lines.push(
      "",
      "## lane",
      `- lane_id: ${lane.lane_id} (assessment ${lane.assessment_id}, decision ${lane.decision})`,
      ...(lane.assessment_stale
        ? [
            `- WARNING: assessed at contract revision ${lane.assessment_revision}, current is ${work.contract_revision}. Ask the leader to reassess before you rely on this scope.`,
          ]
        : []),
      "- requirements:",
      ...lane.requirements.map(
        (item) => `  - ${item.id} [${item.status}] ${cleanText(item.summary, 300)}`,
      ),
      "- repository_scopes (write only inside write scopes):",
      ...lane.repository_scopes.map(
        (scope) => `  - ${scope.access} ${scope.kind}${scope.path ? ` ${scope.path}` : ""}`,
      ),
      "- external_effects:",
      ...(lane.external_effects.length > 0
        ? lane.external_effects.map(
            (effect) =>
              `  - ${effect.access} ${effect.resource_kind} ${effect.resource_ref}${effect.irreversible ? " (irreversible)" : ""}`,
          )
        : ["  - (none allowed)"]),
      `- depends_on: ${lane.depends_on.join(", ") || "(none)"}`,
      `- other lanes (do not change their scope): ${lane.other_lane_ids.join(", ") || "(none)"}`,
      "- verification owner: leader. Report evidence; do not mark requirements verified.",
    );
  }
  lines.push("");
  return lines;
}

function teamRulesRegion(projectRoot: string): string | null {
  const agents = path.join(projectRoot, "AGENTS.md");
  try {
    const content = fs.readFileSync(agents, "utf8");
    const match = /<!-- anamnesis:region id=(team[A-Za-z0-9_-]*) /u.exec(content);
    return match ? `AGENTS.md#${match[1]}` : null;
  } catch {
    return null;
  }
}

function globalInstructionPaths(): string[] {
  const home = os.homedir();
  return [
    [".claude", "CLAUDE.md"],
    [".codex", "AGENTS.md"],
  ]
    .filter((parts) => fs.existsSync(path.join(home, ...parts)))
    .map((parts) => `~/${parts.join("/")}`);
}

function listOrNone(items: readonly string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- (none)"];
}

function summarizePreamble(input: {
  preamble: string;
  startupSources: readonly SessionContextBudgetSource[];
  agentControlSources: readonly string[];
  resume: ContextResumeResult;
  workConstraints: number;
}): ContextSubagentPreambleResult["summary"] {
  const lines = input.preamble.split(/\r?\n/).length;
  const chars = input.preamble.length;
  return {
    lines,
    chars,
    estimatedTokens: Math.ceil(chars / 4),
    startupSourcePointers: input.startupSources.length,
    agentControlSources: input.agentControlSources.length,
    resumeTokens: input.resume.summary.estimatedTokens,
    workConstraints: input.workConstraints,
  };
}

function sourcePointerLine(source: SessionContextBudgetSource): string {
  return `${source.path} (${source.kind}; ${source.bytes} bytes, ${source.lines} lines)`;
}

function agentControlSourcePaths(projectRoot: string): string[] {
  return ["AGENTS.md", "CLAUDE.md", ".codex/skills"].filter((rel) =>
    fs.existsSync(path.join(projectRoot, rel)),
  );
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

function latestWarmHandoffArchive(
  lifecycle: HandoffLifecycleReport,
): string | undefined {
  return lifecycle.entries
    .filter((entry) => entry.kind === "archive" && entry.tier === "warm")
    .sort(
      (a, b) =>
        Date.parse(b.mtime) - Date.parse(a.mtime) || a.path.localeCompare(b.path),
    )[0]?.path;
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
