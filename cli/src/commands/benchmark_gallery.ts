import * as fs from "node:fs";
import * as path from "node:path";
import {
  EVIDENCE_LOG_PATH,
  readEvidenceFile,
  readEvidenceRecords,
  type RuntimeEvidenceLog,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";

export interface BenchmarkGalleryEntry {
  id: string;
  kind: RuntimeEvidenceRecord["kind"];
  projectName: string;
  generatedAt: string;
  evidence: string;
  result: string;
  claimCandidate: string;
  boundary: string;
}

export interface BenchmarkGalleryClaimCandidate {
  id: string;
  claim: string;
  evidence: string;
  boundary: string;
}

export interface BenchmarkGalleryValidation {
  checkedPath: string;
  exists: boolean;
  stale: boolean;
  ok: boolean;
}

export interface BenchmarkGalleryResult {
  projectRoot: string;
  generatedAt: string;
  evidencePath: string;
  evidenceRecords: number;
  invalidEvidenceLines: number;
  entries: BenchmarkGalleryEntry[];
  claimCandidates: BenchmarkGalleryClaimCandidate[];
  warnings: string[];
  markdown: string;
  writtenPath?: string;
  validation?: BenchmarkGalleryValidation;
  ok: boolean;
}

export interface BenchmarkGalleryOptions {
  projectRoot: string;
  outputPath?: string;
  write?: boolean;
  validate?: boolean;
  sources?: string[];
  now?: () => Date;
}

export class BenchmarkGalleryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkGalleryError";
  }
}

const GALLERY_REGION_START = "<!-- anamnesis:benchmark-gallery:start -->";
const GALLERY_REGION_END = "<!-- /anamnesis:benchmark-gallery -->";

export function benchmarkGallery(
  opts: BenchmarkGalleryOptions,
): BenchmarkGalleryResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const outputPath = path.resolve(
    projectRoot,
    opts.outputPath ?? path.join("docs", "BENCHMARK-GALLERY.md"),
  );
  const log = readGalleryEvidenceRecords(projectRoot, opts.sources ?? []);
  const generatedAt =
    latestGeneratedAt(log.records) ??
    (opts.now ?? (() => new Date()))().toISOString();
  const entries = latestGalleryEntries(log.records);
  const claimCandidates = claimCandidatesFromEntries(entries);
  const warnings = galleryWarnings({
    evidenceRecords: log.total,
    invalidEvidenceLines: log.invalid,
    entries,
    claimCandidates,
  });
  const markdown = renderGalleryRegion({
    generatedAt,
    evidencePath: log.path,
    evidenceRecords: log.total,
    invalidEvidenceLines: log.invalid,
    entries,
    claimCandidates,
    warnings,
  });

  let writtenPath: string | undefined;
  if (opts.write === true) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const existing = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, "utf8")
      : "";
    fs.writeFileSync(
      outputPath,
      `${mergeGalleryRegion(existing, markdown)}\n`,
      "utf8",
    );
    writtenPath = displayPathFromProject(projectRoot, outputPath);
  }

  let validation: BenchmarkGalleryValidation | undefined;
  if (opts.validate === true) {
    const exists = fs.existsSync(outputPath);
    const current = exists
      ? extractGalleryRegion(fs.readFileSync(outputPath, "utf8"))
      : undefined;
    const expected = markdown.trimEnd();
    const currentText = current?.trimEnd() ?? "";
    const stale = currentText !== expected;
    validation = {
      checkedPath: displayPathFromProject(projectRoot, outputPath),
      exists,
      stale,
      ok: exists && current !== undefined && currentText === expected,
    };
  }

  const ok = log.invalid === 0 && (validation ? validation.ok : true);

  return {
    projectRoot,
    generatedAt,
    evidencePath: log.path,
    evidenceRecords: log.total,
    invalidEvidenceLines: log.invalid,
    entries,
    claimCandidates,
    warnings,
    markdown,
    writtenPath,
    validation,
    ok,
  };
}

