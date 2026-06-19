import * as fs from "node:fs";
import * as path from "node:path";

export const SESSION_CONTEXT_BENCHMARK_SCHEMA_VERSION =
  "anamnesis.session_context_benchmark.v1";

export type SessionContextMode = "full" | "compact";

export type SessionContextPayloadCategory =
  | "system_graph"
  | "ontology"
  | "handoff_active"
  | "handoff_archive"
  | "instructions"
  | "source_pointers"
  | "invariant_digest";

export interface SessionContextBenchmarkOptions {
  projectRoot: string;
  write?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export interface SessionContextBenchmarkMetric {
  fixtureId: string;
  fixtureLabel: string;
  mode: SessionContextMode;
  startupChars: number;
  startupLines: number;
  estimatedTokens: number;
  includedFileBytes: number;
  sourcePointers: number;
  requiredRulesPresent: number;
  requiredRulesTotal: number;
  hardCapTokens: number;
  capExceeded: boolean;
  payloadComposition: Record<SessionContextPayloadCategory, number>;
}

export interface SessionContextBenchmarkFixtureResult {
  id: string;
  label: string;
  fileBytes: number;
  hardCapTokens: number;
  requiredRules: string[];
  metrics: Record<SessionContextMode, SessionContextBenchmarkMetric>;
  compactReductionPct: number;
}

export interface SessionContextBenchmarkArtifacts {
  outputDir?: string;
  json?: string;
  markdown?: string;
  tokenByModeSvg?: string;
  payloadCompositionSvg?: string;
  fixtureGrowthSvg?: string;
  capSuccessSummarySvg?: string;
}

export interface SessionContextBenchmarkResult {
  schema_version: typeof SESSION_CONTEXT_BENCHMARK_SCHEMA_VERSION;
  generatedAt: string;
  fixtures: SessionContextBenchmarkFixtureResult[];
  summary: {
    fixtures: number;
    compactRequiredRulePasses: number;
    compactRequiredRuleTotal: number;
    compactSourcePointerFixtures: number;
    largeFixtureCompactReductionPct: number;
    compactCapExceeded: number;
    fullCapExceeded: number;
  };
  markdown: string;
  artifacts: SessionContextBenchmarkArtifacts;
}

export class SessionContextBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionContextBenchmarkError";
  }
}

interface SessionContextFixtureFile {
  path: string;
  category:
    | "system_graph"
    | "ontology"
    | "handoff_active"
    | "handoff_archive";
  content: string;
}

interface SessionContextFixture {
  id: string;
  label: string;
  hardCapTokens: number;
  requiredRules: string[];
  files: SessionContextFixtureFile[];
}

interface RenderedPayload {
  text: string;
  sourcePointers: number;
  includedFileBytes: number;
  payloadComposition: Record<SessionContextPayloadCategory, number>;
}

const PAYLOAD_CATEGORIES: SessionContextPayloadCategory[] = [
  "system_graph",
  "ontology",
  "handoff_active",
  "handoff_archive",
  "instructions",
  "source_pointers",
  "invariant_digest",
];

export function sessionContextBenchmark(
  opts: SessionContextBenchmarkOptions,
): SessionContextBenchmarkResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fixtures = benchmarkFixtures().map((fixture) =>
    benchmarkFixture(fixture),
  );
  const summary = benchmarkSummary(fixtures);
  const artifacts: SessionContextBenchmarkArtifacts = {};
  const resultBase = {
    schema_version: SESSION_CONTEXT_BENCHMARK_SCHEMA_VERSION,
    generatedAt,
    fixtures,
    summary,
    artifacts,
  } satisfies Omit<SessionContextBenchmarkResult, "markdown">;
  const markdown = renderBenchmarkMarkdown(resultBase);
  const result: SessionContextBenchmarkResult = {
    ...resultBase,
    markdown,
  };

  if (opts.write === true) {
    writeBenchmarkArtifacts({
      projectRoot,
      outputPath: opts.outputPath,
      result,
    });
  }

  return result;
}

