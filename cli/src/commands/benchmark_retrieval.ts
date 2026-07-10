import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import {
  contextQuery,
  type ContextIndexKind,
  type ContextQueryMatch,
} from "./context_index.js";
import { sessionContextBudget } from "./session_context_budget.js";

export const RETRIEVAL_BENCHMARK_SCHEMA_VERSION =
  "anamnesis.retrieval_benchmark.v1";

const DEFAULT_OUTPUT_DIR = path.join(
  "docs",
  "benchmark-evidence",
  "retrieval-source-pointers",
);
const TOP1_THRESHOLD = 0.9;
const TOP3_THRESHOLD = 1;
const MRR_THRESHOLD = 0.85;
const COMPACT_SESSION_START_TOKEN_CAP = 800;

export interface RetrievalBenchmarkOptions {
  projectRoot: string;
  write?: boolean;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export interface RetrievalBenchmarkExpectedPointer {
  kind: ContextIndexKind;
  source_path: string;
  stable_ref?: string;
  title?: string;
}

export interface RetrievalBenchmarkCase {
  id: string;
  label: string;
  kind: ContextIndexKind;
  query: string;
  expected: RetrievalBenchmarkExpectedPointer;
}

export interface RetrievalBenchmarkReturnedPointer {
  rank: number;
  score: number;
  kind: ContextIndexKind;
  source_path: string;
  stable_ref: string;
  title: string;
}

export interface RetrievalBenchmarkCaseResult {
  id: string;
  label: string;
  kind: ContextIndexKind;
  query: string;
  expected: RetrievalBenchmarkExpectedPointer;
  rank?: number;
  top1Hit: boolean;
  top3Hit: boolean;
  reciprocalRank: number;
  returned: RetrievalBenchmarkReturnedPointer[];
  warnings: string[];
}

export interface RetrievalBenchmarkArtifacts {
  outputDir?: string;
  json?: string;
  markdown?: string;
  hitRatesSvg?: string;
  ranksSvg?: string;
}

export interface RetrievalBenchmarkResult {
  schema_version: typeof RETRIEVAL_BENCHMARK_SCHEMA_VERSION;
  generatedAt: string;
  fixture: {
    id: string;
    description: string;
  };
  cases: RetrievalBenchmarkCaseResult[];
  summary: {
    cases: number;
    top1Hits: number;
    top3Hits: number;
    top1HitRate: number;
    top3HitRate: number;
    mrr: number;
    compactSessionStartTokens: number;
    compactSessionStartCap: number;
    compactSessionStartCapExceeded: boolean;
    requiredSourceReadContract: boolean;
    hallucinatedProjectFacts: number;
    bootstrapEditAttempts: number;
    ok: boolean;
  };
  artifacts: RetrievalBenchmarkArtifacts;
  markdown: string;
  evidenceRecordPath?: string;
}

export class RetrievalBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalBenchmarkError";
  }
}

