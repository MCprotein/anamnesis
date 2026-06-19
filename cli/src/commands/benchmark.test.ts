import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { benchmarkCompare, benchmarkReport } from "./benchmark.js";
import { benchmarkGallery } from "./benchmark_gallery.js";
import {
  agentTaskBenchmark,
  agentTaskBenchmarkTemplate,
} from "./benchmark_task.js";
import { promptDeltaGate } from "./benchmark_prompt_gate.js";
import { sessionContextBenchmark } from "./benchmark_session_context.js";
import { init } from "./init.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupBenchmarkProject(): { project: string; library: string } {
  const library = process.cwd();
  const project = tmpDir("anamnesis-benchmark-");
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: true,
    noBootstrap: true,
    projectName: "anamnesis-project",
    tools: ["claude-code", "codex", "cursor"],
  });

  const ontologyDir = path.join(project, ".anamnesis", "ontology");
  fs.writeFileSync(
    path.join(ontologyDir, "base.bootstrap.yaml"),
    'schema_version: "anamnesis.bootstrap.v1"\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(ontologyDir, "base.enriched.yaml"),
    'schema_version: "anamnesis.enriched.v1"\n',
    "utf8",
  );

  return { project, library };
}

describe("benchmarkReport", () => {
  it("reports context layers and adapter readiness", () => {
    const { project, library } = setupBenchmarkProject();

    const result = benchmarkReport({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-05-03T12:00:00.000Z"),
    });

    expect(result.summary.ready).toBe(5);
    expect(result.scorecard).toMatchObject({
      schema_version: "anamnesis.benchmark.scorecard.v1",
      ready_layers: { ready: 5, total: 5 },
      continuity: {
        ready: true,
        passed: result.status.continuity.passed,
        total: result.status.continuity.total,
      },
      diagnostics: {
        doctor_errors: 0,
        codex_hook_warnings: 0,
      },
      adapter_surfaces: {
        ready: true,
        score: 1,
        total: 1,
      },
    });
    expect(result.layers.map((layer) => layer.id)).toEqual([
      "static-ontology",
      "bootstrap-ontology",
      "enriched-ontology",
      "continuity",
      "adapter-surfaces",
    ]);
    expect(result.ontologyFiles.static).toContain(
      ".anamnesis/ontology/base.yaml",
    );
    expect(result.ontologyFiles.bootstrap).toContain(
      ".anamnesis/ontology/base.bootstrap.yaml",
    );
    expect(result.ontologyFiles.enriched).toContain(
      ".anamnesis/ontology/base.enriched.yaml",
    );
    expect(result.markdown).toContain(
      "Benchmark Report — 2026-05-03T12:00:00.000Z",
    );
    expect(result.markdown).toContain("| Static ontology | ready |");
    expect(result.markdown).toContain(
      `| Context continuity | ready | ${result.status.continuity.passed}/${result.status.continuity.total} |`,
    );
    expect(result.markdown).toContain("Scorecard:");
    expect(result.markdown).toContain("| Doctor errors | 0 |");
    expect(result.markdown).toContain("| Codex hook warnings | 0 |");
  });

  it("appends markdown to docs/BENCHMARKS.md by default", () => {
    const { project, library } = setupBenchmarkProject();

    const result = benchmarkReport({
      projectRoot: project,
      libraryRoot: library,
      append: true,
      now: () => new Date("2026-05-03T13:00:00.000Z"),
    });

    expect(result.appendedPath).toBe("docs/BENCHMARKS.md");
    expect(result.evidencePath).toBe(".anamnesis/evidence/events.jsonl");
    const text = fs.readFileSync(
      path.join(project, "docs", "BENCHMARKS.md"),
      "utf8",
    );
    expect(text).toContain("Benchmark Report — 2026-05-03T13:00:00.000Z");
    expect(text).toContain("Ready layers: 5/5");

    const evidenceLines = fs
      .readFileSync(
        path.join(project, ".anamnesis", "evidence", "events.jsonl"),
        "utf8",
      )
      .trim()
      .split(/\r?\n/);
    expect(evidenceLines).toHaveLength(3);
    expect(JSON.parse(evidenceLines[0]!) as { kind: string }).toMatchObject({
      kind: "init-install",
    });
    expect(JSON.parse(evidenceLines[1]!) as { kind: string }).toMatchObject({
      kind: "fragment-lifecycle",
    });
    const evidence = JSON.parse(evidenceLines.at(-1)!) as {
      schema_version: string;
      kind: string;
      generated_at: string;
      summary: {
        ready?: number;
        total?: number;
        scorecard?: {
          schema_version?: string;
          evidence?: { records?: number; invalid_records?: number };
        };
      };
      artifacts: Record<string, string>;
    };
    expect(evidence).toMatchObject({
      schema_version: "anamnesis.evidence.v1",
      kind: "benchmark-report",
      generated_at: "2026-05-03T13:00:00.000Z",
      summary: {
        ready: 5,
        total: 5,
      },
      artifacts: {
        markdown: "docs/BENCHMARKS.md",
      },
    });
    expect(evidence.summary.scorecard).toMatchObject({
      schema_version: "anamnesis.benchmark.scorecard.v1",
      evidence: {
        records: 3,
        invalid_records: 0,
      },
    });
  });

  it("reports an absolute append path when output is outside the project", () => {
    const { project, library } = setupBenchmarkProject();
    const outputDir = tmpDir("anamnesis-benchmark-output-");
    const outputPath = path.join(outputDir, "BENCHMARKS.md");

    const result = benchmarkReport({
      projectRoot: project,
      libraryRoot: library,
      append: true,
      outputPath,
      now: () => new Date("2026-05-03T13:30:00.000Z"),
    });

    expect(result.appendedPath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("compares two benchmark scorecards and appends evidence", () => {
    const { project, library } = setupBenchmarkProject();
    const after = benchmarkReport({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-05-03T14:00:00.000Z"),
    });
    const baseline = JSON.parse(JSON.stringify(after)) as typeof after;
    baseline.generatedAt = "2026-05-03T13:00:00.000Z";
    baseline.scorecard.ready_layers.ready = 1;
    baseline.scorecard.continuity.passed = 4;
    baseline.scorecard.ontology_gaps.warnings = 2;
    baseline.scorecard.ontology_gaps.enrichment_missing = 2;
    baseline.scorecard.diagnostics.doctor_errors = 1;
    baseline.scorecard.diagnostics.doctor_warnings = 3;
    baseline.scorecard.diagnostics.codex_hook_warnings = 1;
    baseline.scorecard.adapter_surfaces.score = 0;
    baseline.scorecard.adapter_surfaces.ready = false;
    baseline.scorecard.evidence.records = 0;

    const baselinePath = path.join(project, "baseline.json");
    const afterPath = path.join(project, "after.json");
    fs.writeFileSync(baselinePath, JSON.stringify(baseline), "utf8");
    fs.writeFileSync(afterPath, JSON.stringify(after), "utf8");

    const result = benchmarkCompare({
      projectRoot: project,
      baselinePath,
      afterPath,
      append: true,
      now: () => new Date("2026-05-03T15:00:00.000Z"),
    });

    expect(result.summary).toEqual({
      improved: 9,
      regressed: 0,
      unchanged: 0,
    });
    expect(result.markdown).toContain("Benchmark Compare");
    expect(result.markdown).toContain("| Ready layers | 1/5 | 5/5 | +4 | improved |");
    expect(result.markdown).toContain("| Doctor errors | 1 | 0 | -1 | improved |");
    expect(result.appendedPath).toBe("docs/BENCHMARKS.md");
    expect(result.evidencePath).toBe(".anamnesis/evidence/events.jsonl");

    const evidenceLines = fs
      .readFileSync(
        path.join(project, ".anamnesis", "evidence", "events.jsonl"),
        "utf8",
      )
      .trim()
      .split(/\r?\n/);
    expect(evidenceLines).toHaveLength(3);
    expect(JSON.parse(evidenceLines[0]!) as { kind: string }).toMatchObject({
      kind: "init-install",
    });
    expect(JSON.parse(evidenceLines[1]!) as { kind: string }).toMatchObject({
      kind: "fragment-lifecycle",
    });
    const evidence = JSON.parse(evidenceLines.at(-1)!) as {
      kind: string;
      summary: {
        improved?: number;
        regressed?: number;
        unchanged?: number;
      };
    };
    expect(evidence).toMatchObject({
      kind: "benchmark-compare",
      summary: {
        improved: 9,
        regressed: 0,
        unchanged: 0,
      },
    });
  });

  it("generates and validates a benchmark gallery from runtime evidence", () => {
    const { project, library } = setupBenchmarkProject();
    const after = benchmarkReport({
      projectRoot: project,
      libraryRoot: library,
      append: true,
      now: () => new Date("2026-05-03T16:00:00.000Z"),
    });
    const baseline = JSON.parse(JSON.stringify(after)) as typeof after;
    baseline.generatedAt = "2026-05-03T15:00:00.000Z";
    baseline.scorecard.ready_layers.ready = 1;
    baseline.scorecard.continuity.passed = 4;
    baseline.scorecard.ontology_gaps.warnings = 2;
    baseline.scorecard.diagnostics.doctor_errors = 1;

    const baselinePath = path.join(project, "baseline.json");
    const afterPath = path.join(project, "after.json");
    fs.writeFileSync(baselinePath, JSON.stringify(baseline), "utf8");
    fs.writeFileSync(afterPath, JSON.stringify(after), "utf8");
    benchmarkCompare({
      projectRoot: project,
      baselinePath,
      afterPath,
      append: true,
      now: () => new Date("2026-05-03T17:00:00.000Z"),
    });

    const result = benchmarkGallery({
      projectRoot: project,
      write: true,
    });

    expect(result.writtenPath).toBe("docs/BENCHMARK-GALLERY.md");
    expect(result.evidenceRecords).toBe(4);
    expect(result.invalidEvidenceLines).toBe(0);
    expect(result.entries.map((entry) => entry.kind).sort()).toEqual([
      "benchmark-compare",
      "benchmark-report",
    ]);
    expect(result.claimCandidates.map((candidate) => candidate.id).sort()).toEqual([
      "benchmark-compare-anamnesis-project",
      "benchmark-report-anamnesis-project",
    ]);
    expect(result.markdown).toContain("README Claim Candidates");
    expect(result.markdown).toContain(
      "anamnesis-project before/after benchmark improved",
    );
    expect(result.warnings).toContain(
      "Only 1 public-safe project shape(s) represented; do not claim ecosystem coverage.",
    );

    const galleryPath = path.join(project, "docs", "BENCHMARK-GALLERY.md");
    expect(fs.readFileSync(galleryPath, "utf8")).toContain(
      "Source: `.anamnesis/evidence/events.jsonl` (4 valid, 0 invalid)",
    );

    const valid = benchmarkGallery({
      projectRoot: project,
      validate: true,
    });
    expect(valid.validation).toMatchObject({
      checkedPath: "docs/BENCHMARK-GALLERY.md",
      exists: true,
      stale: false,
      ok: true,
    });
    expect(valid.ok).toBe(true);

    fs.writeFileSync(
      galleryPath,
      fs.readFileSync(galleryPath, "utf8").replace(
        "Source: `.anamnesis/evidence/events.jsonl`",
        "Source: `stale.jsonl`",
      ),
      "utf8",
    );
    const stale = benchmarkGallery({
      projectRoot: project,
      validate: true,
    });
    expect(stale.validation).toMatchObject({
      stale: true,
      ok: false,
    });
    expect(stale.ok).toBe(false);
  });

  it("includes public benchmark evidence JSONL sources by default", () => {
    const { project, library } = setupBenchmarkProject();
    const current = benchmarkReport({
      projectRoot: project,
      libraryRoot: library,
      append: true,
      now: () => new Date("2026-05-03T18:00:00.000Z"),
    });
    const external = JSON.parse(JSON.stringify(current)) as typeof current;
    external.generatedAt = "2026-05-03T18:30:00.000Z";
    external.status.agentfile.project.name = "public-next-fixture";
    external.scorecard.ready_layers.ready = 4;
    external.scorecard.continuity.passed = 6;
    external.scorecard.diagnostics.doctor_errors = 0;

    const evidenceDir = path.join(project, "docs", "benchmark-evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDir, "public-shapes.jsonl"),
      `${JSON.stringify({
        schema_version: "anamnesis.evidence.v1",
        kind: "benchmark-report",
        generated_at: "2026-05-03T18:30:00.000Z",
        command: ["anamnesis", "benchmark", "report"],
        project: { name: "public-next-fixture" },
        summary: {
          scorecard: external.scorecard,
        },
        artifacts: {
          markdown: "docs/BENCHMARKS.md",
        },
      })}\n`,
      "utf8",
    );

    const result = benchmarkGallery({ projectRoot: project });

    expect(result.evidenceRecords).toBe(4);
    expect(result.evidencePath).toBe(
      ".anamnesis/evidence/events.jsonl; docs/benchmark-evidence/public-shapes.jsonl",
    );
    expect(result.entries.map((entry) => entry.projectName).sort()).toEqual([
      "anamnesis-project",
      "public-next-fixture",
    ]);
    expect(result.markdown).toContain("public-next-fixture current benchmark");
  });

  it("records model-dependent agent task benchmarks separately", () => {
    const project = tmpDir("anamnesis-agent-task-benchmark-");
    const input = agentTaskBenchmarkTemplate(
      new Date("2026-05-07T08:00:00.000Z"),
    );
    input.project.name = "agent-task-fixture";
    input.task.id = "handoff-recovery";
    input.run.id = "handoff-recovery-codex-001";
    input.metrics = {
      questions_before_action: 0,
      tool_turns_to_context: 1,
      first_correct_action: true,
      handoff_recovered: true,
      elapsed_ms: 45000,
      task_success: true,
      required_source_reads: 2,
      expected_source_reads: 2,
      missed_invariant_count: 0,
      hallucinated_fact_count: 0,
      unnecessary_context_reads: 0,
      total_tokens: 9000,
    };
    const inputPath = path.join(project, "task-run.json");
    fs.writeFileSync(inputPath, JSON.stringify(input), "utf8");

    const result = agentTaskBenchmark({
      projectRoot: project,
      inputPath,
      append: true,
      now: () => new Date("2026-05-07T08:01:00.000Z"),
    });

    expect(result.score).toMatchObject({
      points: 5,
      total: 5,
      first_correct_action: 1,
      handoff_recovered: 1,
      retrieval: {
        required_source_read_rate: 1,
        task_success: 1,
        missed_invariant_count: 0,
        hallucinated_fact_count: 0,
        unnecessary_context_reads: 0,
        total_tokens: 9000,
      },
    });
    expect(result.appendedPath).toBe("docs/AGENT-TASK-BENCHMARKS.md");
    expect(result.evidencePath).toBe(".anamnesis/evidence/events.jsonl");
    expect(result.markdown).toContain("Agent Task Benchmark");
    expect(result.markdown).toContain("Session context mode: compact");
    expect(result.markdown).toContain("| Required source reads | 2/2 | 100% |");
    expect(result.markdown).toContain("Model-dependent result");

    const evidenceLines = fs
      .readFileSync(
        path.join(project, ".anamnesis", "evidence", "events.jsonl"),
        "utf8",
      )
      .trim()
      .split(/\r?\n/);
    expect(evidenceLines).toHaveLength(1);
    const evidence = JSON.parse(evidenceLines[0]!) as {
      kind: string;
      summary: {
        schema_version?: string;
        session_context_mode?: string;
        score?: { points?: number; total?: number };
        retrieval?: {
          required_source_read_rate?: number;
          task_success?: number;
        };
      };
    };
    expect(evidence).toMatchObject({
      kind: "agent-task-benchmark",
      summary: {
        schema_version: "anamnesis.agent_task_benchmark.v1",
        session_context_mode: "compact",
        score: { points: 5, total: 5 },
        retrieval: {
          required_source_read_rate: 1,
          task_success: 1,
        },
      },
    });

    const gallery = benchmarkGallery({ projectRoot: project });
    expect(gallery.evidenceRecords).toBe(1);
    expect(gallery.entries).toEqual([]);
    expect(gallery.warnings).toContain(
      "No current benchmark scorecard evidence found.",
    );
  });

  it("defers prompt-time context deltas when evidence is insufficient", () => {
    const { project, library } = setupBenchmarkProject();

    const result = promptDeltaGate({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-05-07T09:00:00.000Z"),
    });

    expect(result.decision).toMatchObject({
      recommendation: "defer",
      shouldImplementPromptDelta: false,
    });
    expect(result.evidence).toMatchObject({
      records: 2,
      benchmarkReports: 0,
      agentTaskBenchmarks: 0,
    });
    expect(result.contextBudget.files.length).toBeGreaterThan(0);
    expect(result.markdown).toContain("Prompt-Time Delta Gate");
    expect(result.markdown).toContain("Implement prompt-time delta: no");
  });

  it("uses session-context and retrieval benchmark evidence in prompt gate", () => {
    const { project, library } = setupBenchmarkProject();
    sessionContextBenchmark({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-06-19T00:00:00.000Z"),
    });

    const input = agentTaskBenchmarkTemplate(
      new Date("2026-06-19T00:10:00.000Z"),
    );
    input.project.name = "anamnesis-project";
    input.task.id = "compact-retrieval";
    input.run.id = "compact-retrieval-codex-001";
    input.run.session_context_mode = "compact";
    input.metrics = {
      questions_before_action: 0,
      tool_turns_to_context: 1,
      first_correct_action: true,
      handoff_recovered: true,
      elapsed_ms: 50000,
      task_success: true,
      required_source_reads: 3,
      expected_source_reads: 3,
      missed_invariant_count: 0,
      hallucinated_fact_count: 0,
      unnecessary_context_reads: 0,
      total_tokens: 10000,
    };
    const inputPath = path.join(project, "compact-retrieval.json");
    fs.writeFileSync(inputPath, JSON.stringify(input), "utf8");
    agentTaskBenchmark({
      projectRoot: project,
      inputPath,
      append: true,
      now: () => new Date("2026-06-19T00:11:00.000Z"),
    });

    const result = promptDeltaGate({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-06-19T00:12:00.000Z"),
    });

    expect(result.decision).toMatchObject({
      recommendation: "defer",
      shouldImplementPromptDelta: false,
    });
    expect(result.evidence).toMatchObject({
      records: 3,
      agentTaskBenchmarks: 1,
      retrievalBenchmarks: 1,
      compactRetrievalBenchmarks: 1,
      fullRetrievalBenchmarks: 0,
      retrievalFriction: 0,
      retrievalFailures: 0,
      sessionContextBenchmarks: 1,
      sessionContextCompactCapExceeded: 0,
    });
    expect(
      result.signals.find((signal) => signal.id === "session-context-benchmark"),
    ).toMatchObject({ status: "pass" });
    expect(
      result.signals.find((signal) => signal.id === "agent-task-friction"),
    ).toMatchObject({ status: "pass" });
    expect(result.evidencePath).toContain(
      "docs/benchmark-evidence/session-context/session-context.json",
    );
    expect(result.markdown).toContain("- session-context benchmarks: 1");
    expect(result.markdown).toContain(
      "- retrieval benchmarks: 1 (compact 1, full 0)",
    );
  });

  it("allows only a non-default prompt-time prototype for repeated continuity failures", () => {
    const { project, library } = setupBenchmarkProject();
    fs.rmSync(path.join(project, ".codex", "hooks.json"));

    const evidencePath = path.join(project, ".anamnesis", "evidence", "events.jsonl");
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    const failingTaskRecord = (id: string, generatedAt: string) => ({
      schema_version: "anamnesis.evidence.v1",
      kind: "agent-task-benchmark",
      generated_at: generatedAt,
      command: ["anamnesis", "benchmark", "task"],
      project: { name: "anamnesis-project" },
      summary: {
        schema_version: "anamnesis.agent_task_benchmark.v1",
        task_id: "handoff-recovery",
        run_id: id,
        agent: "codex",
        model: "gpt-5.5",
        context_state: "handoff",
        score: { points: 2, total: 5 },
        metrics: {
          questions_before_action: 2,
          tool_turns_to_context: 4,
          first_correct_action: false,
          handoff_recovered: false,
          elapsed_ms: 240000,
        },
      },
    });
    fs.writeFileSync(
      evidencePath,
      [
        JSON.stringify(failingTaskRecord("handoff-recovery-codex-001", "2026-05-07T09:01:00.000Z")),
        JSON.stringify(failingTaskRecord("handoff-recovery-codex-002", "2026-05-07T09:02:00.000Z")),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = promptDeltaGate({
      projectRoot: project,
      libraryRoot: library,
      maxPromptDeltaTokens: 100000,
      append: true,
      now: () => new Date("2026-05-07T09:03:00.000Z"),
    });

    expect(result.decision).toMatchObject({
      recommendation: "prototype",
      shouldImplementPromptDelta: true,
    });
    expect(result.evidence).toMatchObject({
      records: 2,
      agentTaskBenchmarks: 2,
      taskFailures: 2,
    });
    expect(result.contextBudget.duplicateContextRisk).not.toBe("high");
    expect(result.appendedPath).toBe("docs/BENCHMARKS.md");
    expect(result.evidenceRecordPath).toBe(".anamnesis/evidence/events.jsonl");

    const evidenceLines = fs
      .readFileSync(evidencePath, "utf8")
      .trim()
      .split(/\r?\n/);
    expect(evidenceLines).toHaveLength(3);
    const gateEvidence = JSON.parse(evidenceLines[2]!) as {
      kind: string;
      summary: { recommendation?: string };
    };
    expect(gateEvidence).toMatchObject({
      kind: "prompt-delta-gate",
      summary: { recommendation: "prototype" },
    });
  });
});

describe("sessionContextBenchmark", () => {
  it("compares full and compact startup context and writes SVG artifacts", () => {
    const project = tmpDir("anamnesis-session-context-benchmark-");

    const result = sessionContextBenchmark({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-06-19T00:00:00.000Z"),
    });

    expect(result.schema_version).toBe("anamnesis.session_context_benchmark.v1");
    expect(result.summary.fixtures).toBe(7);
    expect(result.summary.compactRequiredRulePasses).toBe(
      result.summary.compactRequiredRuleTotal,
    );
    expect(result.summary.compactSourcePointerFixtures).toBe(7);
    expect(result.summary.largeFixtureCompactReductionPct).toBeGreaterThanOrEqual(
      60,
    );
    expect(result.summary.compactCapExceeded).toBe(0);
    expect(result.summary.fullCapExceeded).toBeGreaterThan(0);
    expect(result.markdown).toContain("Session Context Benchmark");
    expect(result.markdown).toContain("| Large ontology |");

    const large = result.fixtures.find((fixture) => fixture.id === "large-ontology");
    expect(large?.metrics.full.includedFileBytes).toBeGreaterThan(0);
    expect(large?.metrics.compact.includedFileBytes).toBe(0);
    expect(large?.metrics.compact.sourcePointers).toBeGreaterThan(0);

    for (const artifact of [
      result.artifacts.json,
      result.artifacts.markdown,
      result.artifacts.tokenByModeSvg,
      result.artifacts.payloadCompositionSvg,
      result.artifacts.fixtureGrowthSvg,
      result.artifacts.capSuccessSummarySvg,
    ]) {
      expect(artifact).toBeTruthy();
      expect(fs.existsSync(path.join(project, artifact!))).toBe(true);
    }

    const json = JSON.parse(
      fs.readFileSync(path.join(project, result.artifacts.json!), "utf8"),
    ) as { schema_version?: string; artifacts?: Record<string, string> };
    expect(json.schema_version).toBe("anamnesis.session_context_benchmark.v1");
    expect(json.artifacts?.tokenByModeSvg).toBe(
      "docs/benchmark-evidence/session-context/token-by-mode.svg",
    );

    const markdown = fs.readFileSync(
      path.join(project, result.artifacts.markdown!),
      "utf8",
    );
    expect(markdown).toContain("![Token by mode](token-by-mode.svg)");
    expect(markdown).toContain("![Cap success summary](cap-success-summary.svg)");

    const svg = fs.readFileSync(
      path.join(project, result.artifacts.tokenByModeSvg!),
      "utf8",
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("Session Context Tokens By Mode");
  });
});