function benchmarkFixture(
  fixture: SessionContextFixture,
): SessionContextBenchmarkFixtureResult {
  const full = metricForFixture(fixture, "full");
  const compact = metricForFixture(fixture, "compact");
  const compactReductionPct =
    full.estimatedTokens === 0
      ? 0
      : Math.round(
          ((full.estimatedTokens - compact.estimatedTokens) /
            full.estimatedTokens) *
            100,
        );
  return {
    id: fixture.id,
    label: fixture.label,
    fileBytes: fixture.files.reduce(
      (sum, file) => sum + byteLength(file.content),
      0,
    ),
    hardCapTokens: fixture.hardCapTokens,
    requiredRules: fixture.requiredRules,
    metrics: { full, compact },
    compactReductionPct,
  };
}

function metricForFixture(
  fixture: SessionContextFixture,
  mode: SessionContextMode,
): SessionContextBenchmarkMetric {
  const rendered = renderFixturePayload(fixture, mode);
  const startupChars = rendered.text.length;
  const startupLines = rendered.text.length === 0
    ? 0
    : rendered.text.split(/\r?\n/).length;
  const estimatedTokens = estimateTokens(rendered.text);
  return {
    fixtureId: fixture.id,
    fixtureLabel: fixture.label,
    mode,
    startupChars,
    startupLines,
    estimatedTokens,
    includedFileBytes: rendered.includedFileBytes,
    sourcePointers: rendered.sourcePointers,
    requiredRulesPresent: fixture.requiredRules.filter((rule) =>
      rendered.text.includes(rule),
    ).length,
    requiredRulesTotal: fixture.requiredRules.length,
    hardCapTokens: fixture.hardCapTokens,
    capExceeded: estimatedTokens > fixture.hardCapTokens,
    payloadComposition: rendered.payloadComposition,
  };
}

function renderFixturePayload(
  fixture: SessionContextFixture,
  mode: SessionContextMode,
): RenderedPayload {
  const composition = emptyComposition();
  const ontologyFiles = fixture.files.filter((file) =>
    file.category === "system_graph" || file.category === "ontology",
  );
  const handoffFiles = fixture.files.filter((file) =>
    file.category === "handoff_active" || file.category === "handoff_archive",
  );
  const sections: string[] = [];
  let sourcePointers = 0;
  let includedFileBytes = 0;

  const pushInstruction = (text: string): void => {
    sections.push(text);
    composition.instructions += byteLength(text);
  };
  const pushPointer = (file: SessionContextFixtureFile): void => {
    const pointer = `- ${file.path} (${byteLength(file.content)} bytes, ${lineCount(
      file.content,
    )} lines)`;
    sections.push(pointer);
    composition.source_pointers += byteLength(pointer);
    sourcePointers++;
  };
  const pushFileBody = (file: SessionContextFixtureFile): void => {
    const title = `--- ${file.path} ---`;
    const body = `${title}\n${file.content.trimEnd()}`;
    sections.push(body);
    composition[file.category] += byteLength(file.content);
    includedFileBytes += byteLength(file.content);
  };

  pushInstruction(
    "=== anamnesis: session context benchmark fixture ===\nRead exact source files before relying on project invariants.",
  );

  if (mode === "full") {
    for (const file of fixture.files) {
      pushFileBody(file);
    }
    return {
      text: sections.join("\n\n"),
      sourcePointers,
      includedFileBytes,
      payloadComposition: composition,
    };
  }

  pushInstruction(
    "Mode: compact\nSource pointers are the retrieval contract; the digest below is only a startup hint.",
  );
  for (const file of fixture.files) {
    pushPointer(file);
  }

  const digest = invariantDigest(ontologyFiles);
  const digestText =
    digest.length > 0
      ? `Invariant digest:\n${digest.join("\n")}`
      : "Invariant digest:\n- (none detected; use source pointers)";
  sections.push(digestText);
  composition.invariant_digest += byteLength(digestText);

  const active = handoffFiles.find((file) => file.category === "handoff_active");
  const summary = active ? activeHandoffSummary(active.content) : [];
  if (summary.length > 0) {
    const text = `Active task summary:\n${summary.join("\n")}`;
    sections.push(text);
    composition.handoff_active += byteLength(text);
  }

  pushInstruction(
    "Retrieval rule: read the referenced files before continuing non-trivial in-flight work.",
  );

  return {
    text: sections.join("\n\n"),
    sourcePointers,
    includedFileBytes,
    payloadComposition: composition,
  };
}

