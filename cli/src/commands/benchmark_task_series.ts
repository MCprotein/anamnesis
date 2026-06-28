import * as fs from "node:fs";
import * as path from "node:path";
import {
  readEvidenceFile,
  readEvidenceRecords,
  type RuntimeEvidenceLog,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";

export const AGENT_TASK_BENCHMARK_SERIES_SCHEMA_VERSION =
  "anamnesis.agent_task_benchmark_series.v1";

export interface AgentTaskBenchmarkSeriesMetric {
  count: number;
  average?: number;
  min?: number;
  max?: number;
  stddev?: number;
}

export interface AgentTaskBenchmarkSeriesGroup {
  id: string;
  project: string;
  task_id: string;
  agent: string;
  model: string;
  context_state: string;
  pairs: number;
  full_task_success_rate?: number;
  compact_task_success_rate?: number;
  compact_success_within_tolerance_rate?: number;
  full_required_source_read_rate: AgentTaskBenchmarkSeriesMetric;
  compact_required_source_read_rate: AgentTaskBenchmarkSeriesMetric;
  required_source_read_rate_delta: AgentTaskBenchmarkSeriesMetric;
  full_source_citation_rate: AgentTaskBenchmarkSeriesMetric;
  compact_source_citation_rate: AgentTaskBenchmarkSeriesMetric;
  source_citation_rate_delta: AgentTaskBenchmarkSeriesMetric;
  total_tokens_delta: AgentTaskBenchmarkSeriesMetric;
  elapsed_ms_delta: AgentTaskBenchmarkSeriesMetric;
  compact_token_reduction_pct: AgentTaskBenchmarkSeriesMetric;
  regressions: number;
  failures: number;
  latest_generated_at: string;
}

export interface AgentTaskBenchmarkSeriesResult {
  schema_version: typeof AGENT_TASK_BENCHMARK_SERIES_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  evidencePath: string;
  evidenceRecords: number;
  invalidEvidenceLines: number;
  compareRecords: number;
  groups: AgentTaskBenchmarkSeriesGroup[];
  summary: {
    groups: number;
    pairs: number;
    failures: number;
    regressions: number;
  };
  markdown: string;
  artifacts: {
    outputDir?: string;
    json?: string;
    markdown?: string;
    tokenDeltaSvg?: string;
    qualitySummarySvg?: string;
    sourceCitationDeltaSvg?: string;
  };
}

export interface AgentTaskBenchmarkSeriesOptions {
  projectRoot: string;
  sources?: readonly string[];
  write?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class AgentTaskBenchmarkSeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTaskBenchmarkSeriesError";
  }
}

interface CompareRecord {
  generatedAt: string;
  project: string;
  taskId: string;
  agent: string;
  model: string;
  contextState: string;
  compactSuccessWithinTolerance?: boolean;
  regressions?: number;
  failures?: number;
  compactTaskSuccessDelta?: number;
  requiredSourceReadRateDelta?: number;
  sourceCitationRateDelta?: number;
  elapsedMsDelta?: number;
  totalTokensDelta?: number;
  compactTokenReductionPct?: number;
  fullTaskSuccess?: boolean;
  compactTaskSuccess?: boolean;
  fullRequiredSourceReadRate?: number;
  compactRequiredSourceReadRate?: number;
  fullSourceCitationRate?: number;
  compactSourceCitationRate?: number;
}