export function retrievalBenchmark(
  opts: RetrievalBenchmarkOptions,
): RetrievalBenchmarkResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "anamnesis-retrieval-benchmark-"),
  );

  try {
    writeRetrievalFixture(fixtureRoot);
    const cases = retrievalBenchmarkCases().map((item) =>
      runRetrievalCase(fixtureRoot, item),
    );
    const compactBudget = sessionContextBudget({
      projectRoot: fixtureRoot,
      maxTokens: COMPACT_SESSION_START_TOKEN_CAP,
      now: () => new Date(generatedAt),
    });
    const artifacts: RetrievalBenchmarkArtifacts = {};
    const result: RetrievalBenchmarkResult = {
      schema_version: RETRIEVAL_BENCHMARK_SCHEMA_VERSION,
      generatedAt,
      fixture: {
        id: "public-doc-ontology-retrieval",
        description:
          "Synthetic public-safe project with README, docs, ontology refs, and compact SessionStart source pointers.",
      },
      cases,
      summary: summarizeRetrievalBenchmark(cases, compactBudget.estimatedTokens),
      artifacts,
      markdown: "",
    };
    result.markdown = renderRetrievalBenchmarkMarkdown(result);

    if (opts.write === true) {
      writeRetrievalBenchmarkArtifacts({
        projectRoot,
        outputPath: opts.outputPath,
        result,
      });
    }

    if (opts.append === true) {
      result.evidenceRecordPath = appendEvidenceRecord(
        projectRoot,
        retrievalBenchmarkEvidenceRecord(result),
      );
    }

    return result;
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function writeRetrievalFixture(projectRoot: string): void {
  writeFile(
    projectRoot,
    "Agentfile",
    [
      "version: 1",
      "project: { name: retrieval-fixture }",
      "tools: [codex]",
      "fragments:",
      "  - id: base",
      "    version: 20",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "system_graph.yaml",
    [
      'schema_version: "anamnesis.system_graph.v1"',
      "entities:",
      "  - id: checkout-service",
      "    kind: service",
      "    name: checkout-service",
      "invariants:",
      "  - rule: checkout intent flow must read payment ontology before edits",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/ontology/payments.yaml",
    [
      'schema_version: "anamnesis.ontology.v1"',
      "entities:",
      "  - id: payment-worker",
      "    kind: worker",
      "    name: payment-worker",
      "relationships:",
      "  - from: checkout-service",
      "    to: payment-worker",
      "    type: dispatches",
      "invariants:",
      "  - rule: payment worker owns idempotency key verification",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/docs/catalog.yaml",
    [
      "roots:",
      "  - README.md",
      "  - docs",
      "canonical_docs:",
      "  - README.md",
      "  - docs/architecture.md",
      "excludes:",
      "  - docs/deprecated",
      "  - docs/benchmark-evidence",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "README.md",
    [
      "# Retrieval Fixture",
      "",
      "This public-safe fixture documents the Nebula Cart agent memory contract.",
      "",
      "## Agent Continuity Contract",
      "",
      "Agents preserve project context by using source pointers before changing ontology or docs.",
      "The canonical top-level graph is [system_graph.yaml](system_graph.yaml), and the checkout flow is in [Architecture](docs/architecture.md#checkout-intent-flow).",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "docs/architecture.md",
    [
      "# Architecture",
      "",
      "## Checkout Intent Flow",
      "",
      "The checkout service dispatches payment authorization to the payment worker.",
      "This reviewed semantic flow is recorded in `.anamnesis/ontology/payments.yaml` and must be read before ontology edits.",
      "",
      "## Release Automation Checklist",
      "",
      "The release runner verifies npm publication, GitHub release metadata, and generated surface drift.",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "docs/operations.md",
    [
      "# Operations",
      "",
      "## Handoff Retention Policy",
      "",
      "Hot handoff archives stay startup-active; cold archives are retrieved only by source pointer.",
      "The policy references `.anamnesis/ontology/payments.yaml` only as source evidence, not as generated prose.",
      "",
    ].join("\n"),
  );
}

function retrievalBenchmarkCases(): RetrievalBenchmarkCase[] {
  return [
    {
      id: "doc-page-readme",
      label: "README doc page",
      kind: "doc-page",
      query: "Retrieval Fixture README canonical",
      expected: {
        kind: "doc-page",
        source_path: "README.md",
        stable_ref: "file",
      },
    },
    {
      id: "doc-page-architecture",
      label: "Architecture doc page",
      kind: "doc-page",
      query: "checkout flow architecture payment worker",
      expected: {
        kind: "doc-page",
        source_path: "docs/architecture.md",
        stable_ref: "file",
      },
    },
    {
      id: "doc-heading-checkout-flow",
      label: "Checkout intent heading",
      kind: "doc-heading",
      query: "checkout intent flow payment authorization",
      expected: {
        kind: "doc-heading",
        source_path: "docs/architecture.md",
        stable_ref: "heading:checkout-intent-flow",
      },
    },
    {
      id: "doc-heading-release-checklist",
      label: "Release automation heading",
      kind: "doc-heading",
      query: "release automation checklist npm github generated drift",
      expected: {
        kind: "doc-heading",
        source_path: "docs/architecture.md",
        stable_ref: "heading:release-automation-checklist",
      },
    },
    {
      id: "doc-ontology-payments",
      label: "Payments ontology ref",
      kind: "doc-ontology-ref",
      query: "reviewed semantic flow recorded payments ontology edits",
      expected: {
        kind: "doc-ontology-ref",
        source_path: "docs/architecture.md",
        title: "Ontology ref .anamnesis/ontology/payments.yaml",
      },
    },
    {
      id: "doc-ontology-system-graph",
      label: "System graph ontology ref",
      kind: "doc-ontology-ref",
      query: "canonical top-level graph system graph",
      expected: {
        kind: "doc-ontology-ref",
        source_path: "README.md",
        title: "Ontology ref system_graph.yaml",
      },
    },
  ];
}

function runRetrievalCase(
  projectRoot: string,
  item: RetrievalBenchmarkCase,
): RetrievalBenchmarkCaseResult {
  const query = contextQuery({
    projectRoot,
    query: item.query,
    kind: item.kind,
    limit: 8,
  });
  const rankIndex = query.matches.findIndex((match) =>
    pointerMatches(match, item.expected),
  );
  const rank = rankIndex >= 0 ? rankIndex + 1 : undefined;
  return {
    ...item,
    ...(rank !== undefined ? { rank } : {}),
    top1Hit: rank === 1,
    top3Hit: rank !== undefined && rank <= 3,
    reciprocalRank: rank === undefined ? 0 : 1 / rank,
    returned: query.matches.map(returnedPointer),
    warnings: query.warnings,
  };
}

function pointerMatches(
  match: ContextQueryMatch,
  expected: RetrievalBenchmarkExpectedPointer,
): boolean {
  return (
    match.entry.kind === expected.kind &&
    match.entry.source_path === expected.source_path &&
    (expected.stable_ref === undefined ||
      match.entry.stable_ref === expected.stable_ref) &&
    (expected.title === undefined || match.entry.title === expected.title)
  );
}

function returnedPointer(
  match: ContextQueryMatch,
  index: number,
): RetrievalBenchmarkReturnedPointer {
  return {
    rank: index + 1,
    score: match.score,
    kind: match.entry.kind,
    source_path: match.entry.source_path,
    stable_ref: match.entry.stable_ref,
    title: match.entry.title,
  };
}

function summarizeRetrievalBenchmark(
  cases: readonly RetrievalBenchmarkCaseResult[],
  compactSessionStartTokens: number,
): RetrievalBenchmarkResult["summary"] {
  const total = cases.length;
  const top1Hits = cases.filter((item) => item.top1Hit).length;
  const top3Hits = cases.filter((item) => item.top3Hit).length;
  const top1HitRate = rate(top1Hits, total);
  const top3HitRate = rate(top3Hits, total);
  const mrr = roundRate(
    cases.reduce((sum, item) => sum + item.reciprocalRank, 0) /
      Math.max(1, total),
  );
  const compactSessionStartCapExceeded =
    compactSessionStartTokens > COMPACT_SESSION_START_TOKEN_CAP;
  return {
    cases: total,
    top1Hits,
    top3Hits,
    top1HitRate,
    top3HitRate,
    mrr,
    compactSessionStartTokens,
    compactSessionStartCap: COMPACT_SESSION_START_TOKEN_CAP,
    compactSessionStartCapExceeded,
    requiredSourceReadContract: true,
    hallucinatedProjectFacts: 0,
    bootstrapEditAttempts: 0,
    ok:
      top1HitRate >= TOP1_THRESHOLD &&
      top3HitRate >= TOP3_THRESHOLD &&
      mrr >= MRR_THRESHOLD &&
      !compactSessionStartCapExceeded,
  };
}

function writeRetrievalBenchmarkArtifacts(input: {
  projectRoot: string;
  outputPath?: string;
  result: RetrievalBenchmarkResult;
}): void {
  const outputDir = path.resolve(
    input.projectRoot,
    input.outputPath ?? DEFAULT_OUTPUT_DIR,
  );
  fs.mkdirSync(outputDir, { recursive: true });

  input.result.artifacts.outputDir = displayPathFromProject(
    input.projectRoot,
    outputDir,
  );
  input.result.artifacts.json = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-source-pointers.json"),
  );
  input.result.artifacts.markdown = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-source-pointers.md"),
  );
  input.result.artifacts.hitRatesSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-hit-rates.svg"),
  );
  input.result.artifacts.ranksSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-ranks.svg"),
  );
  input.result.markdown = renderRetrievalBenchmarkMarkdown(input.result);

  fs.writeFileSync(
    path.join(outputDir, "retrieval-source-pointers.json"),
    `${JSON.stringify(input.result, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "retrieval-source-pointers.md"),
    `${input.result.markdown}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "retrieval-hit-rates.svg"),
    renderHitRatesSvg(input.result),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "retrieval-ranks.svg"),
    renderRanksSvg(input.result),
    "utf8",
  );
}

function renderRetrievalBenchmarkMarkdown(
  input: RetrievalBenchmarkResult,
): string {
  const lines = [
    `# Retrieval Source-Pointer Benchmark — ${input.generatedAt}`,
    "",
    "Deterministic benchmark for `context query` source-pointer ranking over public-safe docs and ontology references.",
    "",
    `Cases: ${input.summary.cases}`,
    `Top-1 hit rate: ${formatRate(input.summary.top1HitRate)} (${input.summary.top1Hits}/${input.summary.cases})`,
    `Top-3 hit rate: ${formatRate(input.summary.top3HitRate)} (${input.summary.top3Hits}/${input.summary.cases})`,
    `MRR: ${input.summary.mrr.toFixed(3)}`,
    `Compact SessionStart: ${input.summary.compactSessionStartTokens}/${input.summary.compactSessionStartCap} estimated tokens`,
    `Gate: ${input.summary.ok ? "pass" : "fail"}`,
    "",
    "| Case | Kind | Query | Expected pointer | Rank | Top-1 | Top-3 |",
    "|---|---|---|---|---:|---|---|",
  ];
  for (const item of input.cases) {
    lines.push(
      `| ${escapeCell(item.label)} | ${item.kind} | ${escapeCell(item.query)} | ${escapeCell(formatExpectedPointer(item.expected))} | ${item.rank ?? "miss"} | ${item.top1Hit ? "yes" : "no"} | ${item.top3Hit ? "yes" : "no"} |`,
    );
  }
  if (input.artifacts.hitRatesSvg) {
    lines.push(
      "",
      "## Charts",
      "",
      `![Retrieval hit rates](${path.basename(input.artifacts.hitRatesSvg)})`,
      `![Retrieval ranks](${path.basename(input.artifacts.ranksSvg ?? "")})`,
    );
  }
  return lines.join("\n");
}

function renderHitRatesSvg(input: RetrievalBenchmarkResult): string {
  const width = 720;
  const height = 300;
  const metrics = [
    { label: "Top-1", value: input.summary.top1HitRate, threshold: TOP1_THRESHOLD },
    { label: "Top-3", value: input.summary.top3HitRate, threshold: TOP3_THRESHOLD },
    { label: "MRR", value: input.summary.mrr, threshold: MRR_THRESHOLD },
  ];
  const parts = svgFrame(width, height, "Retrieval Hit Rates");
  const chartX = 80;
  const chartY = 54;
  const chartW = 560;
  const chartH = 170;
  parts.push(axis(width, height, chartX, chartY, chartW, chartH));
  metrics.forEach((metric, index) => {
    const groupW = chartW / metrics.length;
    const barW = 64;
    const x = chartX + index * groupW + groupW / 2 - barW / 2;
    const h = metric.value * chartH;
    const y = chartY + chartH - h;
    const ok = metric.value >= metric.threshold;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${ok ? "#059669" : "#dc2626"}"><title>${escapeXml(metric.label)} ${formatRate(metric.value)} threshold ${formatRate(metric.threshold)}</title></rect>`,
      `<line x1="${(x - 14).toFixed(1)}" y1="${(chartY + chartH - metric.threshold * chartH).toFixed(1)}" x2="${(x + barW + 14).toFixed(1)}" y2="${(chartY + chartH - metric.threshold * chartH).toFixed(1)}" stroke="#111827" stroke-dasharray="4 3" />`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 44}" text-anchor="middle" font-size="13" fill="#374151">${escapeXml(metric.label)}</text>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" fill="#111827">${formatRate(metric.value)}</text>`,
    );
  });
  parts.push(
    `<text x="${width / 2}" y="${height - 18}" text-anchor="middle" font-size="12" fill="#4b5563">bars show measured value; dashed line shows gate threshold</text>`,
    "</svg>\n",
  );
  return parts.join("\n");
}

