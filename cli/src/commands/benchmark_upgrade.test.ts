import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  upgradeBenchmark,
  UpgradeBenchmarkError,
} from "./benchmark_upgrade.js";
import {
  EVIDENCE_LOG_PATH,
  readEvidenceRecords,
} from "../core/evidence.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("upgrade benchmark", () => {
  it("runs sanitized upgrade fixtures and writes numeric graph artifacts", () => {
    const project = tmpDir("anamnesis-upgrade-benchmark-test-");

    const result = upgradeBenchmark({
      projectRoot: project,
      runs: 1,
      write: true,
      append: true,
      now: () => new Date("2026-07-07T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      fixtures: 5,
      runs: 5,
      passed: 5,
      failed: 0,
      passRatePct: 100,
      postPendingTotal: 0,
      doctorErrorsTotal: 0,
      driftTotal: 0,
    });
    expect(result.fixtures.map((fixture) => fixture.fixtureId)).toEqual([
      "clean-old-no-settings",
      "pinned-archive",
      "partial-adapter",
      "stale-codex-hook",
      "declined-suggestion",
    ]);
    expect(result.runs.every((run) => run.status === "pass")).toBe(true);
    for (const artifact of [
      result.artifacts.json,
      result.artifacts.markdown,
      result.artifacts.passRateSvg,
      result.artifacts.durationSvg,
    ]) {
      expect(artifact).toBeDefined();
      expect(fs.existsSync(path.join(project, artifact!))).toBe(true);
    }
    expect(
      fs.readFileSync(path.join(project, result.artifacts.markdown!), "utf8"),
    ).toContain("Upgrade Benchmark Evidence");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(project, result.artifacts.json!), "utf8"),
      ),
    ).toMatchObject({
      projectRoot: ".",
    });
    expect(
      fs.readFileSync(path.join(project, result.artifacts.passRateSvg!), "utf8"),
    ).toContain("Upgrade benchmark pass rate");

    const evidence = readEvidenceRecords(project);
    expect(result.evidencePath).toBe(EVIDENCE_LOG_PATH);
    expect(evidence.total).toBe(1);
    expect(evidence.records[0]).toMatchObject({
      kind: "upgrade-benchmark",
      generated_at: "2026-07-07T00:00:00.000Z",
      command: ["anamnesis", "benchmark", "upgrade"],
      summary: {
        schema_version: "anamnesis.upgrade_benchmark.v1",
        fixtures: 5,
        runs: 5,
        failed: 0,
        pass_rate_pct: 100,
      },
    });
  });

  it("rejects non-positive run counts", () => {
    const project = tmpDir("anamnesis-upgrade-benchmark-invalid-");

    expect(() =>
      upgradeBenchmark({
        projectRoot: project,
        runs: 0,
      }),
    ).toThrow(UpgradeBenchmarkError);
  });
});
