// `anamnesis benchmark report` — deterministic context-quality report.
//
// This is not a model benchmark. It reports the concrete context surfaces that
// anamnesis can prove from disk: static ontology, Layer A bootstrap facts,
// Layer B enriched semantics, continuity readiness, and adapter surfaces.

import * as fs from "node:fs";
import * as path from "node:path";
import { status, StatusError, type StatusResult } from "./status.js";
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

export interface BenchmarkResult {
  projectRoot: string;
  libraryRoot: string;
  generatedAt: string;
  status: StatusResult;
  bootstrap: BootstrapResult;
  ontologyFiles: BenchmarkOntologyFiles;
  layers: BenchmarkLayer[];
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
  let boot: BootstrapResult;
  try {
    st = status({ projectRoot, libraryRoot });
    boot = bootstrap({ projectRoot, dryRun: true });
  } catch (e) {
    if (e instanceof StatusError || e instanceof OntologyBootstrapError) {
      throw new BenchmarkError(e.message);
    }
    throw e;
  }

  const ontologyFiles = collectOntologyFiles(projectRoot);
  const layers = benchmarkLayers(st, ontologyFiles);
  const ready = layers.filter((layer) => layer.status === "ready").length;
  const markdown = renderBenchmarkMarkdown({
    generatedAt,
    st,
    boot,
    ontologyFiles,
    layers,
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
        boot,
        ontologyFiles,
        layers,
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
    bootstrap: boot,
    ontologyFiles,
    layers,
    summary: { ready, total: layers.length },
    markdown,
    appendedPath,
    evidencePath,
  };
}

function benchmarkEvidenceRecord(input: {
  generatedAt: string;
  st: StatusResult;
  boot: BootstrapResult;
  ontologyFiles: BenchmarkOntologyFiles;
  layers: BenchmarkLayer[];
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
  boot: BootstrapResult;
  ontologyFiles: BenchmarkOntologyFiles;
  layers: BenchmarkLayer[];
  ready: number;
}): string {
  const rows = input.layers
    .map(
      (layer) =>
        `| ${layer.label} | ${layer.status} | ${layer.score}/${layer.total} | ${escapeCell(layer.detail)} |`,
    )
    .join("\n");
  const bootstrapSummary = summarizeBootstrap(input.boot);
  return [
    `## Benchmark Report — ${input.generatedAt}`,
    "",
    `Project: ${input.st.agentfile.project.name}`,
    `Tools: ${input.st.agentfile.tools.join(", ")}`,
    `Fragments: ${input.st.fragments.map((f) => `${f.id}@${f.installedVersion}:${f.status}`).join(", ")}`,
    `Ready layers: ${input.ready}/${input.layers.length}`,
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