function benchmarkSummary(fixtures: SessionContextBenchmarkFixtureResult[]) {
  const compactMetrics = fixtures.map((fixture) => fixture.metrics.compact);
  const fullMetrics = fixtures.map((fixture) => fixture.metrics.full);
  const compactRequiredRulePasses = compactMetrics.reduce(
    (sum, metric) => sum + metric.requiredRulesPresent,
    0,
  );
  const compactRequiredRuleTotal = compactMetrics.reduce(
    (sum, metric) => sum + metric.requiredRulesTotal,
    0,
  );
  const large =
    fixtures.find((fixture) => fixture.id === "large-ontology") ??
    fixtures.at(-1);
  return {
    fixtures: fixtures.length,
    compactRequiredRulePasses,
    compactRequiredRuleTotal,
    compactSourcePointerFixtures: compactMetrics.filter(
      (metric) => metric.sourcePointers > 0,
    ).length,
    largeFixtureCompactReductionPct: large?.compactReductionPct ?? 0,
    compactCapExceeded: compactMetrics.filter((metric) => metric.capExceeded)
      .length,
    fullCapExceeded: fullMetrics.filter((metric) => metric.capExceeded).length,
  };
}

function writeBenchmarkArtifacts(input: {
  projectRoot: string;
  outputPath?: string;
  result: SessionContextBenchmarkResult;
}): void {
  const outputDir = path.resolve(
    input.projectRoot,
    input.outputPath ?? path.join("docs", "benchmark-evidence", "session-context"),
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const artifacts = input.result.artifacts;
  artifacts.outputDir = displayPathFromProject(input.projectRoot, outputDir);
  artifacts.json = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "session-context.json"),
  );
  artifacts.markdown = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "session-context.md"),
  );
  artifacts.tokenByModeSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "token-by-mode.svg"),
  );
  artifacts.payloadCompositionSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "payload-composition.svg"),
  );
  artifacts.fixtureGrowthSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "fixture-growth.svg"),
  );
  artifacts.capSuccessSummarySvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "cap-success-summary.svg"),
  );
  input.result.markdown = renderBenchmarkMarkdown(input.result);

  fs.writeFileSync(
    path.join(outputDir, "session-context.json"),
    `${JSON.stringify(input.result, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "session-context.md"),
    `${input.result.markdown}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "token-by-mode.svg"),
    renderTokenByModeSvg(input.result.fixtures),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "payload-composition.svg"),
    renderPayloadCompositionSvg(input.result.fixtures),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "fixture-growth.svg"),
    renderFixtureGrowthSvg(input.result.fixtures),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "cap-success-summary.svg"),
    renderCapSuccessSummarySvg(input.result.fixtures),
    "utf8",
  );
}

function renderBenchmarkMarkdown(input: {
  generatedAt: string;
  fixtures: SessionContextBenchmarkFixtureResult[];
  summary: SessionContextBenchmarkResult["summary"];
  artifacts: SessionContextBenchmarkArtifacts;
}): string {
  const lines = [
    `# Session Context Benchmark — ${input.generatedAt}`,
    "",
    "Deterministic benchmark comparing full SessionStart file injection with compact source-pointer startup context.",
    "",
    `Fixtures: ${input.summary.fixtures}`,
    `Compact required rules present: ${input.summary.compactRequiredRulePasses}/${input.summary.compactRequiredRuleTotal}`,
    `Large fixture compact token reduction: ${input.summary.largeFixtureCompactReductionPct}%`,
    `Cap exceeded: compact ${input.summary.compactCapExceeded}, full ${input.summary.fullCapExceeded}`,
    "",
    "| Fixture | Full tokens | Compact tokens | Reduction | Compact source pointers | Compact cap | Required rules |",
    "|---|---:|---:|---:|---:|---|---:|",
  ];
  for (const fixture of input.fixtures) {
    const full = fixture.metrics.full;
    const compact = fixture.metrics.compact;
    lines.push(
      `| ${fixture.label} | ${full.estimatedTokens} | ${compact.estimatedTokens} | ${fixture.compactReductionPct}% | ${compact.sourcePointers} | ${compact.capExceeded ? "exceeded" : "ok"} | ${compact.requiredRulesPresent}/${compact.requiredRulesTotal} |`,
    );
  }
  if (input.artifacts.tokenByModeSvg) {
    lines.push(
      "",
      "## Charts",
      "",
      `![Token by mode](${path.basename(input.artifacts.tokenByModeSvg)})`,
      `![Payload composition](${path.basename(input.artifacts.payloadCompositionSvg ?? "")})`,
      `![Fixture growth](${path.basename(input.artifacts.fixtureGrowthSvg ?? "")})`,
      `![Cap success summary](${path.basename(input.artifacts.capSuccessSummarySvg ?? "")})`,
    );
  }
  return lines.join("\n");
}

