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

export const HOOK_LOG_PATH = ".anamnesis/logs/hooks.jsonl";
export const HOOK_SUMMARY_PATH = "docs/HOOKS.md";
const HOOK_LOG_SCHEMA_VERSION = "anamnesis.hook_log.v1";
const HOOK_LOG_SUMMARY_SCHEMA_VERSION = "anamnesis.hook_log_summary.v1";
const RECENT_RECORD_LIMIT = 20;

export interface HookLogRecord {
  schema_version?: typeof HOOK_LOG_SCHEMA_VERSION;
  generated_at: string;
  adapter?: string;
  event: string;
  matcher?: string;
  hook?: string;
  status: string;
  duration_ms?: number;
  message?: string;
}

export interface HookEventSummary {
  event: string;
  total: number;
  byStatus: Record<string, number>;
  latest?: HookLogRecord;
}

export interface HookStatusSummary {
  status: string;
  total: number;
}

export interface HookSummaryResult {
  projectRoot: string;
  projectName: string;
  generatedAt: string;
  sourcePath: string;
  total: number;
  invalid: number;
  latest?: HookLogRecord;
  byEvent: HookEventSummary[];
  byStatus: HookStatusSummary[];
  recent: HookLogRecord[];
  ok: boolean;
  markdown?: string;
  appendedPath?: string;
  evidencePath?: string;
}

export interface HookSummaryOptions {
  projectRoot: string;
  sourcePath?: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class HookSummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookSummaryError";
  }
}

interface HookLogReadResult {
  path: string;
  total: number;
  invalid: number;
  records: HookLogRecord[];
}

export function hookSummary(opts: HookSummaryOptions): HookSummaryResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const sourcePath = opts.sourcePath ?? HOOK_LOG_PATH;
  const log = readHookLog(projectRoot, sourcePath);
  const projectName = readProjectName(projectRoot);
  const latest = latestHookRecord(log.records);
  const result: HookSummaryResult = {
    projectRoot,
    projectName,
    generatedAt,
    sourcePath: log.path,
    total: log.total,
    invalid: log.invalid,
    ...(latest ? { latest } : {}),
    byEvent: hookEventSummaries(log.records),
    byStatus: hookStatusSummaries(log.records),
    recent: log.records.slice(-RECENT_RECORD_LIMIT),
    ok: log.invalid === 0,
  };

  if (opts.append) {
    const outputPath = opts.outputPath ?? HOOK_SUMMARY_PATH;
    const appendedPath = appendHookSummaryMarkdown(
      projectRoot,
      outputPath,
      result,
    );
    const evidencePath = appendEvidenceRecord(
      projectRoot,
      hookSummaryEvidenceRecord({
        result,
        appendedPath,
      }),
    );
    return {
      ...result,
      markdown: renderHookSummaryMarkdown(result),
      appendedPath,
      evidencePath,
    };
  }

  return {
    ...result,
    markdown: renderHookSummaryMarkdown(result),
  };
}

export function readHookLog(
  projectRoot: string,
  sourcePath = HOOK_LOG_PATH,
): HookLogReadResult {
  const abs = path.isAbsolute(sourcePath)
    ? sourcePath
    : path.join(projectRoot, sourcePath);
  const displayPath = path.isAbsolute(sourcePath)
    ? sourcePath
    : sourcePath;
  if (!fs.existsSync(abs)) {
    return { path: displayPath, total: 0, invalid: 0, records: [] };
  }

  let total = 0;
  let invalid = 0;
  const records: HookLogRecord[] = [];
  for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isHookLogRecord(parsed)) {
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

function isHookLogRecord(value: unknown): value is HookLogRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<HookLogRecord>;
  return (
    (record.schema_version === undefined ||
      record.schema_version === HOOK_LOG_SCHEMA_VERSION) &&
    typeof record.generated_at === "string" &&
    typeof record.event === "string" &&
    typeof record.status === "string" &&
    (record.adapter === undefined || typeof record.adapter === "string") &&
    (record.matcher === undefined || typeof record.matcher === "string") &&
    (record.hook === undefined || typeof record.hook === "string") &&
    (record.duration_ms === undefined ||
      (typeof record.duration_ms === "number" &&
        Number.isFinite(record.duration_ms))) &&
    (record.message === undefined || typeof record.message === "string")
  );
}

