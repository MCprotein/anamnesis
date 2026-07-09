import * as fs from "node:fs";
import * as path from "node:path";
import {
  findAgentfile,
  readAgentfile,
} from "../core/agentfile.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import {
  type SessionContextBudgetSource,
} from "./session_context_budget.js";
import {
  contextSubagentPreamble,
  type ContextSubagentPreambleResult,
} from "./context_resume.js";

export const SUBAGENT_INJECTION_BENCHMARK_SCHEMA_VERSION =
  "anamnesis.subagent_injection_benchmark.v1";

export const SUBAGENT_INJECTION_BENCHMARK_OUTPUT_DIR =
  "docs/benchmark-evidence/subagent-injection";

export type SubagentContextLaneId =
  | "separate-process-startup"
  | "same-session-prompt-contract";

export type SubagentContextEnforcement =
  | "startup-hook-or-wrapper"
  | "prompt-contract";

export type SubagentInjectionAttemptStatus =
  | "injected"
  | "missed"
  | "accepted"
  | "rejected";

export interface SubagentInjectionBenchmarkCheck {
  id: string;
  label: string;
  status: "pass" | "fail";
  detail: string;
}

export interface SubagentInjectionBenchmarkSource {
  path: string;
  kind:
    | SessionContextBudgetSource["kind"]
    | "agent-control"
    | "codex-skill";
  bytes: number;
  lines: number;
}

export interface SubagentInjectionBenchmarkAttempt {
  laneId: SubagentContextLaneId;
  laneLabel: string;
  enforcement: SubagentContextEnforcement;
  iteration: number;
  injectionEligible: boolean;
  status: SubagentInjectionAttemptStatus;
  sourcePointers: number;
  evidenceSources: string[];
  checks: SubagentInjectionBenchmarkCheck[];
}

export interface SubagentInjectionBenchmarkLaneSummary {
  laneId: SubagentContextLaneId;
  label: string;
  enforcement: SubagentContextEnforcement;
  attempts: number;
  injectionEligibleAttempts: number;
  injected: number;
  missed: number;
  accepted: number;
  rejected: number;
  injectionRatePct: number | null;
  contractPassRatePct: number | null;
}

export interface SubagentInjectionBenchmarkArtifacts {
  outputDir?: string;
  json?: string;
  markdown?: string;
  countsSvg?: string;
  ratesSvg?: string;
}

export interface SubagentInjectionBenchmarkResult {
  schemaVersion: typeof SUBAGENT_INJECTION_BENCHMARK_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  requestedAttempts: number;
  ok: boolean;
  summary: {
    lanes: number;
    attempts: number;
    injectionEligibleAttempts: number;
    injected: number;
    missed: number;
    injectionRatePct: number | null;
    contractAttempts: number;
    contractAccepted: number;
    contractRejected: number;
    contractPassRatePct: number | null;
  };
  lanes: SubagentInjectionBenchmarkLaneSummary[];
  attempts: SubagentInjectionBenchmarkAttempt[];
  artifacts: SubagentInjectionBenchmarkArtifacts;
  markdown?: string;
  evidencePath?: string;
}

export interface SubagentInjectionBenchmarkOptions {
  projectRoot: string;
  attempts?: number;
  write?: boolean;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class SubagentInjectionBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubagentInjectionBenchmarkError";
  }
}