function readGalleryEvidenceRecords(
  projectRoot: string,
  explicitSources: readonly string[],
): RuntimeEvidenceLog {
  const logs = [readEvidenceRecords(projectRoot)];
  for (const source of defaultGalleryEvidenceSources(projectRoot)) {
    logs.push(readEvidenceFile(source.absPath, source.displayPath));
  }
  for (const source of explicitSources) {
    const absPath = path.resolve(projectRoot, source);
    logs.push(readEvidenceFile(absPath, displayPathFromProject(projectRoot, absPath)));
  }
  return {
    path: logs.map((log) => log.path).join("; "),
    total: logs.reduce((sum, log) => sum + log.total, 0),
    invalid: logs.reduce((sum, log) => sum + log.invalid, 0),
    records: logs.flatMap((log) => log.records),
  };
}

function defaultGalleryEvidenceSources(
  projectRoot: string,
): { absPath: string; displayPath: string }[] {
  const dir = path.join(projectRoot, "docs", "benchmark-evidence");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(dir, entry.name))
    .sort()
    .map((absPath) => ({
      absPath,
      displayPath: displayPathFromProject(projectRoot, absPath),
    }));
}

function latestGeneratedAt(
  records: readonly RuntimeEvidenceRecord[],
): string | undefined {
  let latest: string | undefined;
  for (const record of records) {
    if (!latest || record.generated_at > latest) {
      latest = record.generated_at;
    }
  }
  return latest;
}

function latestGalleryEntries(
  records: readonly RuntimeEvidenceRecord[],
): BenchmarkGalleryEntry[] {
  const latest = new Map<string, RuntimeEvidenceRecord>();
  for (const record of records.filter(isGalleryEvidenceRecord)) {
    const key = `${record.kind}:${record.project.name}`;
    const previous = latest.get(key);
    if (!previous || record.generated_at >= previous.generated_at) {
      latest.set(key, record);
    }
  }
  return [...latest.values()]
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
    .map(entryFromEvidenceRecord);
}

function isGalleryEvidenceRecord(record: RuntimeEvidenceRecord): boolean {
  return (
    record.kind === "dogfood-check" ||
    record.kind === "benchmark-report" ||
    record.kind === "benchmark-compare"
  );
}

function entryFromEvidenceRecord(
  record: RuntimeEvidenceRecord,
): BenchmarkGalleryEntry {
  const evidence = evidencePath(record);
  if (record.kind === "benchmark-compare") {
    return compareEntry(record, evidence);
  }
  if (record.kind === "benchmark-report") {
    return reportEntry(record, evidence);
  }
  return dogfoodEntry(record, evidence);
}

function compareEntry(
  record: RuntimeEvidenceRecord,
  evidence: string,
): BenchmarkGalleryEntry {
  const improved = numberField(record.summary, "improved");
  const regressed = numberField(record.summary, "regressed");
  const unchanged = numberField(record.summary, "unchanged");
  const result =
    improved !== undefined && regressed !== undefined && unchanged !== undefined
      ? `${improved} improved, ${regressed} regressed, ${unchanged} unchanged`
      : "before/after comparison recorded";
  const claimCandidate =
    improved !== undefined && improved > 0 && regressed === 0
      ? `${record.project.name} before/after benchmark improved ${improved} scorecard dimension(s) with 0 regressions.`
      : "No public improvement claim until regressions are reviewed.";
  return {
    id: stableEntryId(record),
    kind: record.kind,
    projectName: record.project.name,
    generatedAt: record.generated_at,
    evidence,
    result,
    claimCandidate,
    boundary:
      "Same-repo deterministic scorecard delta only; not a model-intelligence benchmark.",
  };
}