function latestHookRecord(
  records: readonly HookLogRecord[],
): HookLogRecord | undefined {
  let latest = records[0];
  for (const record of records.slice(1)) {
    if (!latest || record.generated_at >= latest.generated_at) {
      latest = record;
    }
  }
  return latest;
}

function hookEventSummaries(
  records: readonly HookLogRecord[],
): HookEventSummary[] {
  const byEvent = new Map<string, HookLogRecord[]>();
  for (const record of records) {
    const list = byEvent.get(record.event) ?? [];
    list.push(record);
    byEvent.set(record.event, list);
  }
  return [...byEvent.entries()]
    .map(([event, eventRecords]) => ({
      event,
      total: eventRecords.length,
      byStatus: countBy(eventRecords.map((record) => record.status)),
      latest: latestHookRecord(eventRecords),
    }))
    .sort((a, b) => a.event.localeCompare(b.event));
}

function hookStatusSummaries(
  records: readonly HookLogRecord[],
): HookStatusSummary[] {
  return Object.entries(countBy(records.map((record) => record.status)))
    .map(([status, total]) => ({ status, total }))
    .sort((a, b) => a.status.localeCompare(b.status));
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function appendHookSummaryMarkdown(
  projectRoot: string,
  outputPath: string,
  result: HookSummaryResult,
): string {
  const abs = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(projectRoot, outputPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${renderHookSummaryMarkdown(result)}\n\n`, "utf8");
  return projectRelativePath(projectRoot, abs);
}

function renderHookSummaryMarkdown(result: HookSummaryResult): string {
  const eventRows =
    result.byEvent.length === 0
      ? ["| (none) | 0 | | |"]
      : result.byEvent.map((event) =>
          [
            `| ${escapeCell(event.event)}`,
            String(event.total),
            escapeCell(statusCountsLabel(event.byStatus)),
            event.latest?.generated_at ?? "",
          ].join(" | ") + " |",
        );
  const recentRows =
    result.recent.length === 0
      ? ["| (none) | | | | |"]
      : result.recent.map((record) =>
          [
            `| ${escapeCell(record.generated_at)}`,
            escapeCell(record.adapter ?? ""),
            escapeCell(record.event),
            escapeCell(record.status),
            escapeCell(record.hook ?? record.message ?? ""),
          ].join(" | ") + " |",
        );
  return [
    `## Hook Summary — ${result.generatedAt}`,
    "",
    `Project: ${result.projectName}`,
    `Source: \`${result.sourcePath}\``,
    `Records: ${result.total} valid, ${result.invalid} invalid`,
    result.latest
      ? `Latest: ${result.latest.event} ${result.latest.status} at ${result.latest.generated_at}`
      : "Latest: none",
    "",
    "| Event | Total | Status counts | Latest |",
    "|---|---:|---|---|",
    ...eventRows,
    "",
    "| Generated at | Adapter | Event | Status | Hook/message |",
    "|---|---|---|---|---|",
    ...recentRows,
  ].join("\n");
}

function statusCountsLabel(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, total]) => `${status}=${total}`)
    .join(", ");
}

function hookSummaryEvidenceRecord(input: {
  result: HookSummaryResult;
  appendedPath: string;
}): RuntimeEvidenceRecord {
  const { result } = input;
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "hook-log-summary",
    generated_at: result.generatedAt,
    command: ["anamnesis", "hooks", "summary"],
    project: { name: result.projectName },
    summary: {
      schema_version: HOOK_LOG_SUMMARY_SCHEMA_VERSION,
      records: result.total,
      invalid_records: result.invalid,
      latest: result.latest
        ? {
            generated_at: result.latest.generated_at,
            event: result.latest.event,
            status: result.latest.status,
          }
        : null,
      by_event: result.byEvent.map((event) => ({
        event: event.event,
        total: event.total,
        by_status: event.byStatus,
        latest_generated_at: event.latest?.generated_at,
      })),
      by_status: Object.fromEntries(
        result.byStatus.map((status) => [status.status, status.total]),
      ),
    },
    details: {
      recent: result.recent,
    },
    artifacts: {
      markdown: input.appendedPath,
      hook_log: result.sourcePath,
    },
  };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
