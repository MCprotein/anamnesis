import * as fs from "node:fs";
import * as path from "node:path";
import {
  activeHandoffOpenTaskLines,
} from "../core/handoff_active_text.js";
import {
  analyzeHandoffLifecycle,
  type HandoffLifecycleEntry,
} from "../core/handoff_lifecycle.js";
import {
  handoffPolicyToLifecycleThresholds,
  resolveHandoffRetentionPolicy,
} from "../core/handoff_policy.js";

export const SESSION_CONTEXT_BUDGET_SCHEMA_VERSION =
  "anamnesis.session_context_budget.v1";

export const DEFAULT_SESSION_CONTEXT_MAX_TOKENS = 800;

export type SessionContextBudgetMode = "compact";

export type SessionContextBudgetSourceKind =
  | "system-graph"
  | "ontology"
  | "handoff-active"
  | "handoff-archive";

export interface SessionContextBudgetSource {
  path: string;
  kind: SessionContextBudgetSourceKind;
  bytes: number;
  lines: number;
}

export interface SessionContextBudgetRequiredRule {
  id: "source-pointers" | "retrieval-rule";
  present: boolean;
  detail: string;
}

export interface SessionContextBudgetResult {
  schema_version: typeof SESSION_CONTEXT_BUDGET_SCHEMA_VERSION;
  mode: SessionContextBudgetMode;
  maxTokens: number;
  startupChars: number;
  startupLines: number;
  estimatedTokens: number;
  sourcePointers: number;
  sourceBytes: number;
  invariantDigestLines: number;
  activeTaskLines: number;
  requiredRulesPresent: number;
  requiredRulesTotal: number;
  capExceeded: boolean;
  sources: SessionContextBudgetSource[];
  requiredRules: SessionContextBudgetRequiredRule[];
  warnings: string[];
}

export interface SessionContextBudgetOptions {
  projectRoot: string;
  maxTokens?: number;
  now?: () => Date;
}

interface SourceWithText extends SessionContextBudgetSource {
  text: string;
}

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

export function sessionContextBudget(
  opts: SessionContextBudgetOptions,
): SessionContextBudgetResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const maxTokens = opts.maxTokens ?? DEFAULT_SESSION_CONTEXT_MAX_TOKENS;
  const sources = collectSessionContextSources({
    projectRoot,
    now: (opts.now ?? (() => new Date()))(),
  });
  const rendered = renderCompactSessionContext(sources);
  const estimatedTokens = estimateTokens(rendered.text);
  const requiredRules = requiredRulesForPayload(sources, rendered.text);
  const capExceeded = estimatedTokens > maxTokens;
  const warnings = capExceeded
    ? [
        `compact SessionStart context is ${estimatedTokens} estimated token(s), exceeding budget ${maxTokens}`,
      ]
    : [];

  return {
    schema_version: SESSION_CONTEXT_BUDGET_SCHEMA_VERSION,
    mode: "compact",
    maxTokens,
    startupChars: rendered.text.length,
    startupLines: lineCount(rendered.text),
    estimatedTokens,
    sourcePointers: rendered.sourcePointers,
    sourceBytes: sources.reduce((sum, source) => sum + source.bytes, 0),
    invariantDigestLines: rendered.invariantDigestLines,
    activeTaskLines: rendered.activeTaskLines,
    requiredRulesPresent: requiredRules.filter((rule) => rule.present).length,
    requiredRulesTotal: requiredRules.length,
    capExceeded,
    sources: sources.map(({ text: _text, ...source }) => source),
    requiredRules,
    warnings,
  };
}

function collectSessionContextSources(input: {
  projectRoot: string;
  now: Date;
}): SourceWithText[] {
  const sources: SourceWithText[] = [];
  const systemGraph = path.join(input.projectRoot, "system_graph.yaml");
  if (fs.existsSync(systemGraph)) {
    sources.push(readSource(input.projectRoot, systemGraph, "system-graph"));
  }

  for (const ontologyPath of ontologySourcePaths(input.projectRoot)) {
    sources.push(readSource(input.projectRoot, ontologyPath, "ontology"));
  }

  sources.push(...handoffSources(input.projectRoot, input.now));
  return sources.sort(compareSources);
}

function ontologySourcePaths(projectRoot: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
      const rel = displayPathFromProject(projectRoot, abs);
      if (rel.includes(".anamnesis/ontology/")) {
        out.push(abs);
      }
    }
  };
  visit(projectRoot);
  return out.sort();
}

function handoffSources(projectRoot: string, now: Date): SourceWithText[] {
  const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
  if (!fs.existsSync(handoffDir)) return [];

  const lifecycle = analyzeHandoffLifecycle({
    projectRoot,
    now,
    thresholds: handoffPolicyToLifecycleThresholds(
      resolveHandoffRetentionPolicy({ projectRoot }),
    ),
  });
  const hasActive = lifecycle.entries.some((entry) => entry.kind === "active-index");
  return lifecycle.entries
    .filter((entry) => startupContextEntry(entry, hasActive))
    .map((entry) =>
      readSource(
        projectRoot,
        path.join(projectRoot, entry.path.split("/").join(path.sep)),
        entry.kind === "active-index" ? "handoff-active" : "handoff-archive",
      ),
    );
}