function reportEntry(
  record: RuntimeEvidenceRecord,
  evidence: string,
): BenchmarkGalleryEntry {
  const scorecard = objectField(record.summary, "scorecard");
  const readyLayers = objectField(scorecard, "ready_layers");
  const continuity = objectField(scorecard, "continuity");
  const diagnostics = objectField(scorecard, "diagnostics");
  const ready = numberField(readyLayers, "ready");
  const readyTotal = numberField(readyLayers, "total");
  const passed = numberField(continuity, "passed");
  const passedTotal = numberField(continuity, "total");
  const doctorErrors = numberField(diagnostics, "doctor_errors");
  const doctorWarnings = numberField(diagnostics, "doctor_warnings");
  const result =
    ready !== undefined &&
    readyTotal !== undefined &&
    passed !== undefined &&
    passedTotal !== undefined
      ? `ready layers ${ready}/${readyTotal}; continuity ${passed}/${passedTotal}; doctor ${doctorErrors ?? "?"} errors, ${doctorWarnings ?? "?"} warnings`
      : "benchmark scorecard recorded";
  const claimCandidate =
    passed !== undefined &&
    passedTotal !== undefined &&
    passed === passedTotal &&
    doctorErrors === 0
      ? `${record.project.name} current benchmark has continuity ${passed}/${passedTotal}, ready layers ${ready ?? "?"}/${readyTotal ?? "?"}, and doctor errors 0.`
      : "No readiness claim until continuity and doctor diagnostics are clean.";
  return {
    id: stableEntryId(record),
    kind: record.kind,
    projectName: record.project.name,
    generatedAt: record.generated_at,
    evidence,
    result,
    claimCandidate,
    boundary:
      "Current deterministic context surface only; limitations depend on installed fragments and missing Layer A/B targets.",
  };
}

function dogfoodEntry(
  record: RuntimeEvidenceRecord,
  evidence: string,
): BenchmarkGalleryEntry {
  const passed = numberField(record.summary, "passed");
  const total = numberField(record.summary, "total");
  const ok = booleanField(record.summary, "ok");
  const tools = arrayField(record.summary, "tools").join(", ");
  const result =
    passed !== undefined && total !== undefined
      ? `dogfood ${passed}/${total}; tools ${tools || "(unknown)"}`
      : "dogfood check recorded";
  const claimCandidate =
    ok === true && passed !== undefined && total !== undefined
      ? `${record.project.name} dogfood check passes ${passed}/${total} continuity criteria across ${tools || "enabled tools"}.`
      : "No dogfood readiness claim until all criteria pass.";
  return {
    id: stableEntryId(record),
    kind: record.kind,
    projectName: record.project.name,
    generatedAt: record.generated_at,
    evidence,
    result,
    claimCandidate,
    boundary:
      "Self-check evidence for this managed repo; skipped external smokes must stay disclosed.",
  };
}

function claimCandidatesFromEntries(
  entries: readonly BenchmarkGalleryEntry[],
): BenchmarkGalleryClaimCandidate[] {
  return entries
    .filter((entry) => !entry.claimCandidate.startsWith("No "))
    .map((entry) => ({
      id: entry.id,
      claim: entry.claimCandidate,
      evidence: entry.evidence,
      boundary: entry.boundary,
    }));
}

function galleryWarnings(input: {
  evidenceRecords: number;
  invalidEvidenceLines: number;
  entries: readonly BenchmarkGalleryEntry[];
  claimCandidates: readonly BenchmarkGalleryClaimCandidate[];
}): string[] {
  const warnings: string[] = [];
  if (input.evidenceRecords === 0) {
    warnings.push("No runtime evidence records found; do not publish benchmark claims.");
  }
  if (input.invalidEvidenceLines > 0) {
    warnings.push(
      `${input.invalidEvidenceLines} invalid evidence line(s) found; fix the JSONL log before release.`,
    );
  }
  if (!input.entries.some((entry) => entry.kind === "benchmark-compare")) {
    warnings.push("No before/after benchmark comparison evidence found.");
  }
  if (!input.entries.some((entry) => entry.kind === "benchmark-report")) {
    warnings.push("No current benchmark scorecard evidence found.");
  }
  const projects = new Set(input.entries.map((entry) => entry.projectName));
  if (projects.size < 3) {
    warnings.push(
      `Only ${projects.size} public-safe project shape(s) represented; do not claim ecosystem coverage.`,
    );
  }
  if (input.claimCandidates.length === 0) {
    warnings.push("No README claim candidates have matching clean evidence.");
  }
  return warnings;
}

