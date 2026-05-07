// `anamnesis benchmark report` — deterministic context-quality report.
//
// This is not a model benchmark. It reports the concrete context surfaces that
// anamnesis can prove from disk: static ontology, Layer A bootstrap facts,
// Layer B enriched semantics, continuity readiness, and adapter surfaces.

import * as fs from "node:fs";
import * as path from "node:path";
import { status, StatusError, type StatusResult } from "./status.js";
import { doctor, DoctorError, type DoctorResult } from "./doctor.js";
import {
  bootstrap,
  OntologyBootstrapError,
  type BootstrapResult,
} from "./ontology.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";

export type BenchmarkLayerId =
  | "static-ontology"
  | "bootstrap-ontology"
  | "enriched-ontology"
  | "continuity"
  | "adapter-surfaces";

export type BenchmarkLayerStatus = "ready" | "partial" | "missing" | "stale";

export interface BenchmarkLayer {
  id: BenchmarkLayerId;
  label: string;
  status: BenchmarkLayerStatus;
  score: number;
  total: number;
  detail: string;
  targets: string[];
}

export interface BenchmarkOntologyFiles {
  static: string[];
  bootstrap: string[];
  enriched: string[];
}

export const BENCHMARK_SCORECARD_SCHEMA_VERSION =
  "anamnesis.benchmark.scorecard.v1";

export interface BenchmarkScorecard {
  schema_version: typeof BENCHMARK_SCORECARD_SCHEMA_VERSION;
  ready_layers: {
    ready: number;
    total: number;
  };
  continuity: {
    ready: boolean;
    passed: number;
    total: number;
  };
  ontology_gaps: {
    warnings: number;
    info: number;
    static_missing: number;
    bootstrap_missing: number;
    bootstrap_stale: number;
    enrichment_missing: number;
  };
  diagnostics: {
    doctor_errors: number;
    doctor_warnings: number;
    codex_hook_warnings: number;
    codex_hook_duplicates: number;
    codex_hook_invalid: number;
  };
  adapter_surfaces: {
    ready: boolean;
    score: number;
    total: number;
  };
  evidence: {
    records: number;
    invalid_records: number;
    latest_kind?: string;
    latest_generated_at?: string;
    latest_age_ms?: number;
  };
}

export interface BenchmarkResult {
  projectRoot: string;
  libraryRoot: string;
  generatedAt: string;
  status: StatusResult;
  doctor: DoctorResult;
  bootstrap: BootstrapResult;
  ontologyFiles: BenchmarkOntologyFiles;
  layers: BenchmarkLayer[];
  scorecard: BenchmarkScorecard;
  summary: {
    ready: number;
    total: number;
  };
  markdown: string;
  appendedPath?: string;
  evidencePath?: string;
}

export interface BenchmarkOptions {
  projectRoot: string;
  libraryRoot: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export type BenchmarkDeltaDirection = "higher-is-better" | "lower-is-better";
export type BenchmarkDeltaVerdict = "improved" | "regressed" | "unchanged";

export interface BenchmarkDelta {
  id: string;
  label: string;
  direction: BenchmarkDeltaDirection;
  before: number;
  after: number;
  delta: number;
  verdict: BenchmarkDeltaVerdict;
  unit?: string;
}

export interface BenchmarkCompareResult {
  projectRoot: string;
  generatedAt: string;
  baselinePath: string;
  afterPath: string;
  baseline: {
    projectName: string;
    generatedAt: string;
    scorecard: BenchmarkScorecard;
  };
  after: {
    projectName: string;
    generatedAt: string;
    scorecard: BenchmarkScorecard;
  };
  deltas: BenchmarkDelta[];
  summary: {
    improved: number;
    regressed: number;
    unchanged: number;
  };
  markdown: string;
  appendedPath?: string;
  evidencePath?: string;
}

export interface BenchmarkCompareOptions {
  projectRoot: string;
  baselinePath: string;
  afterPath: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class BenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkError";
  }
}

