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
  const command =
    kind === "dogfood-check"
      ? ["anamnesis", "dogfood", "check"]
      : ["anamnesis", "benchmark", "report"];
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind,
    generated_at: generatedAt,
    command,
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

    const summary = readEvidenceSummary(project);

    expect(summary.total).toBe(2);
    expect(summary.invalid).toBe(1);
    expect(summary.latest).toMatchObject({
      kind: "benchmark-report",
      generated_at: "2026-05-07T01:00:00.000Z",
    });
  });
});