export function subagentInjectionBenchmark(
  opts: SubagentInjectionBenchmarkOptions,
): SubagentInjectionBenchmarkResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const requestedAttempts = opts.attempts ?? 20;
  if (!Number.isInteger(requestedAttempts) || requestedAttempts < 1) {
    throw new SubagentInjectionBenchmarkError(
      "--attempts requires a positive integer",
    );
  }

  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const stableNow = () => new Date(generatedAt);
  const attempts: SubagentInjectionBenchmarkAttempt[] = [];

  for (let iteration = 1; iteration <= requestedAttempts; iteration += 1) {
    const preamble = contextSubagentPreamble({ projectRoot, now: stableNow });
    attempts.push(startupAttempt({ preamble, iteration }));

    const contractSources = collectContractSources(
      projectRoot,
      preamble.startupSources,
    );
    attempts.push(contractAttempt({ contractSources, iteration }));
  }

  const lanes = summarizeLanes(attempts);
  const summary = summarizeBenchmark(lanes);
  let result: SubagentInjectionBenchmarkResult = {
    schemaVersion: SUBAGENT_INJECTION_BENCHMARK_SCHEMA_VERSION,
    projectRoot,
    generatedAt,
    requestedAttempts,
    ok: summary.missed === 0 && summary.contractRejected === 0,
    summary,
    lanes,
    attempts,
    artifacts: {},
  };
  result = { ...result, markdown: renderSubagentInjectionMarkdown(result) };

  if (opts.write === true) {
    const artifacts = writeSubagentInjectionArtifacts({
      projectRoot,
      outputPath: opts.outputPath,
      result,
    });
    result = {
      ...result,
      projectRoot: displayPathFromProject(projectRoot, projectRoot),
      artifacts,
      markdown: renderSubagentInjectionMarkdown({ ...result, artifacts }),
    };
    fs.writeFileSync(
      artifactPath(projectRoot, artifacts.json!),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      artifactPath(projectRoot, artifacts.markdown!),
      `${result.markdown}\n`,
      "utf8",
    );
  }

  if (opts.append === true) {
    const evidencePath = appendEvidenceRecord(
      projectRoot,
      subagentInjectionBenchmarkEvidenceRecord(result, projectRoot),
    );
    result = { ...result, evidencePath };
  }

  return result;
}

function startupAttempt(input: {
  preamble: ContextSubagentPreambleResult;
  iteration: number;
}): SubagentInjectionBenchmarkAttempt {
  const startupSources = input.preamble.startupSources;
  const checks: SubagentInjectionBenchmarkCheck[] = [
    {
      id: "startup-sources",
      label: "Startup source pointers",
      status: startupSources.length > 0 ? "pass" : "fail",
      detail:
        startupSources.length > 0
          ? `${startupSources.length} startup-active source pointer(s)`
          : "no startup-active anamnesis sources found",
    },
    {
      id: "launcher-wrapper-preamble",
      label: "Launcher wrapper preamble",
      status: input.preamble.preamble.includes("enforcement: launcher-wrapper")
        ? "pass"
        : "fail",
      detail: "external subagent hydration preamble labels the enforceable lane",
    },
    {
      id: "required-response-contract",
      label: "Required response contract",
      status: input.preamble.preamble.includes("anamnesis_context_sources")
        ? "pass"
        : "fail",
      detail: "preamble requires subagents to report exact context sources",
    },
  ];
  const pass = checks.every((check) => check.status === "pass");
  return {
    laneId: "separate-process-startup",
    laneLabel: "Separate process startup",
    enforcement: "startup-hook-or-wrapper",
    iteration: input.iteration,
    injectionEligible: true,
    status: pass ? "injected" : "missed",
    sourcePointers: startupSources.length,
    evidenceSources: startupSources.map((source) => source.path),
    checks,
  };
}