export function benchmarkReport(opts: BenchmarkOptions): BenchmarkResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();

  let st: StatusResult;
  let doc: DoctorResult;
  let boot: BootstrapResult;
  try {
    st = status({ projectRoot, libraryRoot });
    doc = doctor({ projectRoot, libraryRoot });
    boot = bootstrap({ projectRoot, dryRun: true });
  } catch (e) {
    if (
      e instanceof StatusError ||
      e instanceof DoctorError ||
      e instanceof OntologyBootstrapError
    ) {
      throw new BenchmarkError(e.message);
    }
    throw e;
  }

  const ontologyFiles = collectOntologyFiles(projectRoot);
  const layers = benchmarkLayers(st, ontologyFiles);
  const ready = layers.filter((layer) => layer.status === "ready").length;
  const scorecard = buildBenchmarkScorecard({
    generatedAt,
    st,
    doc,
    layers,
    ready,
    willAppendEvidence: opts.append === true,
  });
  const markdown = renderBenchmarkMarkdown({
    generatedAt,
    st,
    doc,
    boot,
    ontologyFiles,
    layers,
    scorecard,
    ready,
  });

  let appendedPath: string | undefined;
  let evidencePath: string | undefined;
  if (opts.append === true) {
    const outputPath = path.resolve(
      projectRoot,
      opts.outputPath ?? path.join("docs", "BENCHMARKS.md"),
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}\n`, "utf8");
    appendedPath = displayPathFromProject(projectRoot, outputPath);
    evidencePath = appendEvidenceRecord(
      projectRoot,
      benchmarkEvidenceRecord({
        generatedAt,
        st,
        doc,
        boot,
        ontologyFiles,
        layers,
        scorecard,
        ready,
        appendedPath,
      }),
    );
  }

  return {
    projectRoot,
    libraryRoot,
    generatedAt,
    status: st,
    doctor: doc,
    bootstrap: boot,
    ontologyFiles,
    layers,
    scorecard,
    summary: { ready, total: layers.length },
    markdown,
    appendedPath,
    evidencePath,
  };
}

export function benchmarkCompare(
  opts: BenchmarkCompareOptions,
): BenchmarkCompareResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const baselinePath = path.resolve(projectRoot, opts.baselinePath);
  const afterPath = path.resolve(projectRoot, opts.afterPath);
  const baseline = readBenchmarkResultFile(baselinePath, "baseline");
  const after = readBenchmarkResultFile(afterPath, "after");
  const deltas = compareScorecards(baseline.scorecard, after.scorecard);
  const summary = {
    improved: deltas.filter((delta) => delta.verdict === "improved").length,
    regressed: deltas.filter((delta) => delta.verdict === "regressed").length,
    unchanged: deltas.filter((delta) => delta.verdict === "unchanged").length,
  };
  const baselineDisplayPath = displayPathFromProject(projectRoot, baselinePath);
  const afterDisplayPath = displayPathFromProject(projectRoot, afterPath);
  const markdown = renderCompareMarkdown({
    generatedAt,
    baselinePath: baselineDisplayPath,
    afterPath: afterDisplayPath,
    baseline,
    after,
    deltas,
    summary,
  });

  let appendedPath: string | undefined;
  let evidencePath: string | undefined;
  if (opts.append === true) {
    const outputPath = path.resolve(
      projectRoot,
      opts.outputPath ?? path.join("docs", "BENCHMARKS.md"),
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}\n`, "utf8");
    appendedPath = displayPathFromProject(projectRoot, outputPath);
    evidencePath = appendEvidenceRecord(
      projectRoot,
      benchmarkCompareEvidenceRecord({
        generatedAt,
        baselinePath: baselineDisplayPath,
        afterPath: afterDisplayPath,
        baseline,
        after,
        deltas,
        summary,
        appendedPath,
      }),
    );
  }

  return {
    projectRoot,
    generatedAt,
    baselinePath: baselineDisplayPath,
    afterPath: afterDisplayPath,
    baseline,
    after,
    deltas,
    summary,
    markdown,
    appendedPath,
    evidencePath,
  };
}

