import * as fs from "node:fs";
import * as path from "node:path";
import {
  findAgentfile,
  readAgentfile,
} from "../core/agentfile.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import { projectRelativePath } from "../core/lifecycle_evidence.js";

export const BENCHMARK_TRACE_LOG_PATH = ".anamnesis/logs/benchmark-traces.jsonl";
export const BENCHMARK_TRACE_SUMMARY_PATH = "docs/BENCHMARK-TRACES.md";
const BENCHMARK_TRACE_SCHEMA_VERSION = "anamnesis.benchmark_trace.v1";
const BENCHMARK_TRACE_ROLLUP_SCHEMA_VERSION =
  "anamnesis.benchmark_trace_rollup.v1";
const RECENT_RECORD_LIMIT = 20;

export interface BenchmarkTraceRecord {
  schema_version?: typeof BENCHMARK_TRACE_SCHEMA_VERSION;
  generated_at: string;
  run_id?: string;
  phase: string;
  status: string;
  duration_ms?: number;
  metrics?: Record<string, number>;
  detail?: string;
}

export interface BenchmarkTracePhaseSummary {
  phase: string;
  total: number;
  byStatus: Record<string, number>;
  duration_ms: {
    count: number;
    total: number;
    min?: number;
    max?: number;
    avg?: number;
  };
  latest?: BenchmarkTraceRecord;
}

export interface BenchmarkTraceStatusSummary {
  status: string;
  total: number;
}

export interface BenchmarkTraceRollupResult {
  projectRoot: string;
  projectName: string;
  generatedAt: string;
  sourcePath: string;
  total: number;
  invalid: number;
  latest?: BenchmarkTraceRecord;
  byPhase: BenchmarkTracePhaseSummary[];
  byStatus: BenchmarkTraceStatusSummary[];
  metrics: Record<string, number>;
  recent: BenchmarkTraceRecord[];
  ok: boolean;
  markdown?: string;
  appendedPath?: string;
  evidencePath?: string;
}

export interface BenchmarkTraceRollupOptions {
  projectRoot: string;
  sourcePath?: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class BenchmarkTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkTraceError";
  }
}

interface BenchmarkTraceReadResult {
  path: string;
  total: number;
  invalid: number;
  records: BenchmarkTraceRecord[];
}

export function benchmarkTraceRollup(
  opts: BenchmarkTraceRollupOptions,
): BenchmarkTraceRollupResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const sourcePath = opts.sourcePath ?? BENCHMARK_TRACE_LOG_PATH;
  const log = readBenchmarkTraceLog(projectRoot, sourcePath);
  const latest = latestTraceRecord(log.records);
  const result: BenchmarkTraceRollupResult = {
    projectRoot,
    projectName: readProjectName(projectRoot),
    generatedAt,
    sourcePath: log.path,
    total: log.total,
    invalid: log.invalid,
    ...(latest ? { latest } : {}),
    byPhase: tracePhaseSummaries(log.records),
    byStatus: traceStatusSummaries(log.records),
    metrics: aggregateMetrics(log.records),
    recent: log.records.slice(-RECENT_RECORD_LIMIT),
    ok: log.invalid === 0,
  };

  const markdown = renderBenchmarkTraceMarkdown(result);
  if (opts.append) {
    const outputPath = opts.outputPath ?? BENCHMARK_TRACE_SUMMARY_PATH;
    const appendedPath = appendBenchmarkTraceMarkdown(
      projectRoot,
      outputPath,
      markdown,
    );
    const evidencePath = appendEvidenceRecord(
      projectRoot,
      benchmarkTraceRollupEvidenceRecord({
        result,
        appendedPath,
      }),
    );
    return {
      ...result,
      markdown,
      appendedPath,
      evidencePath,
    };
  }

  return {
    ...result,
    markdown,
  };
}