function startupContextEntry(
  entry: HandoffLifecycleEntry,
  hasActive: boolean,
): boolean {
  if (entry.kind === "active-index") return true;
  if (!startupEligibleArchive(entry)) return false;
  return hasActive ? entry.activeReferenced : entry.tier === "warm";
}

function startupEligibleArchive(entry: HandoffLifecycleEntry): boolean {
  if (entry.supersededBy) return false;
  if (
    entry.handoffStatus === "closed" ||
    entry.handoffStatus === "deprecated" ||
    entry.handoffStatus === "superseded"
  ) {
    return false;
  }
  if (entry.retentionTier === "cold" || entry.retentionTier === "deprecated") {
    return false;
  }
  return entry.tier !== "cold" && entry.tier !== "deprecated";
}

function readSource(
  projectRoot: string,
  absPath: string,
  kind: SessionContextBudgetSourceKind,
): SourceWithText {
  const text = fs.readFileSync(absPath, "utf8");
  return {
    path: displayPathFromProject(projectRoot, absPath),
    kind,
    bytes: Buffer.byteLength(text, "utf8"),
    lines: lineCount(text),
    text,
  };
}

function renderCompactSessionContext(sources: readonly SourceWithText[]): {
  text: string;
  sourcePointers: number;
  invariantDigestLines: number;
  activeTaskLines: number;
} {
  const sections: string[] = [];
  let sourcePointers = 0;
  let invariantDigestLines = 0;
  let activeTaskLines = 0;

  const ontologySources = sources.filter(
    (source) => source.kind === "system-graph" || source.kind === "ontology",
  );
  if (ontologySources.length > 0) {
    sections.push(
      [
        "=== anamnesis: ontology context ===",
        "",
        "Mode: compact",
        "Source pointers:",
        ...ontologySources.map((source) => {
          sourcePointers++;
          return sourcePointer(source);
        }),
        "",
        "Invariant digest:",
      ].join("\n"),
    );
    const digest = invariantDigest(ontologySources);
    invariantDigestLines = digest.length;
    sections.push(digest.length > 0 ? digest.join("\n") : "- (none detected)");
    sections.push(
      "Retrieval rule: read the exact source file before relying on project context.",
    );
  }

  const handoffSources = sources.filter(
    (source) => source.kind === "handoff-active" || source.kind === "handoff-archive",
  );
  if (handoffSources.length > 0) {
    sections.push(
      [
        "=== anamnesis: handoff ===",
        "",
        "Mode: compact",
        "Source pointers:",
        ...handoffSources.map((source) => {
          sourcePointers++;
          return sourcePointer(source);
        }),
      ].join("\n"),
    );
    const active = handoffSources.find((source) => source.kind === "handoff-active");
    const activeLines = active ? activeHandoffOpenTaskLines(active.text).slice(0, 12) : [];
    activeTaskLines = activeLines.length;
    if (activeLines.length > 0) {
      sections.push(["Active task summary:", ...activeLines].join("\n"));
    }
    sections.push(
      "Retrieval rule: read active.md and referenced warm archives before continuing non-trivial in-flight work.",
    );
  }

  return {
    text: sections.join("\n\n"),
    sourcePointers,
    invariantDigestLines,
    activeTaskLines,
  };
}

function sourcePointer(source: SessionContextBudgetSource): string {
  return `- ${source.path} (${source.bytes} bytes, ${source.lines} lines)`;
}

function invariantDigest(sources: readonly SourceWithText[]): string[] {
  const pattern =
    /(must|never|always|invariant|rule|severity:\s*"?must|필수|금지|항상|절대)/i;
  const out: string[] = [];
  for (const source of sources) {
    for (const line of source.text.split(/\r?\n/)) {
      if (!pattern.test(line)) continue;
      out.push(`- ${source.path}: ${line.trimStart()}`);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

function requiredRulesForPayload(
  sources: readonly SourceWithText[],
  payload: string,
): SessionContextBudgetRequiredRule[] {
  if (sources.length === 0) return [];
  return [
    {
      id: "source-pointers",
      present: sources.every((source) => payload.includes(source.path)),
      detail: "compact startup context includes a source pointer for every startup-active source",
    },
    {
      id: "retrieval-rule",
      present: payload.includes("Retrieval rule:"),
      detail: "compact startup context tells the agent to retrieve source files before relying on context",
    },
  ];
}

function compareSources(
  a: SessionContextBudgetSource,
  b: SessionContextBudgetSource,
): number {
  const kind = sourceKindRank(a.kind) - sourceKindRank(b.kind);
  if (kind !== 0) return kind;
  return a.path.localeCompare(b.path);
}

function sourceKindRank(kind: SessionContextBudgetSourceKind): number {
  switch (kind) {
    case "system-graph":
      return 0;
    case "ontology":
      return 1;
    case "handoff-active":
      return 2;
    case "handoff-archive":
      return 3;
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}
