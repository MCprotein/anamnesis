import * as fs from "node:fs";
import * as path from "node:path";

export const EVIDENCE_LOG_PATH = ".anamnesis/evidence/events.jsonl";
export const EVIDENCE_SCHEMA_VERSION = "anamnesis.evidence.v1";
export const EVIDENCE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type EvidenceKind =
  | "dogfood-check"
  | "doctor-check"
  | "hook-log-summary"
  | "init-install"
  | "update-apply"
  | "fragment-lifecycle"
  | "gc-apply"
  | "benchmark-report"
  | "benchmark-compare"
  | "benchmark-trace-rollup"
  | "agent-task-benchmark"
  | "agent-task-benchmark-compare"
  | "prompt-delta-gate";

export interface RuntimeEvidenceRecord {
  schema_version: typeof EVIDENCE_SCHEMA_VERSION;
  kind: EvidenceKind;
  generated_at: string;
  command: string[];
  project: {
    name: string;
  };
  summary: Record<string, unknown>;
  details?: Record<string, unknown>;
  artifacts?: Record<string, string>;
}

export interface RuntimeEvidenceSummary {
  path: string;
  total: number;
  invalid: number;
  latest?: RuntimeEvidenceRecord;
  latest_age_ms?: number;
  latest_stale?: boolean;
  byKind: RuntimeEvidenceKindSummary[];
}

export interface RuntimeEvidenceLog {
  path: string;
  total: number;
  invalid: number;
  records: RuntimeEvidenceRecord[];
}

export interface RuntimeEvidenceKindSummary {
  kind: EvidenceKind;
  total: number;
  latest: RuntimeEvidenceRecord;
  latest_age_ms: number;
  stale: boolean;
}

export interface RuntimeEvidenceSummaryOptions {
  now?: Date;
  staleAfterMs?: number;
}

export function appendEvidenceRecord(
  projectRoot: string,
  record: RuntimeEvidenceRecord,
): string {
  const abs = path.join(projectRoot, EVIDENCE_LOG_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${JSON.stringify(record)}\n`, "utf8");
  return EVIDENCE_LOG_PATH;
}

export function readEvidenceSummary(
  projectRoot: string,
  opts: RuntimeEvidenceSummaryOptions = {},
): RuntimeEvidenceSummary {
  const log = readEvidenceRecords(projectRoot);
  const now = opts.now ?? new Date();
  const staleAfterMs = opts.staleAfterMs ?? EVIDENCE_STALE_AFTER_MS;
  const latest = log.records.at(-1);
  const latestAgeMs = latest ? evidenceAgeMs(now, latest.generated_at) : undefined;
  return {
    path: log.path,
    total: log.total,
    invalid: log.invalid,
    latest,
    ...(latestAgeMs !== undefined
      ? {
          latest_age_ms: latestAgeMs,
          latest_stale: latestAgeMs > staleAfterMs,
        }
      : {}),
    byKind: evidenceKindSummary(log.records, now, staleAfterMs),
  };
}

export function readEvidenceRecords(projectRoot: string): RuntimeEvidenceLog {
  const abs = path.join(projectRoot, EVIDENCE_LOG_PATH);
  return readEvidenceFile(abs, EVIDENCE_LOG_PATH);
}

export function readEvidenceFile(
  filePath: string,
  displayPath?: string,
): RuntimeEvidenceLog {
  if (!fs.existsSync(filePath)) {
    return { path: displayPath ?? filePath, total: 0, invalid: 0, records: [] };
  }

  let total = 0;
  let invalid = 0;
  const records: RuntimeEvidenceRecord[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isEvidenceRecord(parsed)) {
        total++;
        records.push(parsed);
      } else {
        invalid++;
      }
    } catch {
      invalid++;
    }
  }
  return { path: displayPath ?? filePath, total, invalid, records };
}

function isEvidenceRecord(value: unknown): value is RuntimeEvidenceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<RuntimeEvidenceRecord>;
  return (
    record.schema_version === EVIDENCE_SCHEMA_VERSION &&
    (record.kind === "dogfood-check" ||
      record.kind === "doctor-check" ||
      record.kind === "hook-log-summary" ||
      record.kind === "init-install" ||
      record.kind === "update-apply" ||
      record.kind === "fragment-lifecycle" ||
      record.kind === "gc-apply" ||
      record.kind === "benchmark-report" ||
      record.kind === "benchmark-compare" ||
      record.kind === "benchmark-trace-rollup" ||
      record.kind === "agent-task-benchmark" ||
      record.kind === "agent-task-benchmark-compare" ||
      record.kind === "prompt-delta-gate") &&
    typeof record.generated_at === "string" &&
    Array.isArray(record.command) &&
    record.command.every((part) => typeof part === "string") &&
    !!record.project &&
    typeof record.project === "object" &&
    typeof record.project.name === "string" &&
    !!record.summary &&
    typeof record.summary === "object" &&
    !Array.isArray(record.summary)
  );
}

function evidenceKindSummary(
  records: readonly RuntimeEvidenceRecord[],
  now: Date,
  staleAfterMs: number,
): RuntimeEvidenceKindSummary[] {
  const byKind = new Map<EvidenceKind, RuntimeEvidenceRecord[]>();
  for (const record of records) {
    const list = byKind.get(record.kind) ?? [];
    list.push(record);
    byKind.set(record.kind, list);
  }
  return [...byKind.entries()]
    .map(([kind, kindRecords]) => {
      const latest = latestEvidenceRecord(kindRecords);
      const ageMs = evidenceAgeMs(now, latest.generated_at);
      return {
        kind,
        total: kindRecords.length,
        latest,
        latest_age_ms: ageMs,
        stale: ageMs > staleAfterMs,
      };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function latestEvidenceRecord(
  records: readonly RuntimeEvidenceRecord[],
): RuntimeEvidenceRecord {
  let latest = records[0]!;
  for (const record of records.slice(1)) {
    if (record.generated_at >= latest.generated_at) {
      latest = record;
    }
  }
  return latest;
}

function evidenceAgeMs(now: Date, generatedAt: string): number {
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(generated)) return 0;
  return Math.max(0, now.getTime() - generated);
}
