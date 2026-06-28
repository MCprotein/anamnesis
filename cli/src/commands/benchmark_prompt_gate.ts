import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  readEvidenceFile,
  readEvidenceRecords,
  type RuntimeEvidenceLog,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import {
  SESSION_CONTEXT_BENCHMARK_SCHEMA_VERSION,
  type SessionContextBenchmarkResult,
} from "./benchmark_session_context.js";
import { status, StatusError, type StatusResult } from "./status.js";

export const PROMPT_DELTA_GATE_SCHEMA_VERSION =
  "anamnesis.prompt_delta_gate.v1";

export type PromptDeltaGateRecommendation =
  | "defer"
  | "collect-more-evidence"
  | "prototype";

export type PromptDeltaGateSignalStatus = "pass" | "warn" | "fail";
export type PromptDeltaGateRisk = "low" | "medium" | "high";

export interface PromptDeltaGateSignal {
  id: string;
  label: string;
  status: PromptDeltaGateSignalStatus;
  detail: string;
}

export interface PromptDeltaGateContextFile {
  path: string;
  kind: "ontology" | "handoff" | "system-graph";
  bytes: number;
  estimatedTokens: number;
}

export interface PromptDeltaGateContextBudget {
  files: PromptDeltaGateContextFile[];
  bytes: number;
  estimatedTokens: number;
  maxPromptDeltaTokens: number;
  duplicateContextRisk: PromptDeltaGateRisk;
}

export interface PromptDeltaGateEvidenceSummary {
  records: number;
  invalidRecords: number;
  benchmarkReports: number;
  benchmarkCompares: number;
  agentTaskBenchmarks: number;
  agentTaskBenchmarkCompares: number;
  retrievalBenchmarks: number;
  compactRetrievalBenchmarks: number;
  fullRetrievalBenchmarks: number;
  continuityGaps: number;
  continuityRegressions: number;
  taskFriction: number;
  taskFailures: number;
  retrievalFriction: number;
  retrievalFailures: number;
  retrievalComparisonRegressions: number;
  retrievalComparisonFailures: number;
  sessionContextBenchmarks: number;
  sessionContextCompactCapExceeded: number;
  sessionContextFullCapExceeded: number;
  sessionContextLargeReductionPct?: number;
  sessionContextCompactRequiredRulePasses?: number;
  sessionContextCompactRequiredRuleTotal?: number;
  sessionContextCompactSourcePointerFixtures?: number;
}

interface PromptDeltaGateSessionContextEvidence {
  path: string;
  summary: SessionContextBenchmarkResult["summary"];
}

export interface PromptDeltaGateDecision {
  recommendation: PromptDeltaGateRecommendation;
  shouldImplementPromptDelta: boolean;
  reason: string;
}

export interface PromptDeltaGateResult {
  projectRoot: string;
  generatedAt: string;
  evidencePath: string;
  status: StatusResult;
  evidence: PromptDeltaGateEvidenceSummary;
  contextBudget: PromptDeltaGateContextBudget;
  signals: PromptDeltaGateSignal[];
  decision: PromptDeltaGateDecision;
  requiredBeforeShip: string[];
  markdown: string;
  appendedPath?: string;
  evidenceRecordPath?: string;
}

export interface PromptDeltaGateOptions {
  projectRoot: string;
  libraryRoot: string;
  append?: boolean;
  outputPath?: string;
  sources?: readonly string[];
  maxPromptDeltaTokens?: number;
  now?: () => Date;
}

export class PromptDeltaGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptDeltaGateError";
  }
}

