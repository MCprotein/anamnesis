import * as fs from "node:fs";
import * as path from "node:path";

export const EVIDENCE_LOG_PATH = ".anamnesis/evidence/events.jsonl";
export const EVIDENCE_SCHEMA_VERSION = "anamnesis.evidence.v1";

export type EvidenceKind =
  | "dogfood-check"
  | "doctor-check"
  | "benchmark-report"
  | "benchmark-compare"
  | "agent-task-benchmark"
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
}

export interface RuntimeEvidenceLog {
  path: string;
  total: number;
  invalid: number;
  records: RuntimeEvidenceRecord[];
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

export function readEvidenceSummary(projectRoot: string): RuntimeEvidenceSummary {
  const log = readEvidenceRecords(projectRoot);
  return {
    path: log.path,
    total: log.total,
    invalid: log.invalid,
    latest: log.records.at(-1),
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
      record.kind === "benchmark-report" ||
      record.kind === "benchmark-compare" ||
      record.kind === "agent-task-benchmark" ||
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
