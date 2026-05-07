import * as fs from "node:fs";
import * as path from "node:path";

export const EVIDENCE_LOG_PATH = ".anamnesis/evidence/events.jsonl";
export const EVIDENCE_SCHEMA_VERSION = "anamnesis.evidence.v1";

export type EvidenceKind = "dogfood-check" | "benchmark-report";

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
  const abs = path.join(projectRoot, EVIDENCE_LOG_PATH);
  if (!fs.existsSync(abs)) {
    return { path: EVIDENCE_LOG_PATH, total: 0, invalid: 0 };
  }

  let total = 0;
  let invalid = 0;
  let latest: RuntimeEvidenceRecord | undefined;
  for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isEvidenceRecord(parsed)) {
        total++;
        latest = parsed;
      } else {
        invalid++;
      }
    } catch {
      invalid++;
    }
  }
  return { path: EVIDENCE_LOG_PATH, total, invalid, latest };
}

function isEvidenceRecord(value: unknown): value is RuntimeEvidenceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<RuntimeEvidenceRecord>;
  return (
    record.schema_version === EVIDENCE_SCHEMA_VERSION &&
    (record.kind === "dogfood-check" || record.kind === "benchmark-report") &&
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