function renderTokenByModeSvg(
  fixtures: SessionContextBenchmarkFixtureResult[],
): string {
  const width = 980;
  const height = 360;
  const margin = { top: 36, right: 24, bottom: 92, left: 64 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const max = Math.max(
    ...fixtures.flatMap((fixture) => [
      fixture.metrics.full.estimatedTokens,
      fixture.metrics.compact.estimatedTokens,
    ]),
    1,
  );
  const groupW = chartW / fixtures.length;
  const barW = Math.max(12, groupW * 0.26);
  const parts = svgFrame(width, height, "Session Context Tokens By Mode");
  parts.push(axis(width, height, margin));
  fixtures.forEach((fixture, i) => {
    const x0 = margin.left + i * groupW + groupW * 0.22;
    const bars = [
      { mode: "full", value: fixture.metrics.full.estimatedTokens, color: "#7c3aed" },
      { mode: "compact", value: fixture.metrics.compact.estimatedTokens, color: "#059669" },
    ] as const;
    bars.forEach((bar, j) => {
      const h = (bar.value / max) * chartH;
      const x = x0 + j * (barW + 6);
      const y = margin.top + chartH - h;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${bar.color}"><title>${escapeXml(fixture.label)} ${bar.mode}: ${bar.value} tokens</title></rect>`,
      );
    });
    parts.push(
      `<text x="${(x0 + barW).toFixed(1)}" y="${height - 58}" text-anchor="end" transform="rotate(-35 ${(x0 + barW).toFixed(1)} ${height - 58})" font-size="11" fill="#374151">${escapeXml(fixture.id)}</text>`,
    );
  });
  parts.push(legend([
    ["Full", "#7c3aed"],
    ["Compact", "#059669"],
  ]));
  parts.push("</svg>\n");
  return parts.join("\n");
}

function renderPayloadCompositionSvg(
  fixtures: SessionContextBenchmarkFixtureResult[],
): string {
  const width = 1120;
  const height = 420;
  const margin = { top: 36, right: 24, bottom: 118, left: 72 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const bars = fixtures.flatMap((fixture) => [
    { fixture, mode: "full" as const, metric: fixture.metrics.full },
    { fixture, mode: "compact" as const, metric: fixture.metrics.compact },
  ]);
  const max = Math.max(
    ...bars.map((bar) =>
      PAYLOAD_CATEGORIES.reduce(
        (sum, category) => sum + bar.metric.payloadComposition[category],
        0,
      ),
    ),
    1,
  );
  const barW = Math.max(12, chartW / bars.length - 8);
  const colors: Record<SessionContextPayloadCategory, string> = {
    system_graph: "#2563eb",
    ontology: "#0f766e",
    handoff_active: "#d97706",
    handoff_archive: "#b45309",
    instructions: "#64748b",
    source_pointers: "#16a34a",
    invariant_digest: "#9333ea",
  };
  const parts = svgFrame(width, height, "Payload Composition Bytes");
  parts.push(axis(width, height, margin));
  bars.forEach((bar, i) => {
    const x = margin.left + i * (chartW / bars.length) + 3;
    let y = margin.top + chartH;
    for (const category of PAYLOAD_CATEGORIES) {
      const value = bar.metric.payloadComposition[category];
      if (value === 0) continue;
      const h = (value / max) * chartH;
      y -= h;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${colors[category]}"><title>${escapeXml(bar.fixture.label)} ${bar.mode} ${category}: ${value} bytes</title></rect>`,
      );
    }
    parts.push(
      `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 72}" text-anchor="end" transform="rotate(-45 ${(x + barW / 2).toFixed(1)} ${height - 72})" font-size="10" fill="#374151">${escapeXml(`${bar.fixture.id}-${bar.mode}`)}</text>`,
    );
  });
  parts.push(legend(PAYLOAD_CATEGORIES.map((category) => [category, colors[category]])));
  parts.push("</svg>\n");
  return parts.join("\n");
}

