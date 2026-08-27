import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promptDeltaGate } from "./benchmark_prompt_gate.js";
import { retrievalBenchmark } from "./benchmark_retrieval.js";
import { init } from "./init.js";

const RETRIEVAL_BENCHMARK_TEST_TIMEOUT_MS = 60_000;

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("retrievalBenchmark", () => {
  it("measures source-pointer ranking and writes deterministic artifacts", () => {
    const project = tmpDir("anamnesis-retrieval-benchmark-");

    const result = retrievalBenchmark({
      projectRoot: project,
      write: true,
      append: true,
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(result.schema_version).toBe("anamnesis.retrieval_benchmark.v2");
    expect(result.summary).toMatchObject({
      cases: 18,
      unfilteredCases: 18,
      top1HitRate: 1,
      top3HitRate: 1,
      mrr: 1,
      compactSessionStartCapExceeded: false,
      safetyChecks: 2,
      safetyPasses: 2,
      staleHandoffTop3Leakage: 0,
      missingOntologyRefTop3Leakage: 0,
      behavioralValidation: "not-measured",
      ok: true,
    });
    expect(result.cases).toHaveLength(18);
    expect(new Set(result.cases.map((item) => item.stratum))).toEqual(
      new Set([
        "agent-rules",
        "diagnostics",
        "documents",
        "handoff",
        "ontology",
        "task-harness",
      ]),
    );
    expect(result.cases.every((item) => item.top1Hit)).toBe(true);
    expect(result.safetyChecks.every((item) => item.passed)).toBe(true);
    expect(result.provenance.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.provenance.fixtureHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.provenance.rankerHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.provenance.rankerInputs).toEqual([
      "src/commands/context_index.ts",
      "src/commands/context_docs.ts",
      "src/core/handoff_active_text.ts",
    ]);
    expect(result.artifacts.json).toBe(
      "docs/benchmark-evidence/retrieval-source-pointers/retrieval-source-pointers.json",
    );
    expect(
      fs.existsSync(path.join(project, result.artifacts.json!)),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(project, result.artifacts.markdown!), "utf8"),
    ).toContain("Top-1 hit rate: 100%");
    expect(
      fs.readFileSync(path.join(project, result.artifacts.hitRatesSvg!), "utf8"),
    ).toContain("Retrieval Hit Rates");
    expect(
      fs.readFileSync(path.join(project, result.artifacts.strataSvg!), "utf8"),
    ).toContain("Top-3 Retrieval By Context Stratum");
    expect(
      fs.readFileSync(
        path.join(project, ".anamnesis/evidence/events.jsonl"),
        "utf8",
      ),
    ).toContain('"kind":"retrieval-benchmark"');
  }, RETRIEVAL_BENCHMARK_TEST_TIMEOUT_MS);

  it("feeds deterministic retrieval evidence into prompt-gate", () => {
    const project = tmpDir("anamnesis-retrieval-prompt-gate-");
    const library = process.cwd();
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: true,
      noBootstrap: true,
      projectName: "retrieval-prompt-gate",
      tools: ["claude-code", "codex", "cursor"],
    });
    retrievalBenchmark({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-07-10T00:05:00.000Z"),
    });

    const gate = promptDeltaGate({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-07-10T00:06:00.000Z"),
    });

    expect(gate.evidence).toMatchObject({
      retrievalBenchmarks: 1,
      compactRetrievalBenchmarks: 1,
      retrievalSourcePointerBenchmarks: 1,
      retrievalSourcePointerFailures: 0,
      retrievalFriction: 0,
      retrievalFailures: 0,
      retrievalTop1HitRate: 1,
      retrievalTop3HitRate: 1,
      retrievalMrr: 1,
    });
    expect(
      gate.signals.find((signal) => signal.id === "source-pointer-retrieval"),
    ).toMatchObject({ status: "pass" });
    expect(gate.evidencePath).toContain(
      "docs/benchmark-evidence/retrieval-source-pointers/retrieval-source-pointers.json",
    );
    expect(gate.markdown).toContain("- retrieval top-1/top-3/MRR: 100% / 100% / 1.000");
    expect(gate.markdown).toContain(
      "- source-pointer retrieval benchmarks: 1 (failures 0)",
    );
  }, RETRIEVAL_BENCHMARK_TEST_TIMEOUT_MS);
});