export function agentTaskBenchmarkSeries(
  opts: AgentTaskBenchmarkSeriesOptions,
): AgentTaskBenchmarkSeriesResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const log = readSeriesEvidenceRecords(projectRoot, opts.sources ?? []);
  const records = log.records
    .filter((record) => record.kind === "agent-task-benchmark-compare")
    .map(compareRecordFromEvidence)
    .filter((record): record is CompareRecord => record !== undefined);
  const groups = summarizeCompareRecords(records);
  const summary = {
    groups: groups.length,
    pairs: groups.reduce((sum, group) => sum + group.pairs, 0),
    failures: groups.reduce((sum, group) => sum + group.failures, 0),
    regressions: groups.reduce((sum, group) => sum + group.regressions, 0),
  };
  const markdown = renderAgentTaskBenchmarkSeriesMarkdown({
    generatedAt,
    evidencePath: log.path,
    evidenceRecords: log.total,
    invalidEvidenceLines: log.invalid,
    compareRecords: records.length,
    groups,
    summary,
  });

  const result: AgentTaskBenchmarkSeriesResult = {
    schema_version: AGENT_TASK_BENCHMARK_SERIES_SCHEMA_VERSION,
    projectRoot,
    generatedAt,
    evidencePath: log.path,
    evidenceRecords: log.total,
    invalidEvidenceLines: log.invalid,
    compareRecords: records.length,
    groups,
    summary,
    markdown,
    artifacts: {},
  };

  if (opts.write === true) {
    const outputDir = path.resolve(
      projectRoot,
      opts.outputPath ?? path.join("docs", "benchmark-evidence", "agent-task"),
    );
    fs.mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, "series.json");
    const markdownPath = path.join(outputDir, "series.md");
    const tokenDeltaSvgPath = path.join(outputDir, "series-token-delta.svg");
    const qualitySummarySvgPath = path.join(outputDir, "series-quality-summary.svg");
    const sourceCitationDeltaSvgPath = path.join(
      outputDir,
      "series-source-citation-delta.svg",
    );
    const artifacts = {
      outputDir: displayPathFromProject(projectRoot, outputDir),
      json: displayPathFromProject(projectRoot, jsonPath),
      markdown: displayPathFromProject(projectRoot, markdownPath),
      tokenDeltaSvg: displayPathFromProject(projectRoot, tokenDeltaSvgPath),
      qualitySummarySvg: displayPathFromProject(projectRoot, qualitySummarySvgPath),
      sourceCitationDeltaSvg: displayPathFromProject(
        projectRoot,
        sourceCitationDeltaSvgPath,
      ),
    };
    const serializable: AgentTaskBenchmarkSeriesResult = {
      ...result,
      projectRoot: ".",
      artifacts,
    };
    fs.writeFileSync(jsonPath, `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
    fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8");
    fs.writeFileSync(
      tokenDeltaSvgPath,
      renderTokenDeltaSvg(groups),
      "utf8",
    );
    fs.writeFileSync(
      qualitySummarySvgPath,
      renderQualitySummarySvg(groups),
      "utf8",
    );
    fs.writeFileSync(
      sourceCitationDeltaSvgPath,
      renderSourceCitationDeltaSvg(groups),
      "utf8",
    );
    return serializable;
  }

  return result;
}

function readSeriesEvidenceRecords(
  projectRoot: string,
  explicitSources: readonly string[],
): RuntimeEvidenceLog {
  const logs = [readEvidenceRecords(projectRoot)];
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

function compareRecordFromEvidence(
  record: RuntimeEvidenceRecord,
): CompareRecord | undefined {
  const summary = record.summary;
  const fullMetrics = objectField(record.details, "full_metrics");
  const compactMetrics = objectField(record.details, "compact_metrics");
  const taskId = stringField(summary, "task_id");
  const agent = stringField(summary, "agent");
  const model = stringField(summary, "model");
  const contextState = stringField(summary, "context_state");
  if (!taskId || !agent || !model || !contextState) return undefined;

  return {
    generatedAt: record.generated_at,
    project: record.project.name,
    taskId,
    agent,
    model,
    contextState,
    compactSuccessWithinTolerance: booleanField(
      summary,
      "compact_task_success_within_tolerance",
    ),
    regressions: numberField(summary, "regressions"),
    failures: numberField(summary, "failures"),
    compactTaskSuccessDelta: numberField(summary, "compact_task_success_delta"),
    requiredSourceReadRateDelta: numberField(
      summary,
      "required_source_read_rate_delta",
    ),
    sourceCitationRateDelta: numberField(summary, "source_citation_rate_delta"),
    elapsedMsDelta: numberField(summary, "elapsed_ms_delta"),
    totalTokensDelta: numberField(summary, "total_tokens_delta"),
    compactTokenReductionPct: numberField(
      summary,
      "compact_token_reduction_pct",
    ),
    fullTaskSuccess: booleanField(fullMetrics, "task_success"),
    compactTaskSuccess: booleanField(compactMetrics, "task_success"),
    fullRequiredSourceReadRate: sourceReadRate(fullMetrics),
    compactRequiredSourceReadRate: sourceReadRate(compactMetrics),
    fullSourceCitationRate: sourceCitationRate(fullMetrics),
    compactSourceCitationRate: sourceCitationRate(compactMetrics),
  };
}

function summarizeCompareRecords(
  records: readonly CompareRecord[],
): AgentTaskBenchmarkSeriesGroup[] {
  const groups = new Map<string, CompareRecord[]>();
  for (const record of records) {
    const id = seriesGroupId(record);
    const list = groups.get(id) ?? [];
    list.push(record);
    groups.set(id, list);
  }

  return [...groups.entries()]
    .map(([id, groupRecords]) => summarizeCompareRecordGroup(id, groupRecords))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function summarizeCompareRecordGroup(
  id: string,
  records: readonly CompareRecord[],
): AgentTaskBenchmarkSeriesGroup {
  const first = records[0];
  if (!first) {
    throw new AgentTaskBenchmarkSeriesError("cannot summarize an empty series group");
  }
  return {
    id,
    project: first.project,
    task_id: first.taskId,
    agent: first.agent,
    model: first.model,
    context_state: first.contextState,
    pairs: records.length,
    full_task_success_rate: booleanRate(records.map((record) => record.fullTaskSuccess)),
    compact_task_success_rate: booleanRate(
      records.map((record) => record.compactTaskSuccess),
    ),
    compact_success_within_tolerance_rate: booleanRate(
      records.map((record) => record.compactSuccessWithinTolerance),
    ),
    full_required_source_read_rate: metricSummary(
      records.map((record) => record.fullRequiredSourceReadRate),
    ),
    compact_required_source_read_rate: metricSummary(
      records.map((record) => record.compactRequiredSourceReadRate),
    ),
    required_source_read_rate_delta: metricSummary(
      records.map((record) => record.requiredSourceReadRateDelta),
    ),
    full_source_citation_rate: metricSummary(
      records.map((record) => record.fullSourceCitationRate),
    ),
    compact_source_citation_rate: metricSummary(
      records.map((record) => record.compactSourceCitationRate),
    ),
    source_citation_rate_delta: metricSummary(
      records.map((record) => record.sourceCitationRateDelta),
    ),
    total_tokens_delta: metricSummary(
      records.map((record) => record.totalTokensDelta),
    ),
    elapsed_ms_delta: metricSummary(records.map((record) => record.elapsedMsDelta)),
    compact_token_reduction_pct: metricSummary(
      records.map((record) => record.compactTokenReductionPct),
    ),
    regressions: sumNumbers(records.map((record) => record.regressions)),
    failures: sumNumbers(records.map((record) => record.failures)),
    latest_generated_at: records.reduce(
      (latest, record) =>
        record.generatedAt > latest ? record.generatedAt : latest,
      records[0]!.generatedAt,
    ),
  };
}

function renderAgentTaskBenchmarkSeriesMarkdown(input: {
  generatedAt: string;
  evidencePath: string;
  evidenceRecords: number;
  invalidEvidenceLines: number;
  compareRecords: number;
  groups: readonly AgentTaskBenchmarkSeriesGroup[];
  summary: AgentTaskBenchmarkSeriesResult["summary"];
}): string {
  const lines = [
    `# Agent Task Benchmark Series`,
    "",
    `Generated: ${input.generatedAt}`,
    `Evidence source: ${input.evidencePath} (${input.evidenceRecords} valid, ${input.invalidEvidenceLines} invalid)`,
    `Compare records: ${input.compareRecords}`,
    "",
    "Summary:",
    `- groups: ${input.summary.groups}`,
    `- pairs: ${input.summary.pairs}`,
    `- regressions: ${input.summary.regressions}`,
    `- failures: ${input.summary.failures}`,
    "",
    "| Series | Pairs | Full success | Compact success | Compact within tolerance | Required source read delta avg/stddev/min/max | Source citation delta avg/stddev/min/max | Token delta avg/stddev/min/max | Elapsed delta avg/stddev/min/max | Regressions | Failures |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...input.groups.map(
      (group) =>
        `| ${group.id} | ${group.pairs} | ${formatRate(group.full_task_success_rate)} | ${formatRate(group.compact_task_success_rate)} | ${formatRate(group.compact_success_within_tolerance_rate)} | ${formatMetricSpread(group.required_source_read_rate_delta)} | ${formatMetricSpread(group.source_citation_rate_delta)} | ${formatMetricSpread(group.total_tokens_delta)} | ${formatMetricSpread(group.elapsed_ms_delta)} | ${group.regressions} | ${group.failures} |`,
    ),
    "",
    "Claim boundary:",
    "- This rollup summarizes model-dependent pairs only.",
    "- Compact/full parity claims require enough repeated public-safe pairs for the task suite.",
  ];
  if (input.groups.length === 0) {
    lines.splice(
      lines.length - 3,
      0,
      "_No `agent-task-benchmark-compare` records found yet._",
      "",
    );
  }
  return lines.join("\n");
}