function contractAttempt(input: {
  contractSources: SubagentInjectionBenchmarkSource[];
  iteration: number;
}): SubagentInjectionBenchmarkAttempt {
  const prompt = renderSubagentContextContract(input.contractSources);
  const checks: SubagentInjectionBenchmarkCheck[] = [
    {
      id: "contract-sources",
      label: "Contract source evidence",
      status: input.contractSources.length > 0 ? "pass" : "fail",
      detail:
        input.contractSources.length > 0
          ? `${input.contractSources.length} required source evidence pointer(s)`
          : "no source evidence pointers available for subagent contract",
    },
    {
      id: "all-sources-listed",
      label: "All source pointers listed",
      status: input.contractSources.every((source) =>
          prompt.includes(source.path)
        )
        ? "pass"
        : "fail",
      detail: "contract prompt lists every required source pointer",
    },
    {
      id: "no-auto-injection-claim",
      label: "No false automatic-injection claim",
      status: prompt.includes("Do not claim SessionStart injection")
        ? "pass"
        : "fail",
      detail:
        "same-session native subagents are labelled prompt-contract enforced",
    },
  ];
  const pass = checks.every((check) => check.status === "pass");
  return {
    laneId: "same-session-prompt-contract",
    laneLabel: "Same-session prompt contract",
    enforcement: "prompt-contract",
    iteration: input.iteration,
    injectionEligible: false,
    status: pass ? "accepted" : "rejected",
    sourcePointers: input.contractSources.length,
    evidenceSources: input.contractSources.map((source) => source.path),
    checks,
  };
}

function collectContractSources(
  projectRoot: string,
  startupSources: readonly SubagentInjectionBenchmarkSource[],
): SubagentInjectionBenchmarkSource[] {
  const sources: SubagentInjectionBenchmarkSource[] = [];
  const push = (source: SubagentInjectionBenchmarkSource | undefined): void => {
    if (!source) return;
    if (sources.some((existing) => existing.path === source.path)) return;
    sources.push(source);
  };

  push(readExistingSource(projectRoot, "AGENTS.md", "agent-control"));
  for (const source of startupSources) push(source);
  for (const source of collectCodexSkillSources(projectRoot)) push(source);
  return sources.sort((a, b) => sourceRank(a.kind) - sourceRank(b.kind) ||
    a.path.localeCompare(b.path));
}

function collectCodexSkillSources(
  projectRoot: string,
): SubagentInjectionBenchmarkSource[] {
  const skillsRoot = path.join(projectRoot, ".codex", "skills");
  const out: SubagentInjectionBenchmarkSource[] = [];
  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      if (!entry.isFile() || entry.name !== "SKILL.md") continue;
      const rel = displayPathFromProject(projectRoot, abs);
      const source = readExistingSource(projectRoot, rel, "codex-skill");
      if (source) out.push(source);
    }
  };
  visit(skillsRoot);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function readExistingSource(
  projectRoot: string,
  relPath: string,
  kind: SubagentInjectionBenchmarkSource["kind"],
): SubagentInjectionBenchmarkSource | undefined {
  const abs = path.join(projectRoot, relPath.split("/").join(path.sep));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
  const text = fs.readFileSync(abs, "utf8");
  return {
    path: relPath,
    kind,
    bytes: Buffer.byteLength(text, "utf8"),
    lines: lineCount(text),
  };
}

function renderSubagentContextContract(
  sources: readonly SubagentInjectionBenchmarkSource[],
): string {
  return [
    "=== anamnesis: subagent context contract ===",
    "This same-session native subagent path is prompt-contract enforced.",
    "Do not claim SessionStart injection for this lane unless benchmark evidence proves it.",
    "Before context-sensitive work, read and report these source pointers:",
    ...sources.map((source) => `- ${source.path} (${source.kind})`),
    "Report `anamnesis_context_sources` with the exact paths used.",
  ].join("\n");
}

