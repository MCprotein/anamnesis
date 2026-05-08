import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  hookSummary,
  HOOK_LOG_PATH,
  HOOK_SUMMARY_PATH,
} from "./hooks.js";
import {
  EVIDENCE_LOG_PATH,
  readEvidenceRecords,
} from "../core/evidence.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeHookLog(project: string, lines: string[]): void {
  const logPath = path.join(project, HOOK_LOG_PATH);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
}

describe("hooks summary", () => {
  it("returns an empty summary when no hook log exists", () => {
    const project = tmpDir("anamnesis-hooks-empty-");

    const result = hookSummary({
      projectRoot: project,
      now: () => new Date("2026-05-08T01:00:00.000Z"),
    });

    expect(result).toMatchObject({
      sourcePath: HOOK_LOG_PATH,
      total: 0,
      invalid: 0,
      ok: true,
      byEvent: [],
      byStatus: [],
    });
    expect(result.markdown).toContain("Records: 0 valid, 0 invalid");
  });

  it("summarizes hook logs and appends runtime evidence", () => {
    const project = tmpDir("anamnesis-hooks-");
    writeHookLog(project, [
      JSON.stringify({
        schema_version: "anamnesis.hook_log.v1",
        generated_at: "2026-05-08T00:00:00.000Z",
        adapter: "codex",
        event: "SessionStart",
        hook: ".anamnesis/codex-native-hooks/session-start.mjs",
        status: "ok",
        duration_ms: 12,
      }),
      JSON.stringify({
        schema_version: "anamnesis.hook_log.v1",
        generated_at: "2026-05-08T00:01:00.000Z",
        adapter: "codex",
        event: "PostToolUse",
        matcher: "Edit",
        status: "warn",
        message: "dirty tree reminder",
      }),
      "{ invalid",
    ]);

    const result = hookSummary({
      projectRoot: project,
      append: true,
      now: () => new Date("2026-05-08T00:02:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.appendedPath).toBe(HOOK_SUMMARY_PATH);
    expect(result.evidencePath).toBe(EVIDENCE_LOG_PATH);
    expect(result.total).toBe(2);
    expect(result.invalid).toBe(1);
    expect(result.latest).toMatchObject({
      event: "PostToolUse",
      status: "warn",
    });
    expect(result.byEvent).toEqual([
      expect.objectContaining({
        event: "PostToolUse",
        total: 1,
        byStatus: { warn: 1 },
      }),
      expect.objectContaining({
        event: "SessionStart",
        total: 1,
        byStatus: { ok: 1 },
      }),
    ]);
    expect(fs.readFileSync(path.join(project, HOOK_SUMMARY_PATH), "utf8"))
      .toContain("Hook Summary — 2026-05-08T00:02:00.000Z");

    const evidence = readEvidenceRecords(project);
    expect(evidence.total).toBe(1);
    expect(evidence.records[0]).toMatchObject({
      kind: "hook-log-summary",
      generated_at: "2026-05-08T00:02:00.000Z",
      command: ["anamnesis", "hooks", "summary"],
      summary: {
        schema_version: "anamnesis.hook_log_summary.v1",
        records: 2,
        invalid_records: 1,
        by_status: {
          ok: 1,
          warn: 1,
        },
      },
      artifacts: {
        markdown: HOOK_SUMMARY_PATH,
        hook_log: HOOK_LOG_PATH,
      },
    });
  });
});