function renderTokenDeltaSvg(
  groups: readonly AgentTaskBenchmarkSeriesGroup[],
): string {
  return renderBarSvg({
    title: "Agent Task Series Total Token Delta",
    subtitle: "compact - full; lower is better",
    groups,
    metric: (group) => group.total_tokens_delta.average,
    valueLabel: (value) => `${Math.round(value)} tokens`,
    height: Math.max(220, 150 + groups.length * 48),
  });
}

function renderQualitySummarySvg(
  groups: readonly AgentTaskBenchmarkSeriesGroup[],
): string {
  return renderBarSvg({
    title: "Agent Task Series Compact Success Rate",
    subtitle: "same fixed task, compact mode",
    groups,
    metric: (group) => group.compact_task_success_rate,
    valueLabel: (value) => `${Math.round(value * 100)}%`,
    domain: { min: 0, max: 1 },
    positiveIsGood: true,
    height: Math.max(220, 150 + groups.length * 48),
  });
}

function renderSourceCitationDeltaSvg(
  groups: readonly AgentTaskBenchmarkSeriesGroup[],
): string {
  return renderBarSvg({
    title: "Agent Task Series Source Citation Delta",
    subtitle: "compact - full; higher is better",
    groups,
    metric: (group) => group.source_citation_rate_delta.average,
    valueLabel: (value) => `${Math.round(value * 100)} pts`,
    positiveIsGood: true,
    height: Math.max(220, 150 + groups.length * 48),
  });
}

