import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { benchmarkCompare, benchmarkReport } from "./benchmark.js";
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
    expect(evidenceLines).toHaveLength(1);
    const evidence = JSON.parse(evidenceLines[0]!) as {
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
        records: 1,
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
      improved: 8,
      regressed: 0,
      unchanged: 1,
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
    expect(evidenceLines).toHaveLength(1);
    const evidence = JSON.parse(evidenceLines[0]!) as {
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
        improved: 8,
        regressed: 0,
        unchanged: 1,
      },
    });
  });
});