function renderGalleryRegion(input: {
  generatedAt: string;
  evidencePath: string;
  evidenceRecords: number;
  invalidEvidenceLines: number;
  entries: readonly BenchmarkGalleryEntry[];
  claimCandidates: readonly BenchmarkGalleryClaimCandidate[];
  warnings: readonly string[];
}): string {
  return [
    GALLERY_REGION_START,
    "## Generated Evidence",
    "",
    "This section is generated from runtime evidence. It separates README-ready",
    "claim candidates from evidence that still needs more repo shapes or manual",
    "review.",
    "",
    `Generated: ${input.generatedAt}`,
    `Source: \`${input.evidencePath}\` (${input.evidenceRecords} valid, ${input.invalidEvidenceLines} invalid)`,
    "",
    "## Evidence Entries",
    "",
    renderEntriesTable(input.entries),
    "",
    "## README Claim Candidates",
    "",
    renderClaimCandidates(input.claimCandidates),
    "",
    "## Release Warnings",
    "",
    renderWarnings(input.warnings),
    GALLERY_REGION_END,
  ].join("\n");
}

function mergeGalleryRegion(existing: string, region: string): string {
  const trimmedRegion = region.trimEnd();
  if (existing.trim() === "") {
    return [
      "# Public Benchmark Gallery",
      "",
      "Status: generated benchmark evidence surface.",
      "",
      trimmedRegion,
    ].join("\n");
  }

  const start = existing.indexOf(GALLERY_REGION_START);
  const end = existing.indexOf(GALLERY_REGION_END);
  if (start >= 0 && end > start) {
    const afterEnd = end + GALLERY_REGION_END.length;
    return [
      existing.slice(0, start).trimEnd(),
      trimmedRegion,
      existing.slice(afterEnd).trimStart(),
    ]
      .filter((part) => part !== "")
      .join("\n\n")
      .trimEnd();
  }

  const insertionPoint = existing.indexOf("\n## Claim Policy");
  if (insertionPoint >= 0) {
    return `${existing.slice(0, insertionPoint).trimEnd()}\n\n${trimmedRegion}\n${existing.slice(insertionPoint)}`.trimEnd();
  }

  return `${existing.trimEnd()}\n\n${trimmedRegion}`;
}

function extractGalleryRegion(existing: string): string | undefined {
  const start = existing.indexOf(GALLERY_REGION_START);
  const end = existing.indexOf(GALLERY_REGION_END);
  if (start < 0 || end <= start) return undefined;
  return existing.slice(start, end + GALLERY_REGION_END.length);
}

function renderEntriesTable(entries: readonly BenchmarkGalleryEntry[]): string {
  if (entries.length === 0) return "_No evidence entries found._";
  const rows = entries
    .map(
      (entry) =>
        `| ${escapeCell(entry.projectName)} | ${entry.kind} | ${entry.generatedAt} | ${escapeCell(entry.evidence)} | ${escapeCell(entry.result)} | ${escapeCell(entry.claimCandidate)} |`,
    )
    .join("\n");
  return [
    "| Project | Kind | Generated | Evidence | Result | Claim candidate |",
    "|---|---|---|---|---|---|",
    rows,
  ].join("\n");
}

function renderClaimCandidates(
  candidates: readonly BenchmarkGalleryClaimCandidate[],
): string {
  if (candidates.length === 0) {
    return "_No README claim candidates have matching clean evidence yet._";
  }
  return candidates
    .map(
      (candidate) =>
        `- **${candidate.id}**: ${candidate.claim}\n  Evidence: ${candidate.evidence}\n  Boundary: ${candidate.boundary}`,
    )
    .join("\n");
}

function renderWarnings(warnings: readonly string[]): string {
  if (warnings.length === 0) return "_No release warnings._";
  return warnings.map((warning) => `- ${warning}`).join("\n");
}

function stableEntryId(record: RuntimeEvidenceRecord): string {
  const project = record.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${record.kind}-${project}`.replace(/^-|-$/g, "");
}

function evidencePath(record: RuntimeEvidenceRecord): string {
  const markdown = record.artifacts?.markdown;
  const evidence = record.artifacts?.evidence ?? EVIDENCE_LOG_PATH;
  return markdown ? `${markdown}; ${evidence}` : evidence;
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}

function objectField(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const field = value?.[key];
  return field && typeof field === "object" && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : undefined;
}

function numberField(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function booleanField(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const field = value?.[key];
  return typeof field === "boolean" ? field : undefined;
}

function arrayField(
  value: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const field = value?.[key];
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is string => typeof item === "string");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
