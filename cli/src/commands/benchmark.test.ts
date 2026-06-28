import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { benchmarkCompare, benchmarkReport } from "./benchmark.js";
import { benchmarkGallery } from "./benchmark_gallery.js";
import {
  agentTaskBenchmark,
  agentTaskBenchmarkCompare,
  agentTaskBenchmarkCompareTemplate,
  agentTaskBenchmarkTemplate,
} from "./benchmark_task.js";
import { agentTaskBenchmarkSeries } from "./benchmark_task_series.js";
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
      source_citations: 2,
      expected_source_citations: 2,
      missed_invariant_count: 0,
      hallucinated_fact_count: 0,
      unnecessary_context_reads: 0,
      managed_region_edit_attempts: 0,
      bootstrap_edit_attempts: 0,
      handoff_refresh_required: true,
      handoff_refreshed: true,
      matched_harness_read: true,
      nonmatched_harness_reads: 0,
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
        source_citation_rate: 1,
        task_success: 1,
        missed_invariant_count: 0,
        hallucinated_fact_count: 0,
        unnecessary_context_reads: 0,
        managed_region_edit_attempts: 0,
        bootstrap_edit_attempts: 0,
        handoff_refresh_success: 1,
        matched_harness_read: 1,
        nonmatched_harness_reads: 0,
        total_tokens: 9000,
      },
    });
    expect(result.appendedPath).toBe("docs/AGENT-TASK-BENCHMARKS.md");
    expect(result.evidencePath).toBe(".anamnesis/evidence/events.jsonl");
    expect(result.markdown).toContain("Agent Task Benchmark");
    expect(result.markdown).toContain("Session context mode: compact");
    expect(result.markdown).toContain("| Required source reads | 2/2 | 100% |");
    expect(result.markdown).toContain("| Source citations | 2/2 | 100% |");
    expect(result.markdown).toContain("| Handoff refresh | required / refreshed | 1 |");
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
          source_citation_rate: 1,
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

  it("compares paired full and compact retrieval task benchmarks", () => {
    const { project, library } = setupBenchmarkProject();
    const full = agentTaskBenchmarkTemplate(
      new Date("2026-06-19T01:00:00.000Z"),
    );
    full.project.name = "anamnesis-project";
    full.task.id = "compact-retrieval";
    full.run.id = "compact-retrieval-full-001";
    full.run.session_context_mode = "full";
    full.metrics = {
      questions_before_action: 0,
      tool_turns_to_context: 1,
      first_correct_action: true,
      handoff_recovered: true,
      elapsed_ms: 60000,
      task_success: true,
      required_source_reads: 1,
      expected_source_reads: 3,
      source_citations: 1,
      expected_source_citations: 2,
      missed_invariant_count: 0,
      hallucinated_fact_count: 0,
      unnecessary_context_reads: 0,
      managed_region_edit_attempts: 0,
      bootstrap_edit_attempts: 0,
      handoff_refresh_required: true,
      handoff_refreshed: true,
      matched_harness_read: true,
      nonmatched_harness_reads: 0,
      total_tokens: 20000,
    };
    const compact = JSON.parse(JSON.stringify(full)) as typeof full;
    compact.generated_at = "2026-06-19T01:05:00.000Z";
    compact.run.id = "compact-retrieval-compact-001";
    compact.run.session_context_mode = "compact";
    compact.metrics.required_source_reads = 3;
    compact.metrics.source_citations = 2;
    compact.metrics.unnecessary_context_reads = 1;
    compact.metrics.elapsed_ms = 50000;
    compact.metrics.total_tokens = 10000;

    const fullInputPath = path.join(project, "full.json");
    const compactInputPath = path.join(project, "compact.json");
    fs.writeFileSync(fullInputPath, JSON.stringify(full), "utf8");
    fs.writeFileSync(compactInputPath, JSON.stringify(compact), "utf8");

    const compare = agentTaskBenchmarkCompare({
      projectRoot: project,
      fullInputPath,
      compactInputPath,
      append: true,
      now: () => new Date("2026-06-19T01:10:00.000Z"),
    });

    expect(compare.summary).toMatchObject({
      regressions: 1,
      failures: 0,
      compact_task_success_within_tolerance: true,
      source_citation_rate_delta: 0.5,
      compact_token_reduction_pct: 50,
    });
    expect(compare.deltas.find((delta) => delta.id === "required-source-read-rate")).toMatchObject({
      delta: 0.667,
      verdict: "compact-better",
    });
    expect(compare.deltas.find((delta) => delta.id === "source-citation-rate")).toMatchObject({
      delta: 0.5,
      verdict: "compact-better",
    });
    expect(compare.markdown).toContain("Agent Task Benchmark Compare");
    expect(compare.markdown).toContain("| Total tokens | 20000 tokens | 10000 tokens | -10000 tokens | compact-better |");
    expect(compare.appendedPath).toBe("docs/AGENT-TASK-BENCHMARKS.md");
    expect(compare.evidencePath).toBe(".anamnesis/evidence/events.jsonl");

    const evidenceLines = fs
      .readFileSync(
        path.join(project, ".anamnesis", "evidence", "events.jsonl"),
        "utf8",
      )
      .trim()
      .split(/\r?\n/);
    expect(evidenceLines).toHaveLength(3);
    expect(JSON.parse(evidenceLines.at(-1)!) as { kind: string }).toMatchObject({
      kind: "agent-task-benchmark-compare",
    });

    const gate = promptDeltaGate({
      projectRoot: project,
      libraryRoot: library,
      now: () => new Date("2026-06-19T01:11:00.000Z"),
    });
    expect(gate.evidence).toMatchObject({
      records: 3,
      agentTaskBenchmarks: 0,
      agentTaskBenchmarkCompares: 1,
      retrievalComparisonRegressions: 1,
      retrievalComparisonFailures: 0,
      retrievalFriction: 1,
      retrievalFailures: 0,
    });
    expect(gate.decision).toMatchObject({
      recommendation: "collect-more-evidence",
      shouldImplementPromptDelta: false,
    });
  });

  it("generates a comparable full and compact task pair template", () => {
    const project = tmpDir("anamnesis-agent-task-pair-template-");
    const template = agentTaskBenchmarkCompareTemplate(
      new Date("2026-06-19T01:20:00.000Z"),
    );

    expect(template.full.run.session_context_mode).toBe("full");
    expect(template.compact.run.session_context_mode).toBe("compact");
    expect(template.full.task.prompt).toBe(template.compact.task.prompt);
    expect(template.full.run.agent).toBe(template.compact.run.agent);
    expect(template.full.run.model).toBe(template.compact.run.model);
    expect(template.usage.compare_command).toContain(
      "anamnesis benchmark task-compare",
    );

    const fullInputPath = path.join(project, template.usage.full_input);
    const compactInputPath = path.join(project, template.usage.compact_input);
    fs.writeFileSync(fullInputPath, JSON.stringify(template.full), "utf8");
    fs.writeFileSync(compactInputPath, JSON.stringify(template.compact), "utf8");

    const result = agentTaskBenchmarkCompare({
      projectRoot: project,
      fullInputPath,
      compactInputPath,
      now: () => new Date("2026-06-19T01:21:00.000Z"),
    });

    expect(result.summary).toMatchObject({
      compact_task_success_within_tolerance: true,
      compact_token_reduction_pct: 46.154,
    });
    expect(result.markdown).toContain("Agent Task Benchmark Compare");
  });

  it("rolls up repeated full and compact task comparisons", () => {
    const { project } = setupBenchmarkProject();
    const full = agentTaskBenchmarkTemplate(
      new Date("2026-06-19T02:00:00.000Z"),
    );
    full.project.name = "anamnesis-project";
    full.task.id = "compact-retrieval";
    full.run.id = "compact-retrieval-full-001";
    full.run.session_context_mode = "full";
    full.metrics = {
      questions_before_action: 0,
      tool_turns_to_context: 1,
      first_correct_action: true,
      handoff_recovered: true,
      elapsed_ms: 60000,
      task_success: true,
      required_source_reads: 1,
      expected_source_reads: 3,
      source_citations: 1,
      expected_source_citations: 2,
      missed_invariant_count: 0,
      hallucinated_fact_count: 0,
      unnecessary_context_reads: 0,
      managed_region_edit_attempts: 0,
      bootstrap_edit_attempts: 0,
      handoff_refresh_required: true,
      handoff_refreshed: true,
      matched_harness_read: true,
      nonmatched_harness_reads: 0,
      total_tokens: 20000,
    };
    const compact = JSON.parse(JSON.stringify(full)) as typeof full;
    compact.run.id = "compact-retrieval-compact-001";
    compact.run.session_context_mode = "compact";
    compact.metrics.required_source_reads = 3;
    compact.metrics.source_citations = 2;
    compact.metrics.elapsed_ms = 50000;
    compact.metrics.total_tokens = 10000;

    const fullPath = path.join(project, "full-1.json");
    const compactPath = path.join(project, "compact-1.json");
    fs.writeFileSync(fullPath, JSON.stringify(full), "utf8");
    fs.writeFileSync(compactPath, JSON.stringify(compact), "utf8");
    agentTaskBenchmarkCompare({
      projectRoot: project,
      fullInputPath: fullPath,
      compactInputPath: compactPath,
      append: true,
      now: () => new Date("2026-06-19T02:10:00.000Z"),
    });

    const full2 = JSON.parse(JSON.stringify(full)) as typeof full;
    full2.run.id = "compact-retrieval-full-002";
    full2.metrics.required_source_reads = 3;
    full2.metrics.elapsed_ms = 40000;
    full2.metrics.total_tokens = 18000;
    const compact2 = JSON.parse(JSON.stringify(full2)) as typeof full2;
    compact2.run.id = "compact-retrieval-compact-002";
    compact2.run.session_context_mode = "compact";
    compact2.metrics.required_source_reads = 2;
    compact2.metrics.source_citations = 2;
    compact2.metrics.elapsed_ms = 70000;
    compact2.metrics.total_tokens = 24000;

    const full2Path = path.join(project, "full-2.json");
    const compact2Path = path.join(project, "compact-2.json");
    fs.writeFileSync(full2Path, JSON.stringify(full2), "utf8");
    fs.writeFileSync(compact2Path, JSON.stringify(compact2), "utf8");
    agentTaskBenchmarkCompare({
      projectRoot: project,
      fullInputPath: full2Path,
      compactInputPath: compact2Path,
      append: true,
      now: () => new Date("2026-06-19T02:20:00.000Z"),
    });

    const series = agentTaskBenchmarkSeries({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-06-19T02:30:00.000Z"),
    });

    expect(series.summary).toMatchObject({
      groups: 1,
      pairs: 2,
      failures: 0,
    });
    expect(series.compareRecords).toBe(2);
    const group = series.groups[0]!;
    expect(group).toMatchObject({
      pairs: 2,
      compact_task_success_rate: 1,
      required_source_read_rate_delta: {
        average: 0.167,
        min: -0.333,
        max: 0.667,
      },
      source_citation_rate_delta: {
        average: 0.5,
        min: 0.5,
        max: 0.5,
      },
      total_tokens_delta: {
        average: -2000,
        min: -10000,
        max: 6000,
        stddev: 8000,
      },
    });
    expect(series.markdown).toContain("Agent Task Benchmark Series");
    expect(series.markdown).toContain("avg/stddev/min/max");
    for (const artifact of [
      series.artifacts.json,
      series.artifacts.markdown,
      series.artifacts.tokenDeltaSvg,
      series.artifacts.qualitySummarySvg,
      series.artifacts.sourceCitationDeltaSvg,
    ]) {
      expect(artifact).toBeTruthy();
      expect(fs.existsSync(path.join(project, artifact!))).toBe(true);
    }
    const svg = fs.readFileSync(
      path.join(project, series.artifacts.tokenDeltaSvg!),
      "utf8",
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("Agent Task Series Total Token Delta");
    const sourceSvg = fs.readFileSync(
      path.join(project, series.artifacts.sourceCitationDeltaSvg!),
      "utf8",
    );
    expect(sourceSvg).toContain("Agent Task Series Source Citation Delta");
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
