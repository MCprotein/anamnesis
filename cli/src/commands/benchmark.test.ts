import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { benchmarkReport } from "./benchmark.js";
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
    const text = fs.readFileSync(
      path.join(project, "docs", "BENCHMARKS.md"),
      "utf8",
    );
    expect(text).toContain("Benchmark Report — 2026-05-03T13:00:00.000Z");
    expect(text).toContain("Ready layers: 5/5");
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
});
