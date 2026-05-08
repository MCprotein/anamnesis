import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  benchmarkTraceRollup,
  BENCHMARK_TRACE_LOG_PATH,
  BENCHMARK_TRACE_SUMMARY_PATH,
} from "./benchmark_trace.js";
import {
  EVIDENCE_LOG_PATH,
  readEvidenceRecords,
} from "../core/evidence.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTraceLog(project: string, lines: string[]): void {
  const logPath = path.join(project, BENCHMARK_TRACE_LOG_PATH);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
}

describe("benchmark trace rollup", () => {
  it("returns an empty rollup when no trace log exists", () => {
    const project = tmpDir("anamnesis-benchmark-trace-empty-");

    const result = benchmarkTraceRollup({
      projectRoot: project,
      now: () => new Date("2026-05-08T02:00:00.000Z"),
    });

    expect(result).toMatchObject({
      sourcePath: BENCHMARK_TRACE_LOG_PATH,
      total: 0,
      invalid: 0,
      ok: true,
      byPhase: [],
      byStatus: [],
      metrics: {},
    });
    expect(result.markdown).toContain("Records: 0 valid, 0 invalid");
  });

  it("rolls up benchmark traces and appends runtime evidence", () => {
    const project = tmpDir("anamnesis-benchmark-trace-");
    writeTraceLog(project, [
      JSON.stringify({
        schema_version: "anamnesis.benchmark_trace.v1",
        generated_at: "2026-05-08T00:00:00.000Z",
        run_id: "run-a",
        phase: "report",
        status: "ok",
        duration_ms: 120,
        metrics: { tool_turns: 3, context_files: 2 },
      }),
      JSON.stringify({
        schema_version: "anamnesis.benchmark_trace.v1",
        generated_at: "2026-05-08T00:01:00.000Z",
        run_id: "run-a",
        phase: "trace",
        status: "warn",
        duration_ms: 80,
        metrics: { tool_turns: 1 },
        detail: "missing enriched ontology",
      }),
      "{ invalid",
    ]);

    const result = benchmarkTraceRollup({
      projectRoot: project,
      append: true,
      now: () => new Date("2026-05-08T00:02:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.appendedPath).toBe(BENCHMARK_TRACE_SUMMARY_PATH);
    expect(result.evidencePath).toBe(EVIDENCE_LOG_PATH);
    expect(result.total).toBe(2);
    expect(result.invalid).toBe(1);
    expect(result.latest).toMatchObject({
      phase: "trace",
      status: "warn",
    });
    expect(result.metrics).toEqual({
      context_files: 2,
      tool_turns: 4,
    });
    expect(result.byPhase).toEqual([
      expect.objectContaining({
        phase: "report",
        total: 1,
        byStatus: { ok: 1 },
        duration_ms: expect.objectContaining({ total: 120, avg: 120 }),
      }),
      expect.objectContaining({
        phase: "trace",
        total: 1,
        byStatus: { warn: 1 },
        duration_ms: expect.objectContaining({ total: 80, avg: 80 }),
      }),
    ]);
    expect(
      fs.readFileSync(path.join(project, BENCHMARK_TRACE_SUMMARY_PATH), "utf8"),
    ).toContain("Benchmark Trace Rollup — 2026-05-08T00:02:00.000Z");

    const evidence = readEvidenceRecords(project);
    expect(evidence.total).toBe(1);
    expect(evidence.records[0]).toMatchObject({
      kind: "benchmark-trace-rollup",
      generated_at: "2026-05-08T00:02:00.000Z",
      command: ["anamnesis", "benchmark", "trace"],
      summary: {
        schema_version: "anamnesis.benchmark_trace_rollup.v1",
        records: 2,
        invalid_records: 1,
        by_status: {
          ok: 1,
          warn: 1,
        },
        metrics: {
          context_files: 2,
          tool_turns: 4,
        },
      },
      artifacts: {
        markdown: BENCHMARK_TRACE_SUMMARY_PATH,
        trace_log: BENCHMARK_TRACE_LOG_PATH,
      },
    });
  });
});