function renderBarSvg(input: {
  title: string;
  subtitle: string;
  groups: readonly AgentTaskBenchmarkSeriesGroup[];
  metric: (group: AgentTaskBenchmarkSeriesGroup) => number | undefined;
  valueLabel: (value: number) => string;
  domain?: { min: number; max: number };
  positiveIsGood?: boolean;
  height: number;
}): string {
  const width = 920;
  const marginLeft = 300;
  const chartWidth = 500;
  const rows = input.groups.map((group) => ({
    group,
    value: input.metric(group),
  }));
  const numeric = rows
    .map((row) => row.value)
    .filter((value): value is number => value !== undefined);
  const min = input.domain?.min ?? Math.min(0, ...numeric);
  const max = input.domain?.max ?? Math.max(0, ...numeric);
  const span = max - min || 1;
  const zeroX = marginLeft + ((0 - min) / span) * chartWidth;
  const rowTop = 100;
  const rowHeight = 48;
  const bars = rows
    .map((row, index) => {
      const y = rowTop + index * rowHeight;
      const label = escapeXml(row.group.id);
      if (row.value === undefined) {
        return [
          `<text x="24" y="${y + 20}" class="label">${label}</text>`,
          `<text x="${marginLeft}" y="${y + 20}" class="muted">no data</text>`,
        ].join("\n");
      }
      const valueX = marginLeft + ((row.value - min) / span) * chartWidth;
      const x = Math.min(zeroX, valueX);
      const barWidth = Math.max(2, Math.abs(valueX - zeroX));
      const good = input.positiveIsGood === true ? row.value >= 0 : row.value <= 0;
      const fill = good ? "#168a5b" : "#c65f23";
      return [
        `<text x="24" y="${y + 20}" class="label">${label}</text>`,
        `<rect x="${roundSvg(x)}" y="${y}" width="${roundSvg(barWidth)}" height="24" rx="3" fill="${fill}" />`,
        `<text x="${roundSvg(Math.max(zeroX, valueX) + 8)}" y="${y + 18}" class="value">${escapeXml(input.valueLabel(row.value))}</text>`,
      ].join("\n");
    })
    .join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${input.height}" viewBox="0 0 ${width} ${input.height}" role="img" aria-label="${escapeXml(input.title)}">`,
    "<style>",
    "text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #1f2933; }",
    ".title { font-size: 22px; font-weight: 700; }",
    ".subtitle { font-size: 13px; fill: #52606d; }",
    ".label { font-size: 12px; }",
    ".value { font-size: 12px; font-weight: 600; }",
    ".muted { font-size: 12px; fill: #7b8794; }",
    ".axis { stroke: #9aa5b1; stroke-width: 1; }",
    "</style>",
    `<rect width="${width}" height="${input.height}" fill="#ffffff" />`,
    `<text x="24" y="34" class="title">${escapeXml(input.title)}</text>`,
    `<text x="24" y="58" class="subtitle">${escapeXml(input.subtitle)}</text>`,
    `<line x1="${roundSvg(zeroX)}" x2="${roundSvg(zeroX)}" y1="84" y2="${input.height - 28}" class="axis" />`,
    bars || `<text x="24" y="120" class="muted">No comparable task pairs yet.</text>`,
    "</svg>",
  ].join("\n");
}