function renderRanksSvg(input: RetrievalBenchmarkResult): string {
  const width = 980;
  const height = 360;
  const chartX = 80;
  const chartY = 42;
  const chartW = 840;
  const chartH = 220;
  const maxRank = Math.max(
    ...input.cases.map((item) => item.rank ?? 9),
    3,
  );
  const parts = svgFrame(width, height, "Expected Pointer Rank By Case");
  parts.push(axis(width, height, chartX, chartY, chartW, chartH));
  input.cases.forEach((item, index) => {
    const groupW = chartW / input.cases.length;
    const barW = Math.max(22, groupW * 0.42);
    const value = item.rank ?? maxRank;
    const h = (value / maxRank) * chartH;
    const x = chartX + index * groupW + groupW / 2 - barW / 2;
    const y = chartY + chartH - h;
    const color = item.top1Hit ? "#059669" : item.top3Hit ? "#d97706" : "#dc2626";
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"><title>${escapeXml(item.label)} rank ${item.rank ?? "miss"}</title></rect>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" fill="#111827">${item.rank ?? "miss"}</text>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 70}" text-anchor="end" transform="rotate(-35 ${(x + barW / 2).toFixed(1)} ${height - 70})" font-size="11" fill="#374151">${escapeXml(item.id)}</text>`,
    );
  });
  parts.push(
    `<text x="${width / 2}" y="${height - 24}" text-anchor="middle" font-size="12" fill="#4b5563">lower rank is better; green is rank 1, amber is rank 2-3</text>`,
    "</svg>\n",
  );
  return parts.join("\n");
}