function summarizeLanes(
  attempts: readonly SubagentInjectionBenchmarkAttempt[],
): SubagentInjectionBenchmarkLaneSummary[] {
  const byLane = new Map<SubagentContextLaneId, SubagentInjectionBenchmarkAttempt[]>();
  for (const attempt of attempts) {
    const laneAttempts = byLane.get(attempt.laneId) ?? [];
    laneAttempts.push(attempt);
    byLane.set(attempt.laneId, laneAttempts);
  }

  return [...byLane.entries()].map(([laneId, laneAttempts]) => {
    const first = laneAttempts[0]!;
    const injectionEligibleAttempts = laneAttempts.filter(
      (attempt) => attempt.injectionEligible,
    ).length;
    const injected = laneAttempts.filter((attempt) =>
      attempt.status === "injected"
    ).length;
    const missed = laneAttempts.filter((attempt) =>
      attempt.status === "missed"
    ).length;
    const accepted = laneAttempts.filter((attempt) =>
      attempt.status === "accepted"
    ).length;
    const rejected = laneAttempts.filter((attempt) =>
      attempt.status === "rejected"
    ).length;
    const contractAttempts = accepted + rejected;
    return {
      laneId,
      label: first.laneLabel,
      enforcement: first.enforcement,
      attempts: laneAttempts.length,
      injectionEligibleAttempts,
      injected,
      missed,
      accepted,
      rejected,
      injectionRatePct: injectionEligibleAttempts > 0
        ? pct(injected, injectionEligibleAttempts)
        : null,
      contractPassRatePct: contractAttempts > 0
        ? pct(accepted, contractAttempts)
        : null,
    };
  });
}

function summarizeBenchmark(
  lanes: readonly SubagentInjectionBenchmarkLaneSummary[],
): SubagentInjectionBenchmarkResult["summary"] {
  const attempts = lanes.reduce((sum, lane) => sum + lane.attempts, 0);
  const injectionEligibleAttempts = lanes.reduce(
    (sum, lane) => sum + lane.injectionEligibleAttempts,
    0,
  );
  const injected = lanes.reduce((sum, lane) => sum + lane.injected, 0);
  const missed = lanes.reduce((sum, lane) => sum + lane.missed, 0);
  const contractAccepted = lanes.reduce((sum, lane) => sum + lane.accepted, 0);
  const contractRejected = lanes.reduce((sum, lane) => sum + lane.rejected, 0);
  const contractAttempts = contractAccepted + contractRejected;
  return {
    lanes: lanes.length,
    attempts,
    injectionEligibleAttempts,
    injected,
    missed,
    injectionRatePct: injectionEligibleAttempts > 0
      ? pct(injected, injectionEligibleAttempts)
      : null,
    contractAttempts,
    contractAccepted,
    contractRejected,
    contractPassRatePct: contractAttempts > 0
      ? pct(contractAccepted, contractAttempts)
      : null,
  };
}

function writeSubagentInjectionArtifacts(input: {
  projectRoot: string;
  outputPath?: string;
  result: SubagentInjectionBenchmarkResult;
}): SubagentInjectionBenchmarkArtifacts {
  const outputDir = path.resolve(
    input.projectRoot,
    input.outputPath ?? SUBAGENT_INJECTION_BENCHMARK_OUTPUT_DIR,
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const artifacts: SubagentInjectionBenchmarkArtifacts = {
    outputDir: displayPathFromProject(input.projectRoot, outputDir),
    json: displayPathFromProject(
      input.projectRoot,
      path.join(outputDir, "subagent-injection.json"),
    ),
    markdown: displayPathFromProject(
      input.projectRoot,
      path.join(outputDir, "subagent-injection.md"),
    ),
    countsSvg: displayPathFromProject(
      input.projectRoot,
      path.join(outputDir, "subagent-injection-counts.svg"),
    ),
    ratesSvg: displayPathFromProject(
      input.projectRoot,
      path.join(outputDir, "subagent-injection-rates.svg"),
    ),
  };

  fs.writeFileSync(
    path.join(outputDir, "subagent-injection-counts.svg"),
    renderCountsSvg(input.result.lanes),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "subagent-injection-rates.svg"),
    renderRatesSvg(input.result.lanes),
    "utf8",
  );
  return artifacts;
}