function benchmarkEvidenceRecord(input: {
  generatedAt: string;
  st: StatusResult;
  doc: DoctorResult;
  boot: BootstrapResult;
  ontologyFiles: BenchmarkOntologyFiles;
  layers: BenchmarkLayer[];
  scorecard: BenchmarkScorecard;
  ready: number;
  appendedPath: string;
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "benchmark-report",
    generated_at: input.generatedAt,
    command: ["anamnesis", "benchmark", "report"],
    project: { name: input.st.agentfile.project.name },
    summary: {
      ready: input.ready,
      total: input.layers.length,
      tools: input.st.agentfile.tools,
      ontology_files: input.ontologyFiles,
      continuity: {
        ready: input.st.continuity.ready,
        passed: input.st.continuity.passed,
        total: input.st.continuity.total,
      },
      ontology_gaps: input.st.ontology.summary,
      bootstrap_outcomes: bootstrapOutcomeCounts(input.boot),
      scorecard: input.scorecard,
    },
    details: {
      layers: input.layers.map((layer) => ({
        id: layer.id,
        status: layer.status,
        score: layer.score,
        total: layer.total,
        detail: layer.detail,
      })),
    },
    artifacts: {
      markdown: input.appendedPath,
    },
  };
}

function benchmarkCompareEvidenceRecord(input: {
  generatedAt: string;
  baselinePath: string;
  afterPath: string;
  baseline: BenchmarkCompareResult["baseline"];
  after: BenchmarkCompareResult["after"];
  deltas: BenchmarkDelta[];
  summary: BenchmarkCompareResult["summary"];
  appendedPath: string;
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "benchmark-compare",
    generated_at: input.generatedAt,
    command: ["anamnesis", "benchmark", "compare"],
    project: { name: input.after.projectName },
    summary: {
      baseline: {
        project: input.baseline.projectName,
        generated_at: input.baseline.generatedAt,
        path: input.baselinePath,
      },
      after: {
        project: input.after.projectName,
        generated_at: input.after.generatedAt,
        path: input.afterPath,
      },
      improved: input.summary.improved,
      regressed: input.summary.regressed,
      unchanged: input.summary.unchanged,
    },
    details: {
      deltas: input.deltas,
    },
    artifacts: {
      markdown: input.appendedPath,
    },
  };
}

function readBenchmarkResultFile(
  filePath: string,
  label: "baseline" | "after",
): BenchmarkCompareResult["baseline"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new BenchmarkError(`${label} benchmark JSON is invalid: ${filePath}`);
    }
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BenchmarkError(`${label} benchmark JSON not found: ${filePath}`);
    }
    throw e;
  }
  return parseBenchmarkSnapshot(parsed, label, filePath);
}

function parseBenchmarkSnapshot(
  value: unknown,
  label: "baseline" | "after",
  filePath: string,
): BenchmarkCompareResult["baseline"] {
  if (!isObject(value)) {
    throw new BenchmarkError(`${label} benchmark JSON must be an object: ${filePath}`);
  }
  const scorecard = value.scorecard;
  if (!isBenchmarkScorecard(scorecard)) {
    throw new BenchmarkError(
      `${label} benchmark JSON is missing scorecard schema ${BENCHMARK_SCORECARD_SCHEMA_VERSION}: ${filePath}`,
    );
  }

  return {
    projectName: readProjectName(value),
    generatedAt:
      typeof value.generatedAt === "string" ? value.generatedAt : "(unknown)",
    scorecard,
  };
}

function readProjectName(value: Record<string, unknown>): string {
  const status = value.status;
  if (!isObject(status)) return "(unknown)";
  const agentfile = status.agentfile;
  if (!isObject(agentfile)) return "(unknown)";
  const project = agentfile.project;
  if (!isObject(project)) return "(unknown)";
  return typeof project.name === "string" ? project.name : "(unknown)";
}