function renderFixtureGrowthSvg(
  fixtures: SessionContextBenchmarkFixtureResult[],
): string {
  const width = 980;
  const height = 360;
  const margin = { top: 36, right: 24, bottom: 82, left: 64 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const sorted = [...fixtures].sort((a, b) => a.fileBytes - b.fileBytes);
  const maxBytes = Math.max(...sorted.map((fixture) => fixture.fileBytes), 1);
  const maxTokens = Math.max(
    ...sorted.flatMap((fixture) => [
      fixture.metrics.full.estimatedTokens,
      fixture.metrics.compact.estimatedTokens,
    ]),
    1,
  );
  const point = (
    fixture: SessionContextBenchmarkFixtureResult,
    mode: SessionContextMode,
  ) => {
    const x = margin.left + (fixture.fileBytes / maxBytes) * chartW;
    const y =
      margin.top +
      chartH -
      (fixture.metrics[mode].estimatedTokens / maxTokens) * chartH;
    return { x, y };
  };
  const parts = svgFrame(width, height, "Fixture Size Growth");
  parts.push(axis(width, height, margin));
  for (const mode of ["full", "compact"] as const) {
    const color = mode === "full" ? "#7c3aed" : "#059669";
    const d = sorted
      .map((fixture, i) => {
        const p = point(fixture, mode);
        return `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" />`);
    for (const fixture of sorted) {
      const p = point(fixture, mode);
      parts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}"><title>${escapeXml(fixture.label)} ${mode}: ${fixture.metrics[mode].estimatedTokens} tokens</title></circle>`,
      );
    }
  }
  parts.push(legend([
    ["Full", "#7c3aed"],
    ["Compact", "#059669"],
  ]));
  parts.push(
    `<text x="${width / 2}" y="${height - 28}" text-anchor="middle" font-size="12" fill="#4b5563">fixture source bytes</text>`,
  );
  parts.push("</svg>\n");
  return parts.join("\n");
}

function renderCapSuccessSummarySvg(
  fixtures: SessionContextBenchmarkFixtureResult[],
): string {
  const rowH = 34;
  const width = 840;
  const height = 86 + fixtures.length * rowH;
  const cols = [
    { id: "compact-rules", label: "Compact rules" },
    { id: "compact-cap", label: "Compact cap" },
    { id: "full-cap", label: "Full cap" },
  ] as const;
  const parts = svgFrame(width, height, "Cap And Success Summary");
  cols.forEach((col, i) => {
    parts.push(
      `<text x="${360 + i * 135}" y="54" text-anchor="middle" font-size="12" fill="#111827">${escapeXml(col.label)}</text>`,
    );
  });
  fixtures.forEach((fixture, row) => {
    const y = 76 + row * rowH;
    parts.push(
      `<text x="28" y="${y + 21}" font-size="12" fill="#374151">${escapeXml(fixture.label)}</text>`,
    );
    const statuses = [
      fixture.metrics.compact.requiredRulesPresent ===
        fixture.metrics.compact.requiredRulesTotal,
      !fixture.metrics.compact.capExceeded,
      !fixture.metrics.full.capExceeded,
    ];
    statuses.forEach((ok, i) => {
      const x = 315 + i * 135;
      parts.push(
        `<rect x="${x}" y="${y}" width="90" height="24" rx="3" fill="${ok ? "#dcfce7" : "#fee2e2"}" stroke="${ok ? "#16a34a" : "#dc2626"}" />`,
      );
      parts.push(
        `<text x="${x + 45}" y="${y + 16}" text-anchor="middle" font-size="11" fill="${ok ? "#166534" : "#991b1b"}">${ok ? "ok" : "fail"}</text>`,
      );
    });
  });
  parts.push("</svg>\n");
  return parts.join("\n");
}