function subagentInjectionBenchmarkEvidenceRecord(
  result: SubagentInjectionBenchmarkResult,
  projectRoot: string,
): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "subagent-injection-benchmark",
    generated_at: result.generatedAt,
    command: ["anamnesis", "benchmark", "subagent-injection"],
    project: { name: projectName(projectRoot) },
    summary: {
      schema_version: result.schemaVersion,
      attempts: result.summary.attempts,
      injection_eligible_attempts: result.summary.injectionEligibleAttempts,
      injected: result.summary.injected,
      missed: result.summary.missed,
      injection_rate_pct: result.summary.injectionRatePct,
      contract_attempts: result.summary.contractAttempts,
      contract_accepted: result.summary.contractAccepted,
      contract_rejected: result.summary.contractRejected,
      contract_pass_rate_pct: result.summary.contractPassRatePct,
      ok: result.ok,
    },
    details: {
      lanes: result.lanes,
    },
    ...(Object.keys(result.artifacts).length > 0
      ? { artifacts: result.artifacts as Record<string, string> }
      : {}),
  };
}

function renderSubagentInjectionMarkdown(
  result: SubagentInjectionBenchmarkResult,
): string {
  const lines = [
    `# Subagent Injection Benchmark — ${result.generatedAt}`,
    "",
    "Deterministic benchmark for subagent context enforcement. Startup-hook or launcher-wrapper lanes count actual injection eligibility; same-session native subagents are reported as prompt-contract evidence, not as automatic SessionStart injection.",
    "",
    `Requested attempts per lane: ${result.requestedAttempts}`,
    `Injection eligible attempts: ${result.summary.injected}/${result.summary.injectionEligibleAttempts} injected`,
    `Missed injections: ${result.summary.missed}`,
    `Prompt-contract accepted: ${result.summary.contractAccepted}/${result.summary.contractAttempts}`,
    "",
    "| Lane | Enforcement | Attempts | Injected | Missed | Accepted | Rejected | Rate |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const lane of result.lanes) {
    const rate = lane.injectionRatePct !== null
      ? `${lane.injectionRatePct}%`
      : lane.contractPassRatePct !== null
        ? `${lane.contractPassRatePct}%`
        : "n/a";
    lines.push(
      `| ${lane.label} | ${lane.enforcement} | ${lane.attempts} | ${lane.injected} | ${lane.missed} | ${lane.accepted} | ${lane.rejected} | ${rate} |`,
    );
  }
  if (result.artifacts.countsSvg) {
    lines.push(
      "",
      "## Charts",
      "",
      `![Subagent injection counts](${path.basename(result.artifacts.countsSvg)})`,
      `![Subagent injection rates](${path.basename(result.artifacts.ratesSvg ?? "")})`,
    );
  }
  return lines.join("\n");
}

function renderCountsSvg(
  lanes: readonly SubagentInjectionBenchmarkLaneSummary[],
): string {
  const width = 860;
  const height = 320;
  const max = Math.max(
    1,
    ...lanes.map((lane) =>
      Math.max(lane.injected + lane.missed, lane.accepted + lane.rejected)
    ),
  );
  const parts = svgFrame(width, height, "Subagent Injection Counts");
  const chartX = 72;
  const chartY = 48;
  const chartW = width - 120;
  const chartH = height - 120;
  const groupW = chartW / Math.max(1, lanes.length);
  parts.push(axis(chartX, chartY, chartW, chartH));
  lanes.forEach((lane, i) => {
    const positive = lane.injectionEligibleAttempts > 0
      ? lane.injected
      : lane.accepted;
    const negative = lane.injectionEligibleAttempts > 0
      ? lane.missed
      : lane.rejected;
    const x = chartX + i * groupW + groupW * 0.2;
    const barW = Math.min(110, groupW * 0.25);
    const positiveH = (positive / max) * chartH;
    const negativeH = (negative / max) * chartH;
    parts.push(
      `<rect x="${x}" y="${chartY + chartH - positiveH}" width="${barW}" height="${positiveH}" fill="#0f766e"/>`,
      `<rect x="${x + barW + 10}" y="${chartY + chartH - negativeH}" width="${barW}" height="${negativeH}" fill="#b91c1c"/>`,
      `<text x="${x + barW / 2}" y="${chartY + chartH - positiveH - 8}" text-anchor="middle" font-size="12">${positive}</text>`,
      `<text x="${x + barW + 10 + barW / 2}" y="${chartY + chartH - negativeH - 8}" text-anchor="middle" font-size="12">${negative}</text>`,
      `<text x="${x + barW}" y="${height - 42}" text-anchor="middle" font-size="12">${escapeXml(shortLaneLabel(lane.label))}</text>`,
    );
  });
  parts.push(
    `<rect x="${width - 210}" y="28" width="12" height="12" fill="#0f766e"/>`,
    `<text x="${width - 192}" y="39" font-size="12">injected / accepted</text>`,
    `<rect x="${width - 210}" y="48" width="12" height="12" fill="#b91c1c"/>`,
    `<text x="${width - 192}" y="59" font-size="12">missed / rejected</text>`,
    "</svg>\n",
  );
  return parts.join("\n");
}