function seriesGroupId(record: CompareRecord): string {
  return [
    record.project,
    record.taskId,
    record.agent,
    record.model,
    record.contextState,
  ].join("/");
}

function sourceReadRate(metrics: Record<string, unknown> | undefined): number | undefined {
  if (!metrics) return undefined;
  const required = numberField(metrics, "required_source_reads");
  const expected = numberField(metrics, "expected_source_reads");
  if (required === undefined || expected === undefined || expected <= 0) {
    return undefined;
  }
  return roundNumber(required / expected);
}

function sourceCitationRate(
  metrics: Record<string, unknown> | undefined,
): number | undefined {
  if (!metrics) return undefined;
  const citations = numberField(metrics, "source_citations");
  const expected = numberField(metrics, "expected_source_citations");
  if (citations === undefined || expected === undefined || expected <= 0) {
    return undefined;
  }
  return roundNumber(citations / expected);
}

function metricSummary(
  values: readonly (number | undefined)[],
): AgentTaskBenchmarkSeriesMetric {
  const numeric = values.filter((value): value is number => value !== undefined);
  if (numeric.length === 0) {
    return { count: 0 };
  }
  const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const variance =
    numeric.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    numeric.length;
  return {
    count: numeric.length,
    average: roundNumber(average),
    min: roundNumber(Math.min(...numeric)),
    max: roundNumber(Math.max(...numeric)),
    stddev: roundNumber(Math.sqrt(variance)),
  };
}

function booleanRate(values: readonly (boolean | undefined)[]): number | undefined {
  const known = values.filter((value): value is boolean => value !== undefined);
  if (known.length === 0) return undefined;
  return roundNumber(known.filter(Boolean).length / known.length);
}

function sumNumbers(values: readonly (number | undefined)[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value ?? 0;
  }
  return sum;
}

function formatMetricSpread(metric: AgentTaskBenchmarkSeriesMetric): string {
  if (metric.average === undefined) return "-";
  return [
    formatNumber(metric.average),
    formatNumber(metric.stddev),
    formatNumber(metric.min),
    formatNumber(metric.max),
  ].join(" / ");
}

function formatRate(value: number | undefined): string {
  return value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function objectField(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const field = value?.[key];
  if (!field || typeof field !== "object" || Array.isArray(field)) return undefined;
  return field as Record<string, unknown>;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() !== "" ? field : undefined;
}

function numberField(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function booleanField(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const field = value?.[key];
  return typeof field === "boolean" ? field : undefined;
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundSvg(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}