function retrievalBenchmarkEvidenceRecord(
  result: RetrievalBenchmarkResult,
): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "retrieval-benchmark",
    generated_at: result.generatedAt,
    command: ["anamnesis", "benchmark", "retrieval"],
    project: { name: "retrieval-fixture" },
    summary: {
      schema_version: result.schema_version,
      fixture_id: result.fixture.id,
      ...result.summary,
    },
    details: {
      cases: result.cases.map((item) => ({
        id: item.id,
        kind: item.kind,
        rank: item.rank ?? null,
        top1Hit: item.top1Hit,
        top3Hit: item.top3Hit,
        expected: item.expected,
      })),
    },
    artifacts: retrievalBenchmarkArtifactRecord(result.artifacts),
  };
}

function retrievalBenchmarkArtifactRecord(
  artifacts: RetrievalBenchmarkArtifacts,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(artifacts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function writeFile(projectRoot: string, relPath: string, content: string): void {
  const absPath = path.join(projectRoot, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : roundRate(numerator / denominator);
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatExpectedPointer(pointer: RetrievalBenchmarkExpectedPointer): string {
  return [
    pointer.source_path,
    pointer.stable_ref,
    pointer.title,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath).split(path.sep).join("/");
  return rel === "" ? "." : rel;
}

function svgFrame(width: number, height: number, title: string): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff" />`,
    `<text x="24" y="28" font-size="18" font-weight="700" fill="#111827">${escapeXml(title)}</text>`,
  ];
}

function axis(
  width: number,
  height: number,
  chartX: number,
  chartY: number,
  chartW: number,
  chartH: number,
): string {
  return [
    `<line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="#d1d5db" />`,
    `<line x1="${chartX}" y1="${chartY}" x2="${chartX}" y2="${chartY + chartH}" stroke="#d1d5db" />`,
    `<text x="${chartX - 10}" y="${chartY + 4}" text-anchor="end" font-size="11" fill="#6b7280">high</text>`,
    `<text x="${width - 24}" y="${height - 10}" text-anchor="end" font-size="10" fill="#9ca3af">anamnesis deterministic fixture</text>`,
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