function benchmarkFixtures(): SessionContextFixture[] {
  return [
    {
      id: "tiny",
      label: "Tiny project",
      hardCapTokens: 320,
      requiredRules: ["must preserve user edits"],
      files: [
        {
          path: "system_graph.yaml",
          category: "system_graph",
          content: yamlLines([
            "schema_version: anamnesis.system_graph.v1",
            "invariants:",
            "  - id: preserve-user-edits",
            "    rule: must preserve user edits",
          ]),
        },
        {
          path: ".anamnesis/ontology/base.yaml",
          category: "ontology",
          content: yamlLines([
            "schema_version: 1",
            "entities:",
            "  - agent context surfaces",
          ]),
        },
      ],
    },
    {
      id: "normal",
      label: "Normal handoff",
      hardCapTokens: 520,
      requiredRules: ["must read active handoff before resuming"],
      files: [
        {
          path: "system_graph.yaml",
          category: "system_graph",
          content: yamlLines([
            "schema_version: anamnesis.system_graph.v1",
            "operational_notes:",
            "  - rule: must read active handoff before resuming",
          ]),
        },
        ontologyFile("base", "must keep generated regions managed"),
        activeHandoffFile(
          "normal resume",
          ".anamnesis/handoff/2026-06-01T00-00-00Z.md",
        ),
        archivedHandoffFile("normal resume", 16),
      ],
    },
    {
      id: "large-ontology",
      label: "Large ontology",
      hardCapTokens: 900,
      requiredRules: ["must verify source pointers before changing adapters"],
      files: [
        {
          path: "system_graph.yaml",
          category: "system_graph",
          content: yamlLines([
            "schema_version: anamnesis.system_graph.v1",
            "invariants:",
            "  - rule: must verify source pointers before changing adapters",
            ...repeatedYaml("  - note: sanitized architecture relationship", 120),
          ]),
        },
        ontologyFile(
          "base",
          "must keep executable adapters explicit",
          90,
        ),
        ontologyFile("k8s", "must not infer secrets from manifests", 90),
        activeHandoffFile(
          "large ontology migration",
          ".anamnesis/handoff/2026-06-02T00-00-00Z.md",
        ),
        archivedHandoffFile("large ontology migration", 180),
      ],
    },
    {
      id: "stale-handoff",
      label: "Stale handoff",
      hardCapTokens: 520,
      requiredRules: ["must check git history before trusting stale handoff"],
      files: [
        ontologyFile(
          "base",
          "must check git history before trusting stale handoff",
        ),
        activeHandoffFile(
          "stale handoff review",
          ".anamnesis/handoff/old.md",
        ),
        archivedHandoffFile("stale handoff review", 28),
      ],
    },
    {
      id: "conflicting-ontology",
      label: "Conflicting ontology",
      hardCapTokens: 620,
      requiredRules: ["must flag contradictory ontology claims"],
      files: [
        ontologyFile("service-a", "must flag contradictory ontology claims", 24),
        ontologyFile("service-b", "must flag contradictory ontology claims", 24),
        {
          path: ".anamnesis/ontology/service-b.enriched.yaml",
          category: "ontology",
          content: yamlLines([
            "schema_version: anamnesis.enriched.v1",
            "open_questions:",
            "  - question: rule says service-b owns writes; service-a says service-a owns writes",
          ]),
        },
      ],
    },
    {
      id: "missing-handoff",
      label: "Missing handoff",
      hardCapTokens: 420,
      requiredRules: ["must continue without inventing missing handoff state"],
      files: [
        {
          path: "system_graph.yaml",
          category: "system_graph",
          content: yamlLines([
            "schema_version: anamnesis.system_graph.v1",
            "invariants:",
            "  - rule: must continue without inventing missing handoff state",
          ]),
        },
        ontologyFile("base", "always cite source files for context"),
      ],
    },
    {
      id: "multi-scope",
      label: "Multi-scope repo",
      hardCapTokens: 680,
      requiredRules: ["must preserve scope-specific ontology boundaries"],
      files: [
        ontologyFile("base", "must preserve scope-specific ontology boundaries"),
        {
          path: "apps/api/.anamnesis/ontology/fastapi.yaml",
          category: "ontology",
          content: yamlLines([
            "schema_version: 1",
            "scope: apps/api",
            "invariants:",
            "  - rule: must preserve scope-specific ontology boundaries",
          ]),
        },
        {
          path: "apps/web/.anamnesis/ontology/nextjs.yaml",
          category: "ontology",
          content: yamlLines([
            "schema_version: 1",
            "scope: apps/web",
            "rules:",
            "  - always keep frontend and backend context separate",
          ]),
        },
      ],
    },
  ];
}