export function readBenchmarkTraceLog(
  projectRoot: string,
  sourcePath = BENCHMARK_TRACE_LOG_PATH,
): BenchmarkTraceReadResult {
  const abs = path.isAbsolute(sourcePath)
    ? sourcePath
    : path.join(projectRoot, sourcePath);
  const displayPath = path.isAbsolute(sourcePath) ? sourcePath : sourcePath;
  if (!fs.existsSync(abs)) {
    return { path: displayPath, total: 0, invalid: 0, records: [] };
  }

  let total = 0;
  let invalid = 0;
  const records: BenchmarkTraceRecord[] = [];
  for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isBenchmarkTraceRecord(parsed)) {
        total++;
        records.push(parsed);
      } else {
        invalid++;
      }
    } catch {
      invalid++;
    }
  }
  return { path: displayPath, total, invalid, records };
}

function readProjectName(projectRoot: string): string {
  if (findAgentfile(projectRoot)) {
    try {
      return readAgentfile(projectRoot).project.name;
    } catch {
      return path.basename(projectRoot);
    }
  }
  return path.basename(projectRoot);
}

function isBenchmarkTraceRecord(value: unknown): value is BenchmarkTraceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<BenchmarkTraceRecord>;
  return (
    (record.schema_version === undefined ||
      record.schema_version === BENCHMARK_TRACE_SCHEMA_VERSION) &&
    typeof record.generated_at === "string" &&
    typeof record.phase === "string" &&
    typeof record.status === "string" &&
    (record.run_id === undefined || typeof record.run_id === "string") &&
    (record.duration_ms === undefined ||
      (typeof record.duration_ms === "number" &&
        Number.isFinite(record.duration_ms))) &&
    (record.metrics === undefined || isNumberRecord(record.metrics)) &&
    (record.detail === undefined || typeof record.detail === "string")
  );
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) => typeof item === "number" && Number.isFinite(item),
  );
}

function latestTraceRecord(
  records: readonly BenchmarkTraceRecord[],
): BenchmarkTraceRecord | undefined {
  let latest = records[0];
  for (const record of records.slice(1)) {
    if (!latest || record.generated_at >= latest.generated_at) {
      latest = record;
    }
  }
  return latest;
}

function tracePhaseSummaries(
  records: readonly BenchmarkTraceRecord[],
): BenchmarkTracePhaseSummary[] {
  const byPhase = new Map<string, BenchmarkTraceRecord[]>();
  for (const record of records) {
    const list = byPhase.get(record.phase) ?? [];
    list.push(record);
    byPhase.set(record.phase, list);
  }
  return [...byPhase.entries()]
    .map(([phase, phaseRecords]) => ({
      phase,
      total: phaseRecords.length,
      byStatus: countBy(phaseRecords.map((record) => record.status)),
      duration_ms: durationStats(phaseRecords),
      latest: latestTraceRecord(phaseRecords),
    }))
    .sort((a, b) => a.phase.localeCompare(b.phase));
}

function traceStatusSummaries(
  records: readonly BenchmarkTraceRecord[],
): BenchmarkTraceStatusSummary[] {
  return Object.entries(countBy(records.map((record) => record.status)))
    .map(([status, total]) => ({ status, total }))
    .sort((a, b) => a.status.localeCompare(b.status));
}

