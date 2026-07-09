import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  subagentInjectionBenchmark,
  SubagentInjectionBenchmarkError,
} from "./benchmark_subagent_injection.js";
import {
  EVIDENCE_LOG_PATH,
  readEvidenceRecords,
} from "../core/evidence.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

describe("subagent injection benchmark", () => {
  it("records raw injection counts and writes graph artifacts", () => {
    const project = tmpDir("anamnesis-subagent-injection-");
    write(project, "AGENTS.md", "# Agent rules\nRead ontology first.\n");
    write(
      project,
      ".anamnesis/ontology/base.yaml",
      "managed_by: anamnesis\nrule: always read source pointers\n",
    );
    write(
      project,
      ".anamnesis/handoff/active.md",
      [
        "---",
        "updated: 2026-07-09T00:00:00.000Z",
        "---",
        "# Active handoff index",
        "",
        "## Current focus",
        "- subagent benchmark — archive: `.anamnesis/handoff/warm.md`",
        "",
        "## Active tasks",
        "- [in-flight] implement benchmark — next: test — archive: `.anamnesis/handoff/warm.md`",
      ].join("\n"),
    );
    write(
      project,
      ".anamnesis/handoff/warm.md",
      "# Handoff\n\n## Goal\nKeep context available.\n",
    );
    write(
      project,
      ".codex/skills/load-context/SKILL.md",
      "# load-context\n\nRead ontology files.\n",
    );

    const result = subagentInjectionBenchmark({
      projectRoot: project,
      attempts: 3,
      write: true,
      append: true,
      now: () => new Date("2026-07-09T04:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      attempts: 6,
      injectionEligibleAttempts: 3,
      injected: 3,
      missed: 0,
      injectionRatePct: 100,
      contractAttempts: 3,
      contractAccepted: 3,
      contractRejected: 0,
      contractPassRatePct: 100,
    });
    expect(result.lanes.map((lane) => lane.laneId)).toEqual([
      "separate-process-startup",
      "same-session-prompt-contract",
    ]);
    expect(result.attempts[0]).toMatchObject({
      laneId: "separate-process-startup",
      status: "injected",
      evidenceSources: expect.arrayContaining([
        ".anamnesis/ontology/base.yaml",
        ".anamnesis/handoff/active.md",
      ]),
    });
    expect(result.attempts[1]).toMatchObject({
      laneId: "same-session-prompt-contract",
      status: "accepted",
      evidenceSources: expect.arrayContaining([
        "AGENTS.md",
        ".codex/skills/load-context/SKILL.md",
      ]),
    });

    for (const artifact of [
      result.artifacts.json,
      result.artifacts.markdown,
      result.artifacts.countsSvg,
      result.artifacts.ratesSvg,
    ]) {
      expect(artifact).toBeDefined();
      expect(fs.existsSync(path.join(project, artifact!))).toBe(true);
    }
    expect(
      fs.readFileSync(path.join(project, result.artifacts.markdown!), "utf8"),
    ).toContain("3/3 injected");
    expect(
      fs.readFileSync(path.join(project, result.artifacts.countsSvg!), "utf8"),
    ).toContain("Subagent Injection Counts");

    const evidence = readEvidenceRecords(project);
    expect(result.evidencePath).toBe(EVIDENCE_LOG_PATH);
    expect(evidence.total).toBe(1);
    expect(evidence.records[0]).toMatchObject({
      kind: "subagent-injection-benchmark",
      generated_at: "2026-07-09T04:00:00.000Z",
      command: ["anamnesis", "benchmark", "subagent-injection"],
      summary: {
        schema_version: "anamnesis.subagent_injection_benchmark.v1",
        attempts: 6,
        injected: 3,
        missed: 0,
        contract_accepted: 3,
        contract_rejected: 0,
      },
    });
  });

  it("misses startup injection when no startup-active sources exist", () => {
    const project = tmpDir("anamnesis-subagent-injection-empty-");
    write(project, "AGENTS.md", "# Agent rules\n");

    const result = subagentInjectionBenchmark({
      projectRoot: project,
      attempts: 2,
      now: () => new Date("2026-07-09T04:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.summary.injected).toBe(0);
    expect(result.summary.missed).toBe(2);
    expect(result.summary.contractAccepted).toBe(2);
  });

  it("rejects non-positive attempt counts", () => {
    const project = tmpDir("anamnesis-subagent-injection-invalid-");

    expect(() =>
      subagentInjectionBenchmark({
        projectRoot: project,
        attempts: 0,
      }),
    ).toThrow(SubagentInjectionBenchmarkError);
  });
});