function ontologyFile(
  id: string,
  rule: string,
  fillerLines = 8,
): SessionContextFixtureFile {
  return {
    path: `.anamnesis/ontology/${id}.yaml`,
    category: "ontology",
    content: yamlLines([
      "schema_version: 1",
      `fragment: ${id}`,
      "invariants:",
      `  - rule: ${rule}`,
      ...repeatedYaml("  - fact: sanitized deterministic context fact", fillerLines),
    ]),
  };
}

function activeHandoffFile(
  focus: string,
  archivePath: string,
): SessionContextFixtureFile {
  return {
    path: ".anamnesis/handoff/active.md",
    category: "handoff_active",
    content: [
      "# Active handoff index",
      "",
      "## Current focus",
      `- ${focus} - archive: \`${archivePath}\``,
      "",
      "## Active tasks",
      `- [in-flight] ${focus} - next: read source pointers - archive: \`${archivePath}\``,
      "",
    ].join("\n"),
  };
}

function archivedHandoffFile(
  focus: string,
  fillerLines: number,
): SessionContextFixtureFile {
  return {
    path: ".anamnesis/handoff/2026-06-01T00-00-00Z.md",
    category: "handoff_archive",
    content: [
      `# Handoff - ${focus}`,
      "",
      "## Goal",
      "Resume the sanitized benchmark task with enough source context.",
      "",
      "## Decisions",
      "- must read active handoff before continuing non-trivial work",
      ...Array.from(
        { length: fillerLines },
        (_, i) => `- sanitized archive detail ${i + 1}`,
      ),
      "",
    ].join("\n"),
  };
}

function invariantDigest(files: SessionContextFixtureFile[]): string[] {
  const pattern =
    /(must|never|always|invariant|rule|severity:\s*"?must|필수|금지|항상|절대)/i;
  const out: string[] = [];
  for (const file of files) {
    for (const line of file.content.split(/\r?\n/)) {
      if (!pattern.test(line)) continue;
      out.push(`- ${file.path}: ${line.trimStart()}`);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

function activeHandoffSummary(content: string): string[] {
  const out: string[] = [];
  let inSummarySection = false;
  for (const line of content.split(/\r?\n/)) {
    if (line === "## Current focus" || line === "## Active tasks") {
      inSummarySection = true;
      continue;
    }
    if (line.startsWith("## ")) {
      inSummarySection = false;
      continue;
    }
    if (inSummarySection && line.startsWith("- ")) {
      out.push(line);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function emptyComposition(): Record<SessionContextPayloadCategory, number> {
  return Object.fromEntries(
    PAYLOAD_CATEGORIES.map((category) => [category, 0]),
  ) as Record<SessionContextPayloadCategory, number>;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function repeatedYaml(line: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${line} ${i + 1}`);
}

function yamlLines(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function svgFrame(width: number, height: number, title: string): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff" />`,
    `<text x="24" y="24" font-size="18" font-family="Arial, sans-serif" font-weight="700" fill="#111827">${escapeXml(title)}</text>`,
  ];
}

function axis(
  width: number,
  height: number,
  margin: { top: number; right: number; bottom: number; left: number },
): string {
  const x1 = margin.left;
  const y1 = height - margin.bottom;
  const x2 = width - margin.right;
  return [
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="#d1d5db" />`,
    `<line x1="${x1}" y1="${margin.top}" x2="${x1}" y2="${y1}" stroke="#d1d5db" />`,
  ].join("\n");
}

function legend(entries: Array<readonly [string, string]>): string {
  return entries
    .map(([label, color], i) => {
      const x = 24 + (i % 4) * 210;
      const y = 44 + Math.floor(i / 4) * 18;
      return [
        `<rect x="${x}" y="${y}" width="11" height="11" fill="${color}" />`,
        `<text x="${x + 16}" y="${y + 10}" font-size="11" font-family="Arial, sans-serif" fill="#374151">${escapeXml(label)}</text>`,
      ].join("\n");
    })
    .join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}