function isBenchmarkScorecard(value: unknown): value is BenchmarkScorecard {
  if (!isObject(value)) return false;
  return (
    value.schema_version === BENCHMARK_SCORECARD_SCHEMA_VERSION &&
    isScore(value.ready_layers, "ready", "total") &&
    isObject(value.continuity) &&
    typeof value.continuity.ready === "boolean" &&
    isNumber(value.continuity.passed) &&
    isNumber(value.continuity.total) &&
    isObject(value.ontology_gaps) &&
    isNumber(value.ontology_gaps.warnings) &&
    isNumber(value.ontology_gaps.enrichment_missing) &&
    isObject(value.diagnostics) &&
    isNumber(value.diagnostics.doctor_errors) &&
    isNumber(value.diagnostics.doctor_warnings) &&
    isNumber(value.diagnostics.codex_hook_warnings) &&
    isObject(value.adapter_surfaces) &&
    typeof value.adapter_surfaces.ready === "boolean" &&
    isNumber(value.adapter_surfaces.score) &&
    isNumber(value.adapter_surfaces.total) &&
    isObject(value.evidence) &&
    isNumber(value.evidence.records) &&
    isNumber(value.evidence.invalid_records)
  );
}

function isScore(
  value: unknown,
  scoreKey: string,
  totalKey: string,
): value is Record<string, number> {
  return (
    isObject(value) &&
    isNumber(value[scoreKey]) &&
    isNumber(value[totalKey])
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareScorecards(
  baseline: BenchmarkScorecard,
  after: BenchmarkScorecard,
): BenchmarkDelta[] {
  return [
    numericDelta({
      id: "ready-layers",
      label: "Ready layers",
      direction: "higher-is-better",
      before: baseline.ready_layers.ready,
      after: after.ready_layers.ready,
      unit: `/${after.ready_layers.total}`,
    }),
    numericDelta({
      id: "continuity-checks",
      label: "Continuity checks",
      direction: "higher-is-better",
      before: baseline.continuity.passed,
      after: after.continuity.passed,
      unit: `/${after.continuity.total}`,
    }),
    numericDelta({
      id: "ontology-warnings",
      label: "Ontology warnings",
      direction: "lower-is-better",
      before: baseline.ontology_gaps.warnings,
      after: after.ontology_gaps.warnings,
    }),
    numericDelta({
      id: "enrichment-missing",
      label: "Layer B enrichment missing",
      direction: "lower-is-better",
      before: baseline.ontology_gaps.enrichment_missing,
      after: after.ontology_gaps.enrichment_missing,
    }),
    numericDelta({
      id: "doctor-errors",
      label: "Doctor errors",
      direction: "lower-is-better",
      before: baseline.diagnostics.doctor_errors,
      after: after.diagnostics.doctor_errors,
    }),
    numericDelta({
      id: "doctor-warnings",
      label: "Doctor warnings",
      direction: "lower-is-better",
      before: baseline.diagnostics.doctor_warnings,
      after: after.diagnostics.doctor_warnings,
    }),
    numericDelta({
      id: "codex-hook-warnings",
      label: "Codex hook warnings",
      direction: "lower-is-better",
      before: baseline.diagnostics.codex_hook_warnings,
      after: after.diagnostics.codex_hook_warnings,
    }),
    numericDelta({
      id: "adapter-surfaces",
      label: "Adapter surfaces",
      direction: "higher-is-better",
      before: baseline.adapter_surfaces.score,
      after: after.adapter_surfaces.score,
      unit: `/${after.adapter_surfaces.total}`,
    }),
    numericDelta({
      id: "evidence-records",
      label: "Evidence records",
      direction: "higher-is-better",
      before: baseline.evidence.records,
      after: after.evidence.records,
    }),
  ];
}

function numericDelta(input: {
  id: string;
  label: string;
  direction: BenchmarkDeltaDirection;
  before: number;
  after: number;
  unit?: string;
}): BenchmarkDelta {
  const delta = input.after - input.before;
  let verdict: BenchmarkDeltaVerdict = "unchanged";
  if (delta !== 0) {
    const improved =
      input.direction === "higher-is-better" ? delta > 0 : delta < 0;
    verdict = improved ? "improved" : "regressed";
  }
  return {
    id: input.id,
    label: input.label,
    direction: input.direction,
    before: input.before,
    after: input.after,
    delta,
    verdict,
    ...(input.unit ? { unit: input.unit } : {}),
  };
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}

function benchmarkLayers(
  st: StatusResult,
  files: BenchmarkOntologyFiles,
): BenchmarkLayer[] {
  const ontology = st.ontology.summary;
  const continuityById = new Map(st.continuity.checks.map((check) => [check.id, check]));
  const adapter = continuityById.get("adapter-surfaces");

  return [
    {
      id: "static-ontology",
      label: "Static ontology",
      status:
        ontology.staticMissing === 0 && files.static.length > 0
          ? "ready"
          : files.static.length > 0
            ? "partial"
            : "missing",
      score: files.static.length,
      total: files.static.length + ontology.staticMissing,
      detail:
        ontology.staticMissing === 0
          ? `${files.static.length} static ontology file(s) found`
          : `${ontology.staticMissing} static ontology slice(s) missing`,
      targets: files.static,
    },
    {
      id: "bootstrap-ontology",
      label: "Layer A bootstrap",
      status:
        ontology.bootstrapStale > 0
          ? "stale"
          : ontology.bootstrapMissing > 0
            ? files.bootstrap.length > 0
              ? "partial"
              : "missing"
            : files.bootstrap.length > 0
              ? "ready"
              : "partial",
      score: files.bootstrap.length,
      total: files.bootstrap.length + ontology.bootstrapMissing + ontology.bootstrapStale,
      detail:
        ontology.bootstrapMissing === 0 && ontology.bootstrapStale === 0
          ? `${files.bootstrap.length} bootstrap file(s) found; no stale or missing Layer A warnings`
          : `${ontology.bootstrapMissing} missing, ${ontology.bootstrapStale} stale bootstrap file(s)`,
      targets: files.bootstrap,
    },
    {
      id: "enriched-ontology",
      label: "Layer B enrichment",
      status:
        ontology.enrichmentMissing > 0
          ? files.enriched.length > 0
            ? "partial"
            : "missing"
          : files.enriched.length > 0
            ? "ready"
            : "partial",
      score: files.enriched.length,
      total: files.enriched.length + ontology.enrichmentMissing,
      detail:
        ontology.enrichmentMissing === 0
          ? `${files.enriched.length} enriched file(s) found; no missing semantic enrichment warnings`
          : `${ontology.enrichmentMissing} semantic enrichment file(s) missing`,
      targets: files.enriched,
    },
    {
      id: "continuity",
      label: "Context continuity",
      status: st.continuity.ready ? "ready" : "partial",
      score: st.continuity.passed,
      total: st.continuity.total,
      detail: `${st.continuity.passed}/${st.continuity.total} continuity checks passing`,
      targets: st.continuity.checks.flatMap((check) => check.targets),
    },
    {
      id: "adapter-surfaces",
      label: "Adapter surfaces",
      status: adapter?.status === "pass" ? "ready" : "missing",
      score: adapter?.status === "pass" ? 1 : 0,
      total: 1,
      detail: adapter?.detail ?? "adapter surface check missing",
      targets: adapter?.targets ?? [],
    },
  ];
}

function buildBenchmarkScorecard(input: {
  generatedAt: string;
  st: StatusResult;
  doc: DoctorResult;
  layers: BenchmarkLayer[];
  ready: number;
  willAppendEvidence: boolean;
}): BenchmarkScorecard {
  const adapterLayer = input.layers.find((layer) => layer.id === "adapter-surfaces");
  const latest = input.willAppendEvidence
    ? {
        kind: "benchmark-report",
        generated_at: input.generatedAt,
      }
    : input.st.evidence.latest;
  const latestAgeMs = latest
    ? Math.max(0, Date.parse(input.generatedAt) - Date.parse(latest.generated_at))
    : undefined;

  return {
    schema_version: BENCHMARK_SCORECARD_SCHEMA_VERSION,
    ready_layers: {
      ready: input.ready,
      total: input.layers.length,
    },
    continuity: {
      ready: input.st.continuity.ready,
      passed: input.st.continuity.passed,
      total: input.st.continuity.total,
    },
    ontology_gaps: {
      warnings: input.st.ontology.summary.warnings,
      info: input.st.ontology.summary.info,
      static_missing: input.st.ontology.summary.staticMissing,
      bootstrap_missing: input.st.ontology.summary.bootstrapMissing,
      bootstrap_stale: input.st.ontology.summary.bootstrapStale,
      enrichment_missing: input.st.ontology.summary.enrichmentMissing,
    },
    diagnostics: {
      doctor_errors: input.doc.summary.errors,
      doctor_warnings: input.doc.summary.warnings,
      codex_hook_warnings: input.st.codexHooks.summary.warnings,
      codex_hook_duplicates: input.st.codexHooks.summary.duplicates,
      codex_hook_invalid: input.st.codexHooks.summary.invalid,
    },
    adapter_surfaces: {
      ready: adapterLayer?.status === "ready",
      score: adapterLayer?.score ?? 0,
      total: adapterLayer?.total ?? 1,
    },
    evidence: {
      records: input.st.evidence.total + (input.willAppendEvidence ? 1 : 0),
      invalid_records: input.st.evidence.invalid,
      ...(latest
        ? {
            latest_kind: latest.kind,
            latest_generated_at: latest.generated_at,
            latest_age_ms: latestAgeMs,
          }
        : {}),
    },
  };
}

function collectOntologyFiles(projectRoot: string): BenchmarkOntologyFiles {
  const out: BenchmarkOntologyFiles = { static: [], bootstrap: [], enriched: [] };
  visit(projectRoot, (file) => {
    const rel = path.relative(projectRoot, file).split(path.sep).join("/");
    if (!rel.includes("/.anamnesis/ontology/") && !rel.startsWith(".anamnesis/ontology/")) {
      return;
    }
    if (!rel.endsWith(".yaml")) return;
    if (rel.endsWith(".bootstrap.yaml")) {
      out.bootstrap.push(rel);
    } else if (rel.endsWith(".enriched.yaml")) {
      out.enriched.push(rel);
    } else {
      out.static.push(rel);
    }
  });
  out.static.sort();
  out.bootstrap.sort();
  out.enriched.sort();
  return out;
}

function visit(dir: string, onFile: (file: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(fp, onFile);
    } else if (entry.isFile()) {
      onFile(fp);
    }
  }
}

function renderBenchmarkMarkdown(input: {
  generatedAt: string;
  st: StatusResult;
  doc: DoctorResult;
  boot: BootstrapResult;
  ontologyFiles: BenchmarkOntologyFiles;
  layers: BenchmarkLayer[];
  scorecard: BenchmarkScorecard;
  ready: number;
}): string {
  const rows = input.layers
    .map(
      (layer) =>
        `| ${layer.label} | ${layer.status} | ${layer.score}/${layer.total} | ${escapeCell(layer.detail)} |`,
    )
    .join("\n");
  const scorecardRows = renderScorecardRows(input.scorecard);
  const bootstrapSummary = summarizeBootstrap(input.boot);
  return [
    `## Benchmark Report — ${input.generatedAt}`,
    "",
    `Project: ${input.st.agentfile.project.name}`,
    `Tools: ${input.st.agentfile.tools.join(", ")}`,
    `Fragments: ${input.st.fragments.map((f) => `${f.id}@${f.installedVersion}:${f.status}`).join(", ")}`,
    `Ready layers: ${input.ready}/${input.layers.length}`,
    "",
    "Scorecard:",
    "",
    "| Dimension | Value |",
    "|---|---:|",
    scorecardRows,
    "",
    "| Layer | Status | Score | Detail |",
    "|---|---|---:|---|",
    rows,
    "",
    "Ontology files:",
    `- static: ${formatList(input.ontologyFiles.static)}`,
    `- bootstrap: ${formatList(input.ontologyFiles.bootstrap)}`,
    `- enriched: ${formatList(input.ontologyFiles.enriched)}`,
    "",
    `Bootstrap dry-run outcomes: ${bootstrapSummary}`,
    `Continuity: ${input.st.continuity.ready ? "ready" : "issues"} (${input.st.continuity.passed}/${input.st.continuity.total})`,
    `Ontology gaps: ${input.st.ontology.summary.warnings} warning(s), ${input.st.ontology.summary.info} info`,
    `Doctor: ${input.doc.ok ? "ok" : "issues"} (${input.doc.summary.errors} error(s), ${input.doc.summary.warnings} warning(s))`,
    `Codex hook warnings: ${input.st.codexHooks.summary.warnings}`,
    `Evidence records: ${input.scorecard.evidence.records} valid, ${input.scorecard.evidence.invalid_records} invalid`,
  ].join("\n");
}

function renderCompareMarkdown(input: {
  generatedAt: string;
  baselinePath: string;
  afterPath: string;
  baseline: BenchmarkCompareResult["baseline"];
  after: BenchmarkCompareResult["after"];
  deltas: BenchmarkDelta[];
  summary: BenchmarkCompareResult["summary"];
}): string {
  const rows = input.deltas
    .map(
      (delta) =>
        `| ${delta.label} | ${formatDeltaValue(delta.before, delta.unit)} | ${formatDeltaValue(delta.after, delta.unit)} | ${formatSignedDelta(delta.delta)} | ${delta.verdict} |`,
    )
    .join("\n");
  return [
    `## Benchmark Compare — ${input.generatedAt}`,
    "",
    `Baseline: ${input.baseline.projectName} (${input.baseline.generatedAt})`,
    `After: ${input.after.projectName} (${input.after.generatedAt})`,
    `Baseline file: ${input.baselinePath}`,
    `After file: ${input.afterPath}`,
    `Summary: ${input.summary.improved} improved, ${input.summary.regressed} regressed, ${input.summary.unchanged} unchanged`,
    "",
    "| Dimension | Baseline | After | Delta | Verdict |",
    "|---|---:|---:|---:|---|",
    rows,
  ].join("\n");
}

function formatDeltaValue(value: number, unit: string | undefined): string {
  return `${value}${unit ?? ""}`;
}

function formatSignedDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function renderScorecardRows(scorecard: BenchmarkScorecard): string {
  return [
    `| Ready layers | ${scorecard.ready_layers.ready}/${scorecard.ready_layers.total} |`,
    `| Continuity checks | ${scorecard.continuity.passed}/${scorecard.continuity.total} |`,
    `| Ontology warnings | ${scorecard.ontology_gaps.warnings} |`,
    `| Doctor errors | ${scorecard.diagnostics.doctor_errors} |`,
    `| Doctor warnings | ${scorecard.diagnostics.doctor_warnings} |`,
    `| Codex hook warnings | ${scorecard.diagnostics.codex_hook_warnings} |`,
    `| Adapter surfaces | ${scorecard.adapter_surfaces.score}/${scorecard.adapter_surfaces.total} |`,
    `| Evidence records | ${scorecard.evidence.records} valid / ${scorecard.evidence.invalid_records} invalid |`,
  ].join("\n");
}

function summarizeBootstrap(result: BootstrapResult): string {
  const counts = bootstrapOutcomeCounts(result);
  if (Object.keys(counts).length === 0) return "none";
  return Object.entries(counts)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
}

function bootstrapOutcomeCounts(result: BootstrapResult): Record<string, number> {
  const counts = new Map<string, number>();
  for (const entry of result.entries) {
    counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  }
  return Object.fromEntries(counts.entries());
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `\`${item}\``).join(", ") : "(none)";
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