function renderRatesSvg(
  lanes: readonly SubagentInjectionBenchmarkLaneSummary[],
): string {
  const width = 860;
  const height = 300;
  const parts = svgFrame(width, height, "Subagent Injection Rates");
  const chartX = 72;
  const chartY = 48;
  const chartW = width - 120;
  const chartH = height - 110;
  const groupW = chartW / Math.max(1, lanes.length);
  parts.push(axis(chartX, chartY, chartW, chartH));
  lanes.forEach((lane, i) => {
    const rate = lane.injectionRatePct ?? lane.contractPassRatePct ?? 0;
    const x = chartX + i * groupW + groupW * 0.3;
    const barW = Math.min(120, groupW * 0.4);
    const h = (rate / 100) * chartH;
    const color = lane.injectionRatePct !== null ? "#2563eb" : "#7c3aed";
    parts.push(
      `<rect x="${x}" y="${chartY + chartH - h}" width="${barW}" height="${h}" fill="${color}"/>`,
      `<text x="${x + barW / 2}" y="${chartY + chartH - h - 8}" text-anchor="middle" font-size="12">${rate}%</text>`,
      `<text x="${x + barW / 2}" y="${height - 36}" text-anchor="middle" font-size="12">${escapeXml(shortLaneLabel(lane.label))}</text>`,
    );
  });
  parts.push(
    `<text x="${chartX}" y="${height - 12}" font-size="12" fill="#475569">Blue = injection rate. Purple = prompt-contract acceptance rate.</text>`,
    "</svg>\n",
  );
  return parts.join("\n");
}

function svgFrame(width: number, height: number, title: string): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="24" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`,
  ];
}

function axis(x: number, y: number, width: number, height: number): string {
  return [
    `<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" stroke="#94a3b8"/>`,
    `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" stroke="#94a3b8"/>`,
  ].join("\n");
}

function sourceRank(kind: SubagentInjectionBenchmarkSource["kind"]): number {
  switch (kind) {
    case "agent-control":
      return 0;
    case "system-graph":
      return 1;
    case "ontology":
      return 2;
    case "handoff-active":
      return 3;
    case "handoff-archive":
      return 4;
    case "codex-skill":
      return 5;
  }
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}

function artifactPath(projectRoot: string, displayPath: string): string {
  return path.isAbsolute(displayPath)
    ? displayPath
    : path.join(projectRoot, displayPath);
}

function projectName(projectRoot: string): string {
  try {
    if (findAgentfile(projectRoot)) {
      return readAgentfile(projectRoot).project.name;
    }
  } catch {
    // Fall back to directory name for partially adopted or fixture projects.
  }
  return path.basename(projectRoot) || "unknown";
}

function shortLaneLabel(label: string): string {
  return label.replace("Separate process", "Separate").replace(
    "Same-session",
    "Same session",
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