export function promptDeltaGate(
  opts: PromptDeltaGateOptions,
): PromptDeltaGateResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const maxPromptDeltaTokens = opts.maxPromptDeltaTokens ?? 800;

  let st: StatusResult;
  try {
    st = status({ projectRoot, libraryRoot });
  } catch (e) {
    if (e instanceof StatusError) {
      throw new PromptDeltaGateError(e.message);
    }
    throw e;
  }

  const log = readPromptGateEvidenceRecords(projectRoot, opts.sources ?? []);
  const sessionContextEvidence = readSessionContextBenchmarkEvidence(projectRoot);
  const evidence = summarizePromptGateEvidence(
    log.records,
    log.invalid,
    sessionContextEvidence,
  );
  const contextBudget = measurePromptContextBudget({
    projectRoot,
    maxPromptDeltaTokens,
    duplicateContextRisk: duplicateContextRisk(st, evidence),
  });
  const signals = promptDeltaSignals({ st, evidence, contextBudget });
  const decision = decidePromptDelta({ evidence, contextBudget });
  const requiredBeforeShip = requiredPromptDeltaShipEvidence();
  const combinedEvidencePath = evidencePath(log, sessionContextEvidence);
  const markdown = renderPromptDeltaGateMarkdown({
    generatedAt,
    projectName: st.agentfile.project.name,
    evidencePath: combinedEvidencePath,
    evidence,
    contextBudget,
    signals,
    decision,
    requiredBeforeShip,
  });

  let appendedPath: string | undefined;
  let evidenceRecordPath: string | undefined;
  if (opts.append === true) {
    const outputPath = path.resolve(
      projectRoot,
      opts.outputPath ?? path.join("docs", "BENCHMARKS.md"),
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}\n`, "utf8");
    appendedPath = displayPathFromProject(projectRoot, outputPath);
    evidenceRecordPath = appendEvidenceRecord(
      projectRoot,
      promptDeltaGateEvidenceRecord({
        generatedAt,
        st,
        evidence,
        contextBudget,
        signals,
        decision,
        appendedPath,
      }),
    );
  }

  return {
    projectRoot,
    generatedAt,
    evidencePath: combinedEvidencePath,
    status: st,
    evidence,
    contextBudget,
    signals,
    decision,
    requiredBeforeShip,
    markdown,
    appendedPath,
    evidenceRecordPath,
  };
}

function readPromptGateEvidenceRecords(
  projectRoot: string,
  explicitSources: readonly string[],
): RuntimeEvidenceLog {
  const logs = [readEvidenceRecords(projectRoot)];
  for (const source of defaultPromptGateEvidenceSources(projectRoot)) {
    logs.push(readEvidenceFile(source.absPath, source.displayPath));
  }
  for (const source of explicitSources) {
    const absPath = path.resolve(projectRoot, source);
    logs.push(readEvidenceFile(absPath, displayPathFromProject(projectRoot, absPath)));
  }
  return {
    path: logs.map((log) => log.path).join("; "),
    total: logs.reduce((sum, log) => sum + log.total, 0),
    invalid: logs.reduce((sum, log) => sum + log.invalid, 0),
    records: logs.flatMap((log) => log.records),
  };
}

function defaultPromptGateEvidenceSources(
  projectRoot: string,
): { absPath: string; displayPath: string }[] {
  const dir = path.join(projectRoot, "docs", "benchmark-evidence");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(dir, entry.name))
    .sort()
    .map((absPath) => ({
      absPath,
      displayPath: displayPathFromProject(projectRoot, absPath),
    }));
}

function summarizePromptGateEvidence(
  records: readonly RuntimeEvidenceRecord[],
  invalidRecords: number,
  sessionContextEvidence?: PromptDeltaGateSessionContextEvidence,
): PromptDeltaGateEvidenceSummary {
  let benchmarkReports = 0;
  let benchmarkCompares = 0;
  let agentTaskBenchmarks = 0;
  let agentTaskBenchmarkCompares = 0;
  let retrievalBenchmarks = 0;
  let compactRetrievalBenchmarks = 0;
  let fullRetrievalBenchmarks = 0;
  let continuityGaps = 0;
  let continuityRegressions = 0;
  let taskFriction = 0;
  let taskFailures = 0;
  let retrievalFriction = 0;
  let retrievalFailures = 0;
  let retrievalComparisonRegressions = 0;
  let retrievalComparisonFailures = 0;

  for (const record of records) {
    if (record.kind === "benchmark-report") {
      benchmarkReports++;
      const scorecard = objectField(record.summary, "scorecard");
      const continuity = scorecard ? objectField(scorecard, "continuity") : undefined;
      const ready = continuity ? booleanField(continuity, "ready") : undefined;
      const passed = continuity ? numberField(continuity, "passed") : undefined;
      const total = continuity ? numberField(continuity, "total") : undefined;
      if (ready === false || (passed !== undefined && total !== undefined && passed < total)) {
        continuityGaps++;
      }
      continue;
    }

    if (record.kind === "benchmark-compare") {
      benchmarkCompares++;
      const deltas = Array.isArray(record.details?.deltas)
        ? record.details.deltas
        : [];
      for (const delta of deltas) {
        if (!isObject(delta)) continue;
        if (
          delta.id === "continuity-checks" &&
          delta.verdict === "regressed"
        ) {
          continuityRegressions++;
        }
      }
      continue;
    }

    if (record.kind === "agent-task-benchmark") {
      agentTaskBenchmarks++;
      const score = objectField(record.summary, "score");
      const metrics = objectField(record.summary, "metrics");
      const retrieval = objectField(record.summary, "retrieval");
      const points = score ? numberField(score, "points") : undefined;
      const total = score ? numberField(score, "total") : undefined;
      const questions = metrics ? numberField(metrics, "questions_before_action") : undefined;
      const turns = metrics ? numberField(metrics, "tool_turns_to_context") : undefined;
      const firstCorrect = metrics ? booleanField(metrics, "first_correct_action") : undefined;
      const handoffRecovered = metrics ? booleanField(metrics, "handoff_recovered") : undefined;
      const taskSuccess = metrics ? booleanField(metrics, "task_success") : undefined;
      const expectedSourceReads = metrics
        ? numberField(metrics, "expected_source_reads")
        : undefined;
      const requiredSourceReads = metrics
        ? numberField(metrics, "required_source_reads")
        : undefined;
      const expectedSourceCitations = metrics
        ? numberField(metrics, "expected_source_citations")
        : undefined;
      const sourceCitations = metrics
        ? numberField(metrics, "source_citations")
        : undefined;
      const missedInvariantCount = metrics
        ? numberField(metrics, "missed_invariant_count")
        : undefined;
      const hallucinatedFactCount = metrics
        ? numberField(metrics, "hallucinated_fact_count")
        : undefined;
      const unnecessaryContextReads = metrics
        ? numberField(metrics, "unnecessary_context_reads")
        : undefined;
      const managedRegionEditAttempts = metrics
        ? numberField(metrics, "managed_region_edit_attempts")
        : undefined;
      const bootstrapEditAttempts = metrics
        ? numberField(metrics, "bootstrap_edit_attempts")
        : undefined;
      const handoffRefreshRequired = metrics
        ? booleanField(metrics, "handoff_refresh_required")
        : undefined;
      const handoffRefreshed = metrics
        ? booleanField(metrics, "handoff_refreshed")
        : undefined;
      const matchedHarnessRead = metrics
        ? booleanField(metrics, "matched_harness_read")
        : undefined;
      const nonmatchedHarnessReads = metrics
        ? numberField(metrics, "nonmatched_harness_reads")
        : undefined;
      const sourceReadRate =
        retrieval && numberField(retrieval, "required_source_read_rate") !== undefined
          ? numberField(retrieval, "required_source_read_rate")
          : expectedSourceReads !== undefined &&
              expectedSourceReads > 0 &&
              requiredSourceReads !== undefined
            ? requiredSourceReads / expectedSourceReads
            : undefined;
      const sourceCitationRate =
        retrieval && numberField(retrieval, "source_citation_rate") !== undefined
          ? numberField(retrieval, "source_citation_rate")
          : expectedSourceCitations !== undefined &&
              expectedSourceCitations > 0 &&
              sourceCitations !== undefined
            ? sourceCitations / expectedSourceCitations
            : undefined;
      const sessionContextMode =
        typeof record.summary.session_context_mode === "string"
          ? record.summary.session_context_mode
          : undefined;
      const hasRetrievalMetrics =
        taskSuccess !== undefined ||
        expectedSourceReads !== undefined ||
        requiredSourceReads !== undefined ||
        missedInvariantCount !== undefined ||
        hallucinatedFactCount !== undefined ||
        unnecessaryContextReads !== undefined ||
        sourceReadRate !== undefined ||
        sourceCitationRate !== undefined ||
        managedRegionEditAttempts !== undefined ||
        bootstrapEditAttempts !== undefined ||
        handoffRefreshRequired !== undefined ||
        handoffRefreshed !== undefined ||
        matchedHarnessRead !== undefined ||
        nonmatchedHarnessReads !== undefined;
      if (hasRetrievalMetrics) {
        retrievalBenchmarks++;
        if (sessionContextMode === "compact") compactRetrievalBenchmarks++;
        if (sessionContextMode === "full") fullRetrievalBenchmarks++;
      }
      const recordRetrievalFriction =
        hasRetrievalMetrics &&
        ((sourceReadRate !== undefined && sourceReadRate < 1) ||
          (sourceCitationRate !== undefined && sourceCitationRate < 1) ||
          (unnecessaryContextReads !== undefined && unnecessaryContextReads > 0) ||
          (managedRegionEditAttempts !== undefined &&
            managedRegionEditAttempts > 0) ||
          (bootstrapEditAttempts !== undefined && bootstrapEditAttempts > 0) ||
          (handoffRefreshRequired === true && handoffRefreshed === false) ||
          matchedHarnessRead === false ||
          (nonmatchedHarnessReads !== undefined && nonmatchedHarnessReads > 0) ||
          (missedInvariantCount !== undefined && missedInvariantCount > 0) ||
          (hallucinatedFactCount !== undefined && hallucinatedFactCount > 0) ||
          taskSuccess === false);
      const recordRetrievalFailure =
        hasRetrievalMetrics &&
        (taskSuccess === false ||
          (sourceCitationRate !== undefined && sourceCitationRate < 1) ||
          (managedRegionEditAttempts !== undefined &&
            managedRegionEditAttempts > 0) ||
          (bootstrapEditAttempts !== undefined && bootstrapEditAttempts > 0) ||
          (handoffRefreshRequired === true && handoffRefreshed === false) ||
          (missedInvariantCount !== undefined && missedInvariantCount > 0) ||
          (hallucinatedFactCount !== undefined && hallucinatedFactCount > 0));
      if (
        (points !== undefined && total !== undefined && points < total) ||
        (questions !== undefined && questions > 0) ||
        (turns !== undefined && turns > 1) ||
        recordRetrievalFriction
      ) {
        taskFriction++;
      }
      if (recordRetrievalFriction) retrievalFriction++;
      if (
        firstCorrect === false ||
        handoffRecovered === false ||
        recordRetrievalFailure
      ) {
        taskFailures++;
      }
      if (recordRetrievalFailure) retrievalFailures++;
      continue;
    }

    if (record.kind === "agent-task-benchmark-compare") {
      agentTaskBenchmarkCompares++;
      const regressions = numberField(record.summary, "regressions") ?? 0;
      const failures = numberField(record.summary, "failures") ?? 0;
      const withinTolerance = booleanField(
        record.summary,
        "compact_task_success_within_tolerance",
      );
      const missedInvariantDelta = numberField(
        record.summary,
        "missed_invariant_delta",
      );
      const hallucinatedFactDelta = numberField(
        record.summary,
        "hallucinated_fact_delta",
      );
      const compareFriction = regressions > 0;
      const compareFailure =
        failures > 0 ||
        withinTolerance === false ||
        (missedInvariantDelta !== undefined && missedInvariantDelta > 0) ||
        (hallucinatedFactDelta !== undefined && hallucinatedFactDelta > 0);
      if (compareFriction) {
        taskFriction++;
        retrievalFriction++;
        retrievalComparisonRegressions += regressions;
      }
      if (compareFailure) {
        taskFailures++;
        retrievalFailures++;
        retrievalComparisonFailures += Math.max(1, failures);
      }
    }
  }

  return {
    records: records.length,
    invalidRecords,
    benchmarkReports,
    benchmarkCompares,
    agentTaskBenchmarks,
    agentTaskBenchmarkCompares,
    retrievalBenchmarks,
    compactRetrievalBenchmarks,
    fullRetrievalBenchmarks,
    continuityGaps,
    continuityRegressions,
    taskFriction,
    taskFailures,
    retrievalFriction,
    retrievalFailures,
    retrievalComparisonRegressions,
    retrievalComparisonFailures,
    sessionContextBenchmarks: sessionContextEvidence ? 1 : 0,
    sessionContextCompactCapExceeded:
      sessionContextEvidence?.summary.compactCapExceeded ?? 0,
    sessionContextFullCapExceeded:
      sessionContextEvidence?.summary.fullCapExceeded ?? 0,
    ...(sessionContextEvidence
      ? {
          sessionContextLargeReductionPct:
            sessionContextEvidence.summary.largeFixtureCompactReductionPct,
          sessionContextCompactRequiredRulePasses:
            sessionContextEvidence.summary.compactRequiredRulePasses,
          sessionContextCompactRequiredRuleTotal:
            sessionContextEvidence.summary.compactRequiredRuleTotal,
          sessionContextCompactSourcePointerFixtures:
            sessionContextEvidence.summary.compactSourcePointerFixtures,
        }
      : {}),
  };
}

function readSessionContextBenchmarkEvidence(
  projectRoot: string,
): PromptDeltaGateSessionContextEvidence | undefined {
  const rel = path.join(
    "docs",
    "benchmark-evidence",
    "session-context",
    "session-context.json",
  );
  const abs = path.join(projectRoot, rel);
  if (!fs.existsSync(abs)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
    if (
      isObject(parsed) &&
      parsed.schema_version === SESSION_CONTEXT_BENCHMARK_SCHEMA_VERSION &&
      isObject(parsed.summary)
    ) {
      return {
        path: rel.split(path.sep).join("/"),
        summary: parsed.summary as SessionContextBenchmarkResult["summary"],
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function evidencePath(
  log: RuntimeEvidenceLog,
  sessionContextEvidence?: PromptDeltaGateSessionContextEvidence,
): string {
  return sessionContextEvidence
    ? `${log.path}; ${sessionContextEvidence.path}`
    : log.path;
}

function measurePromptContextBudget(input: {
  projectRoot: string;
  maxPromptDeltaTokens: number;
  duplicateContextRisk: PromptDeltaGateRisk;
}): PromptDeltaGateContextBudget {
  const files = contextFiles(input.projectRoot);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const estimatedTokens = estimateTokens(bytes);
  return {
    files,
    bytes,
    estimatedTokens,
    maxPromptDeltaTokens: input.maxPromptDeltaTokens,
    duplicateContextRisk: input.duplicateContextRisk,
  };
}

function contextFiles(projectRoot: string): PromptDeltaGateContextFile[] {
  const out: PromptDeltaGateContextFile[] = [];
  visit(projectRoot, (file) => {
    const rel = displayPathFromProject(projectRoot, file);
    if (
      (rel.includes("/.anamnesis/ontology/") ||
        rel.startsWith(".anamnesis/ontology/")) &&
      rel.endsWith(".yaml")
    ) {
      out.push(contextFile(projectRoot, file, "ontology"));
    }
  });

  const systemGraph = path.join(projectRoot, "system_graph.yaml");
  if (fs.existsSync(systemGraph)) {
    out.push(contextFile(projectRoot, systemGraph, "system-graph"));
  }

  const active = path.join(projectRoot, ".anamnesis", "handoff", "active.md");
  if (fs.existsSync(active)) {
    out.push(contextFile(projectRoot, active, "handoff"));
  }
  const latest = newestHandoffArchive(projectRoot);
  if (latest && latest.abs !== active) {
    out.push(contextFile(projectRoot, latest.abs, "handoff"));
  }

  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function contextFile(
  projectRoot: string,
  filePath: string,
  kind: PromptDeltaGateContextFile["kind"],
): PromptDeltaGateContextFile {
  const bytes = fs.statSync(filePath).size;
  return {
    path: displayPathFromProject(projectRoot, filePath),
    kind,
    bytes,
    estimatedTokens: estimateTokens(bytes),
  };
}

function newestHandoffArchive(
  projectRoot: string,
): { abs: string; rel: string } | undefined {
  const dir = path.join(projectRoot, ".anamnesis", "handoff");
  if (!fs.existsSync(dir)) return undefined;
  let newest: { abs: string; rel: string; mtime: number } | undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "active.md" || !entry.name.endsWith(".md")) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    const mtime = fs.statSync(abs).mtimeMs;
    if (!newest || mtime > newest.mtime) {
      newest = {
        abs,
        rel: displayPathFromProject(projectRoot, abs),
        mtime,
      };
    }
  }
  return newest ? { abs: newest.abs, rel: newest.rel } : undefined;
}

function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

function duplicateContextRisk(
  st: StatusResult,
  evidence: PromptDeltaGateEvidenceSummary,
): PromptDeltaGateRisk {
  if (st.continuity.ready && evidence.continuityGaps === 0) return "high";
  if (st.continuity.passed >= Math.max(1, st.continuity.total - 1)) return "medium";
  return "low";
}

function promptDeltaSignals(input: {
  st: StatusResult;
  evidence: PromptDeltaGateEvidenceSummary;
  contextBudget: PromptDeltaGateContextBudget;
}): PromptDeltaGateSignal[] {
  const signals: PromptDeltaGateSignal[] = [];
  signals.push({
    id: "session-context-benchmark",
    label: "Session context benchmark",
    status:
      input.evidence.sessionContextBenchmarks === 0
        ? "warn"
        : input.evidence.sessionContextCompactCapExceeded > 0 ||
            input.evidence.sessionContextCompactRequiredRulePasses !==
              input.evidence.sessionContextCompactRequiredRuleTotal
          ? "fail"
          : "pass",
    detail:
      input.evidence.sessionContextBenchmarks === 0
        ? "no session-context benchmark JSON found"
        : `large reduction ${input.evidence.sessionContextLargeReductionPct ?? "?"}%; compact cap exceeded ${input.evidence.sessionContextCompactCapExceeded}; required rules ${input.evidence.sessionContextCompactRequiredRulePasses ?? "?"}/${input.evidence.sessionContextCompactRequiredRuleTotal ?? "?"}`,
  });

  signals.push({
    id: "session-start-continuity",
    label: "SessionStart + handoff continuity",
    status: input.st.continuity.ready ? "pass" : "fail",
    detail: `${input.st.continuity.passed}/${input.st.continuity.total} continuity checks passing`,
  });

  signals.push({
    id: "deterministic-continuity-evidence",
    label: "Deterministic continuity evidence",
    status:
      input.evidence.continuityRegressions > 0 ||
      (input.evidence.continuityGaps > 0 && !input.st.continuity.ready)
        ? "fail"
        : input.evidence.continuityGaps > 0
          ? "warn"
        : input.evidence.benchmarkReports === 0
          ? "warn"
          : "pass",
    detail:
      input.evidence.benchmarkReports === 0
        ? "no benchmark-report evidence found"
        : `${input.evidence.continuityGaps} report gap(s), ${input.evidence.continuityRegressions} continuity regression(s)`,
  });

  signals.push({
    id: "agent-task-friction",
    label: "Agent task friction",
    status:
      input.evidence.taskFailures > 0
        ? "fail"
        : input.evidence.taskFriction > 0
          ? "warn"
          : input.evidence.agentTaskBenchmarks === 0 &&
              input.evidence.agentTaskBenchmarkCompares === 0
            ? "warn"
            : "pass",
    detail:
      input.evidence.agentTaskBenchmarks === 0 &&
      input.evidence.agentTaskBenchmarkCompares === 0
        ? "no model-dependent task benchmark evidence found"
        : `${input.evidence.taskFriction} friction run(s), ${input.evidence.taskFailures} hard failure(s); retrieval ${input.evidence.retrievalFriction}/${input.evidence.retrievalFailures}; compares ${input.evidence.agentTaskBenchmarkCompares}`,
  });

  signals.push({
    id: "prompt-token-budget",
    label: "Prompt-time token budget",
    status:
      input.contextBudget.estimatedTokens <= input.contextBudget.maxPromptDeltaTokens
        ? "pass"
        : "fail",
    detail: `${input.contextBudget.estimatedTokens} estimated token(s) across ${input.contextBudget.files.length} context file(s); max ${input.contextBudget.maxPromptDeltaTokens}`,
  });

  signals.push({
    id: "duplicate-context-risk",
    label: "Duplicate context risk",
    status:
      input.contextBudget.duplicateContextRisk === "high"
        ? "fail"
        : input.contextBudget.duplicateContextRisk === "medium"
          ? "warn"
          : "pass",
    detail: `${input.contextBudget.duplicateContextRisk} risk of repeating SessionStart/handoff context on every prompt`,
  });

  return signals;
}

function decidePromptDelta(input: {
  evidence: PromptDeltaGateEvidenceSummary;
  contextBudget: PromptDeltaGateContextBudget;
}): PromptDeltaGateDecision {
  const hasEvidence =
    input.evidence.benchmarkReports > 0 ||
    input.evidence.agentTaskBenchmarks > 0 ||
    input.evidence.agentTaskBenchmarkCompares > 0;
  const hasSessionContextEvidence = input.evidence.sessionContextBenchmarks > 0;
  const evidenceShowsGap =
    input.evidence.continuityGaps > 0 ||
    input.evidence.continuityRegressions > 0 ||
    input.evidence.taskFriction > 0 ||
    input.evidence.taskFailures > 0 ||
    input.evidence.retrievalFriction > 0 ||
    input.evidence.retrievalFailures > 0 ||
    input.evidence.sessionContextCompactCapExceeded > 0;
  if (!hasEvidence && !hasSessionContextEvidence) {
    return {
      recommendation: "defer",
      shouldImplementPromptDelta: false,
      reason: "No benchmark evidence justifies adding prompt-time context.",
    };
  }
  if (!evidenceShowsGap) {
    return {
      recommendation: "defer",
      shouldImplementPromptDelta: false,
      reason:
        "Existing SessionStart and handoff evidence covers continuity; prompt-time context would add duplicate noise.",
    };
  }

  const repeatedGap =
    input.evidence.continuityGaps + input.evidence.continuityRegressions >= 2 ||
    input.evidence.taskFailures >= 2 ||
    input.evidence.taskFriction >= 3 ||
    input.evidence.retrievalFailures >= 2 ||
    input.evidence.retrievalFriction >= 3;
  const tokenBudgetOk =
    input.contextBudget.estimatedTokens <= input.contextBudget.maxPromptDeltaTokens;
  const duplicateRiskOk = input.contextBudget.duplicateContextRisk !== "high";
  if (!repeatedGap || !tokenBudgetOk || !duplicateRiskOk) {
    return {
      recommendation: "collect-more-evidence",
      shouldImplementPromptDelta: false,
      reason:
        "A gap exists, but repeated-gap evidence, token budget, or duplicate-risk controls are not strong enough for implementation.",
    };
  }

  return {
    recommendation: "prototype",
    shouldImplementPromptDelta: true,
    reason:
      "Repeated continuity friction plus bounded prompt budget justify a non-default prompt-time delta prototype.",
  };
}

function requiredPromptDeltaShipEvidence(): string[] {
  return [
    "repeated same-task failures showing SessionStart + handoff did not recover context",
    "measured prompt delta stays under the configured token budget",
    "dedupe rules prove the same ontology/handoff block is not repeated every prompt",
    "UserPromptSubmit smoke evidence covers disabled, enabled, and stale-context paths",
  ];
}

function promptDeltaGateEvidenceRecord(input: {
  generatedAt: string;
  st: StatusResult;
  evidence: PromptDeltaGateEvidenceSummary;
  contextBudget: PromptDeltaGateContextBudget;
  signals: PromptDeltaGateSignal[];
  decision: PromptDeltaGateDecision;
  appendedPath: string;
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "prompt-delta-gate",
    generated_at: input.generatedAt,
    command: ["anamnesis", "benchmark", "prompt-gate"],
    project: { name: input.st.agentfile.project.name },
    summary: {
      schema_version: PROMPT_DELTA_GATE_SCHEMA_VERSION,
      recommendation: input.decision.recommendation,
      should_implement_prompt_delta: input.decision.shouldImplementPromptDelta,
      evidence: input.evidence,
      context_budget: {
        bytes: input.contextBudget.bytes,
        estimated_tokens: input.contextBudget.estimatedTokens,
        max_prompt_delta_tokens: input.contextBudget.maxPromptDeltaTokens,
        duplicate_context_risk: input.contextBudget.duplicateContextRisk,
      },
    },
    details: {
      reason: input.decision.reason,
      signals: input.signals,
      context_files: input.contextBudget.files,
      required_before_ship: requiredPromptDeltaShipEvidence(),
    },
    artifacts: {
      markdown: input.appendedPath,
    },
  };
}

function renderPromptDeltaGateMarkdown(input: {
  generatedAt: string;
  projectName: string;
  evidencePath: string;
  evidence: PromptDeltaGateEvidenceSummary;
  contextBudget: PromptDeltaGateContextBudget;
  signals: PromptDeltaGateSignal[];
  decision: PromptDeltaGateDecision;
  requiredBeforeShip: readonly string[];
}): string {
  return [
    `## Prompt-Time Delta Gate — ${input.generatedAt}`,
    "",
    `Project: ${input.projectName}`,
    `Decision: ${input.decision.recommendation}`,
    `Implement prompt-time delta: ${input.decision.shouldImplementPromptDelta ? "yes" : "no"}`,
    `Reason: ${input.decision.reason}`,
    `Evidence source: ${input.evidencePath}`,
    "",
    "Evidence:",
    `- records: ${input.evidence.records} valid / ${input.evidence.invalidRecords} invalid`,
    `- benchmark reports: ${input.evidence.benchmarkReports}`,
    `- benchmark compares: ${input.evidence.benchmarkCompares}`,
    `- session-context benchmarks: ${input.evidence.sessionContextBenchmarks}`,
    `- agent task benchmarks: ${input.evidence.agentTaskBenchmarks}`,
    `- agent task compares: ${input.evidence.agentTaskBenchmarkCompares}`,
    `- retrieval benchmarks: ${input.evidence.retrievalBenchmarks} (compact ${input.evidence.compactRetrievalBenchmarks}, full ${input.evidence.fullRetrievalBenchmarks})`,
    `- continuity gaps: ${input.evidence.continuityGaps}`,
    `- task friction/failures: ${input.evidence.taskFriction}/${input.evidence.taskFailures}`,
    `- retrieval friction/failures: ${input.evidence.retrievalFriction}/${input.evidence.retrievalFailures}`,
    `- retrieval compare regressions/failures: ${input.evidence.retrievalComparisonRegressions}/${input.evidence.retrievalComparisonFailures}`,
    "",
    "Context budget:",
    `- estimated duplicate prompt context: ${input.contextBudget.bytes} bytes (~${input.contextBudget.estimatedTokens} tokens)`,
    `- max prompt delta budget: ${input.contextBudget.maxPromptDeltaTokens} tokens`,
    `- duplicate context risk: ${input.contextBudget.duplicateContextRisk}`,
    "",
    "| Signal | Status | Detail |",
    "|---|---|---|",
    ...input.signals.map(
      (signal) =>
        `| ${escapeCell(signal.label)} | ${signal.status} | ${escapeCell(signal.detail)} |`,
    ),
    "",
    "Required before default shipping:",
    ...input.requiredBeforeShip.map((item) => `- ${item}`),
  ].join("\n");
}

function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const field = value[key];
  return isObject(field) ? field : undefined;
}

function numberField(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function booleanField(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}

function visit(dir: string, onFile: (file: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name === ".next"
    ) {
      continue;
    }
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(fp, onFile);
    } else if (entry.isFile()) {
      onFile(fp);
    }
  }
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
