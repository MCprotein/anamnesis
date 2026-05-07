import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendEvidenceRecord,
  EVIDENCE_LOG_PATH,
  EVIDENCE_SCHEMA_VERSION,
  readEvidenceSummary,
  type RuntimeEvidenceRecord,
} from "./evidence.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function record(
  kind: RuntimeEvidenceRecord["kind"],
  generatedAt: string,
): RuntimeEvidenceRecord {
  const command: Record<RuntimeEvidenceRecord["kind"], string[]> = {
    "dogfood-check": ["anamnesis", "dogfood", "check"],
    "doctor-check": ["anamnesis", "doctor"],
    "update-apply": ["anamnesis", "update", "--apply"],
    "benchmark-report": ["anamnesis", "benchmark", "report"],
    "benchmark-compare": ["anamnesis", "benchmark", "compare"],
    "agent-task-benchmark": ["anamnesis", "benchmark", "task"],
    "prompt-delta-gate": ["anamnesis", "benchmark", "prompt-gate"],
  };
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind,
    generated_at: generatedAt,
    command: command[kind],
    project: { name: "test-project" },
    summary: { ok: true },
  };
}

describe("runtime evidence", () => {
  it("returns an empty summary when no evidence log exists", () => {
    const project = tmpDir("anamnesis-evidence-empty-");

    expect(readEvidenceSummary(project)).toEqual({
      path: EVIDENCE_LOG_PATH,
      total: 0,
      invalid: 0,
      byKind: [],
    });
  });

  it("appends valid records and tolerates invalid lines", () => {
    const project = tmpDir("anamnesis-evidence-");

    expect(
      appendEvidenceRecord(
        project,
        record("dogfood-check", "2026-05-07T00:00:00.000Z"),
      ),
    ).toBe(EVIDENCE_LOG_PATH);
    fs.appendFileSync(
      path.join(project, EVIDENCE_LOG_PATH),
      "not json\n",
      "utf8",
    );
    appendEvidenceRecord(
      project,
      record("benchmark-report", "2026-05-07T01:00:00.000Z"),
    );

    const summary = readEvidenceSummary(project, {
      now: new Date("2026-05-14T01:00:01.000Z"),
    });

    expect(summary.total).toBe(2);
    expect(summary.invalid).toBe(1);
    expect(summary.latest).toMatchObject({
      kind: "benchmark-report",
      generated_at: "2026-05-07T01:00:00.000Z",
    });
    expect(summary.latest_age_ms).toBe(7 * 24 * 60 * 60 * 1000 + 1000);
    expect(summary.latest_stale).toBe(true);
    expect(summary.byKind.map((kind) => kind.kind)).toEqual([
      "benchmark-report",
      "dogfood-check",
    ]);
    expect(summary.byKind[0]).toMatchObject({
      kind: "benchmark-report",
      total: 1,
      stale: true,
    });
  });

  it("accepts update apply evidence records", () => {
    const project = tmpDir("anamnesis-evidence-update-");

    appendEvidenceRecord(
      project,
      record("update-apply", "2026-05-07T02:00:00.000Z"),
    );

    const summary = readEvidenceSummary(project, {
      now: new Date("2026-05-07T02:00:01.000Z"),
    });

    expect(summary.total).toBe(1);
    expect(summary.latest).toMatchObject({
      kind: "update-apply",
      command: ["anamnesis", "update", "--apply"],
    });
    expect(summary.byKind).toHaveLength(1);
    expect(summary.byKind[0]).toMatchObject({
      kind: "update-apply",
      total: 1,
      stale: false,
    });
  });
});