function aggregateMetrics(
  records: readonly BenchmarkTraceRecord[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record.metrics ?? {})) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function durationStats(records: readonly BenchmarkTraceRecord[]): {
  count: number;
  total: number;
  min?: number;
  max?: number;
  avg?: number;
} {
  const durations = records
    .map((record) => record.duration_ms)
    .filter((value): value is number => typeof value === "number");
  const total = durations.reduce((sum, value) => sum + value, 0);
  if (durations.length === 0) {
    return { count: 0, total: 0 };
  }
  return {
    count: durations.length,
    total,
    min: Math.min(...durations),
    max: Math.max(...durations),
    avg: total / durations.length,
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function appendBenchmarkTraceMarkdown(
  projectRoot: string,
  outputPath: string,
  markdown: string,
): string {
  const abs = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(projectRoot, outputPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${markdown}\n\n`, "utf8");
  return projectRelativePath(projectRoot, abs);
}

function renderBenchmarkTraceMarkdown(result: BenchmarkTraceRollupResult): string {
  const phaseRows =
    result.byPhase.length === 0
      ? ["| (none) | 0 | | | |"]
      : result.byPhase.map((phase) =>
          [
            `| ${escapeCell(phase.phase)}`,
            String(phase.total),
            escapeCell(statusCountsLabel(phase.byStatus)),
            durationLabel(phase.duration_ms),
            phase.latest?.generated_at ?? "",
          ].join(" | ") + " |",
        );
  const metricRows =
    Object.keys(result.metrics).length === 0
      ? ["| (none) | 0 |"]
      : Object.entries(result.metrics).map(
          ([metric, total]) => `| ${escapeCell(metric)} | ${formatNumber(total)} |`,
        );
  const recentRows =
    result.recent.length === 0
      ? ["| (none) | | | | |"]
      : result.recent.map((record) =>
          [
            `| ${escapeCell(record.generated_at)}`,
            escapeCell(record.phase),
            escapeCell(record.status),
            record.duration_ms === undefined ? "" : formatNumber(record.duration_ms),
            escapeCell(record.detail ?? record.run_id ?? ""),
          ].join(" | ") + " |",
        );
  return [
    `## Benchmark Trace Rollup — ${result.generatedAt}`,
    "",
    `Project: ${result.projectName}`,
    `Source: \`${result.sourcePath}\``,
    `Records: ${result.total} valid, ${result.invalid} invalid`,
    result.latest
      ? `Latest: ${result.latest.phase} ${result.latest.status} at ${result.latest.generated_at}`
      : "Latest: none",
    "",
    "| Phase | Total | Status counts | Duration | Latest |",
    "|---|---:|---|---|---|",
    ...phaseRows,
    "",
    "| Metric | Total |",
    "|---|---:|",
    ...metricRows,
    "",
    "| Generated at | Phase | Status | Duration ms | Detail/run |",
    "|---|---|---|---:|---|",
    ...recentRows,
  ].join("\n");
}

function statusCountsLabel(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, total]) => `${status}=${total}`)
    .join(", ");
}

function durationLabel(stats: BenchmarkTracePhaseSummary["duration_ms"]): string {
  if (stats.count === 0) return "";
  return `total=${formatNumber(stats.total)}ms, avg=${formatNumber(stats.avg ?? 0)}ms`;
}

function benchmarkTraceRollupEvidenceRecord(input: {
  result: BenchmarkTraceRollupResult;
  appendedPath: string;
}): RuntimeEvidenceRecord {
  const { result } = input;
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "benchmark-trace-rollup",
    generated_at: result.generatedAt,
    command: ["anamnesis", "benchmark", "trace"],
    project: { name: result.projectName },
    summary: {
      schema_version: BENCHMARK_TRACE_ROLLUP_SCHEMA_VERSION,
      records: result.total,
      invalid_records: result.invalid,
      latest: result.latest
        ? {
            generated_at: result.latest.generated_at,
            phase: result.latest.phase,
            status: result.latest.status,
          }
        : null,
      by_phase: result.byPhase.map((phase) => ({
        phase: phase.phase,
        total: phase.total,
        by_status: phase.byStatus,
        duration_ms: phase.duration_ms,
        latest_generated_at: phase.latest?.generated_at,
      })),
      by_status: Object.fromEntries(
        result.byStatus.map((status) => [status.status, status.total]),
      ),
      metrics: result.metrics,
    },
    details: {
      recent: result.recent,
    },
    artifacts: {
      markdown: input.appendedPath,
      trace_log: result.sourcePath,
    },
  };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
