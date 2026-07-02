import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";

export type HandoffLifecycleTier = "hot" | "warm" | "cold" | "deprecated";
export type HandoffLifecycleKind = "active-index" | "archive";
export type HandoffLifecycleCandidateReason =
  | "deprecated-handoff"
  | "superseded-handoff"
  | "handoff-over-age"
  | "handoff-disk-budget-exceeded";

export interface HandoffLifecycleThresholds {
  maxWarmArchives: number;
  maxColdAgeDays: number;
  maxTotalBytes: number;
}

export interface HandoffLifecycleEntry {
  path: string;
  kind: HandoffLifecycleKind;
  tier: HandoffLifecycleTier;
  bytes: number;
  mtime: string;
  ageDays: number;
  activeReferenced: boolean;
  handoffStatus?: string;
  retentionTier?: string;
  closedAt?: string;
  lastReferencedAt?: string;
  supersededBy?: string;
}

export interface HandoffLifecycleCandidate extends HandoffLifecycleEntry {
  reasons: HandoffLifecycleCandidateReason[];
  recommendation: "review-user-authored";
}

export interface HandoffLifecycleReport {
  thresholds: HandoffLifecycleThresholds;
  summary: {
    total: number;
    activeIndex: number;
    archives: number;
    hot: number;
    warm: number;
    cold: number;
    deprecated: number;
    activeReferences: number;
    protectedByActiveReference: number;
    totalBytes: number;
    diskBudgetExceeded: boolean;
    candidates: number;
    reviewUserAuthored: number;
    warnings: number;
  };
  activeReferences: string[];
  entries: HandoffLifecycleEntry[];
  candidates: HandoffLifecycleCandidate[];
  warnings: string[];
}

export interface AnalyzeHandoffLifecycleOptions {
  projectRoot: string;
  thresholds: HandoffLifecycleThresholds;
  now: Date;
}

interface Frontmatter {
  handoffStatus?: string;
  retentionTier?: string;
  closedAt?: string;
  lastReferencedAt?: string;
  supersededBy?: string;
}

export function analyzeHandoffLifecycle(
  opts: AnalyzeHandoffLifecycleOptions,
): HandoffLifecycleReport {
  const projectRoot = path.resolve(opts.projectRoot);
  const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
  const warnings: string[] = [];
  if (!fs.existsSync(handoffDir)) {
    return emptyReport(opts.thresholds);
  }

  const files = fs
    .readdirSync(handoffDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith(".md") && entry.name !== "draft.md",
    )
    .map((entry) => path.join(handoffDir, entry.name));
  const activePath = path.join(handoffDir, "active.md");
  const activeReferences = fs.existsSync(activePath)
    ? extractArchiveRefs(
        activeReferenceText(
          safeRead(projectRoot, displayPathFromProject(projectRoot, activePath), warnings),
        ),
      )
    : [];
  const activeReferenceSet = new Set(activeReferences);

  for (const ref of activeReferences) {
    if (!fs.existsSync(path.join(projectRoot, ref))) {
      warnings.push(`active handoff references missing archive ${ref}`);
    }
  }

  const archivePaths = files
    .filter((file) => path.basename(file) !== "active.md")
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const newestWarm = new Set(
    archivePaths
      .slice(0, opts.thresholds.maxWarmArchives)
      .map((file) => displayPathFromProject(projectRoot, file)),
  );

  const entries = files
    .map((file) =>
      readHandoffEntry({
        projectRoot,
        file,
        nowMs: opts.now.getTime(),
        activeReferenceSet,
        newestWarm,
        warnings,
      }),
    )
    .sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of entries) {
    if (entry.activeReferenced && entry.tier === "deprecated") {
      warnings.push(`active handoff references deprecated archive ${entry.path}`);
    }
  }

  const reasonMap = new Map<string, Set<HandoffLifecycleCandidateReason>>();
  for (const entry of entries) {
    for (const reason of candidateReasons(entry, opts.thresholds)) {
      addReason(reasonMap, entry.path, reason);
    }
  }
  markHandoffDiskBudget(entries, opts.thresholds, reasonMap);

  const candidates = entries
    .flatMap((entry): HandoffLifecycleCandidate[] => {
      if (entry.kind !== "archive" || entry.activeReferenced) return [];
      const reasons = reasonMap.get(entry.path);
      if (!reasons || reasons.size === 0) return [];
      return [
        {
          ...entry,
          reasons: [...reasons].sort(compareHandoffReasons),
          recommendation: "review-user-authored",
        },
      ];
    })
    .sort(compareHandoffCandidates);

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    thresholds: opts.thresholds,
    summary: {
      total: entries.length,
      activeIndex: entries.filter((entry) => entry.kind === "active-index").length,
      archives: entries.filter((entry) => entry.kind === "archive").length,
      hot: entries.filter((entry) => entry.tier === "hot").length,
      warm: entries.filter((entry) => entry.tier === "warm").length,
      cold: entries.filter((entry) => entry.tier === "cold").length,
      deprecated: entries.filter((entry) => entry.tier === "deprecated").length,
      activeReferences: activeReferences.length,
      protectedByActiveReference: entries.filter(
        (entry) => entry.kind === "archive" && entry.activeReferenced,
      ).length,
      totalBytes,
      diskBudgetExceeded: totalBytes > opts.thresholds.maxTotalBytes,
      candidates: candidates.length,
      reviewUserAuthored: candidates.length,
      warnings: warnings.length,
    },
    activeReferences,
    entries,
    candidates,
    warnings,
  };
}

function emptyReport(
  thresholds: HandoffLifecycleThresholds,
): HandoffLifecycleReport {
  return {
    thresholds,
    summary: {
      total: 0,
      activeIndex: 0,
      archives: 0,
      hot: 0,
      warm: 0,
      cold: 0,
      deprecated: 0,
      activeReferences: 0,
      protectedByActiveReference: 0,
      totalBytes: 0,
      diskBudgetExceeded: false,
      candidates: 0,
      reviewUserAuthored: 0,
      warnings: 0,
    },
    activeReferences: [],
    entries: [],
    candidates: [],
    warnings: [],
  };
}

function readHandoffEntry(input: {
  projectRoot: string;
  file: string;
  nowMs: number;
  activeReferenceSet: Set<string>;
  newestWarm: Set<string>;
  warnings: string[];
}): HandoffLifecycleEntry {
  const relPath = displayPathFromProject(input.projectRoot, input.file);
  const stat = fs.statSync(input.file);
  if (path.basename(input.file) === "active.md") {
    return {
      path: relPath,
      kind: "active-index",
      tier: "hot",
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      ageDays: ageDays(input.nowMs, stat.mtime.getTime()),
      activeReferenced: false,
    };
  }

  const frontmatter = readFrontmatter(
    safeRead(input.projectRoot, relPath, input.warnings),
    relPath,
    input.warnings,
  );
  const activeReferenced = input.activeReferenceSet.has(relPath);
  const tier = tierForArchive({
    relPath,
    activeReferenced,
    newestWarm: input.newestWarm,
    frontmatter,
  });
  const referenceMs =
    parseDateMs(frontmatter.lastReferencedAt) ??
    parseDateMs(frontmatter.closedAt) ??
    stat.mtime.getTime();

  return {
    path: relPath,
    kind: "archive",
    tier,
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    ageDays: ageDays(input.nowMs, referenceMs),
    activeReferenced,
    ...(frontmatter.handoffStatus ? { handoffStatus: frontmatter.handoffStatus } : {}),
    ...(frontmatter.retentionTier ? { retentionTier: frontmatter.retentionTier } : {}),
    ...(frontmatter.closedAt ? { closedAt: frontmatter.closedAt } : {}),
    ...(frontmatter.lastReferencedAt
      ? { lastReferencedAt: frontmatter.lastReferencedAt }
      : {}),
    ...(frontmatter.supersededBy ? { supersededBy: frontmatter.supersededBy } : {}),
  };
}

function tierForArchive(input: {
  relPath: string;
  activeReferenced: boolean;
  newestWarm: Set<string>;
  frontmatter: Frontmatter;
}): HandoffLifecycleTier {
  if (
    input.frontmatter.retentionTier === "deprecated" ||
    input.frontmatter.handoffStatus === "deprecated" ||
    input.frontmatter.handoffStatus === "superseded" ||
    input.frontmatter.supersededBy
  ) {
    return "deprecated";
  }
  if (
    input.frontmatter.retentionTier === "cold" ||
    input.frontmatter.handoffStatus === "closed"
  ) {
    return input.activeReferenced ? "warm" : "cold";
  }
  if (
    input.frontmatter.retentionTier === "hot" ||
    input.frontmatter.retentionTier === "warm"
  ) {
    return "warm";
  }
  if (input.activeReferenced || input.newestWarm.has(input.relPath)) return "warm";
  return "cold";
}

function candidateReasons(
  entry: HandoffLifecycleEntry,
  thresholds: HandoffLifecycleThresholds,
): HandoffLifecycleCandidateReason[] {
  if (entry.kind !== "archive" || entry.activeReferenced) return [];
  const reasons: HandoffLifecycleCandidateReason[] = [];
  if (entry.tier === "deprecated" || entry.handoffStatus === "deprecated") {
    reasons.push("deprecated-handoff");
  }
  if (entry.supersededBy || entry.handoffStatus === "superseded") {
    reasons.push("superseded-handoff");
  }
  if (entry.tier === "cold" && entry.ageDays > thresholds.maxColdAgeDays) {
    reasons.push("handoff-over-age");
  }
  return reasons;
}

function markHandoffDiskBudget(
  entries: HandoffLifecycleEntry[],
  thresholds: HandoffLifecycleThresholds,
  reasonMap: Map<string, Set<HandoffLifecycleCandidateReason>>,
): void {
  let overage =
    entries.reduce((sum, entry) => sum + entry.bytes, 0) - thresholds.maxTotalBytes;
  if (overage <= 0) return;

  const cleanupPool = entries
    .filter(
      (entry) =>
        entry.kind === "archive" &&
        !entry.activeReferenced &&
        (entry.tier === "deprecated" || entry.tier === "cold"),
    )
    .sort(compareHandoffCleanupPriority);

  for (const entry of cleanupPool) {
    addReason(reasonMap, entry.path, "handoff-disk-budget-exceeded");
    overage -= entry.bytes;
    if (overage <= 0) return;
  }
}

function readFrontmatter(
  text: string,
  relPath: string,
  warnings: string[],
): Frontmatter {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1] ?? "") as unknown;
  } catch (e) {
    warnings.push(`${relPath} frontmatter could not be parsed: ${(e as Error).message}`);
    return {};
  }
  if (!isObject(parsed)) return {};
  return {
    handoffStatus: stringField(parsed, "handoff_status"),
    retentionTier: lifecycleTierField(parsed, "retention_tier"),
    closedAt: stringField(parsed, "closed_at"),
    lastReferencedAt: stringField(parsed, "last_referenced_at"),
    supersededBy: stringField(parsed, "superseded_by"),
  };
}

function extractArchiveRefs(text: string): string[] {
  const refs = new Set<string>();
  const pattern = /`?(\.anamnesis\/handoff\/(?!active\.md)[^`\s)]+\.md)`?/g;
  for (const match of text.matchAll(pattern)) {
    refs.add(normalizeRelPath(match[1]!));
  }
  return [...refs].sort();
}

function activeReferenceText(text: string): string {
  const lines: string[] = [];
  let sawOpenSection = false;
  let inOpenSection = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^##\s+(Current focus|Active tasks)\s*$/i.test(trimmed)) {
      sawOpenSection = true;
      inOpenSection = true;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      inOpenSection = false;
      continue;
    }
    if (inOpenSection && trimmed.startsWith("-")) {
      lines.push(trimmed);
    }
  }

  return sawOpenSection ? lines.join("\n") : text;
}

function safeRead(
  projectRoot: string,
  relPath: string,
  warnings: string[],
): string {
  try {
    return fs.readFileSync(path.join(projectRoot, relPath), "utf8");
  } catch (e) {
    warnings.push(`${relPath} could not be read: ${(e as Error).message}`);
    return "";
  }
}

function addReason(
  reasonMap: Map<string, Set<HandoffLifecycleCandidateReason>>,
  relPath: string,
  reason: HandoffLifecycleCandidateReason,
): void {
  const existing = reasonMap.get(relPath);
  if (existing) {
    existing.add(reason);
  } else {
    reasonMap.set(relPath, new Set([reason]));
  }
}

function compareHandoffCandidates(
  a: HandoffLifecycleCandidate,
  b: HandoffLifecycleCandidate,
): number {
  const reason = compareHandoffReasons(a.reasons[0]!, b.reasons[0]!);
  if (reason !== 0) return reason;
  return compareHandoffCleanupPriority(a, b);
}

function compareHandoffCleanupPriority(
  a: HandoffLifecycleEntry,
  b: HandoffLifecycleEntry,
): number {
  const deprecated = Number(b.tier === "deprecated") - Number(a.tier === "deprecated");
  if (deprecated !== 0) return deprecated;
  const superseded = Number(Boolean(b.supersededBy)) - Number(Boolean(a.supersededBy));
  if (superseded !== 0) return superseded;
  const age = b.ageDays - a.ageDays;
  if (age !== 0) return age;
  return a.path.localeCompare(b.path);
}

function compareHandoffReasons(
  a: HandoffLifecycleCandidateReason,
  b: HandoffLifecycleCandidateReason,
): number {
  return handoffReasonRank(a) - handoffReasonRank(b);
}

function handoffReasonRank(reason: HandoffLifecycleCandidateReason): number {
  switch (reason) {
    case "deprecated-handoff":
      return 0;
    case "superseded-handoff":
      return 1;
    case "handoff-over-age":
      return 2;
    case "handoff-disk-budget-exceeded":
      return 3;
  }
}

function lifecycleTierField(
  object: Record<string, unknown>,
  key: string,
): HandoffLifecycleTier | undefined {
  const value = stringField(object, key);
  return value === "hot" ||
    value === "warm" ||
    value === "cold" ||
    value === "deprecated"
    ? value
    : undefined;
}

function stringField(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ageDays(nowMs: number, thenMs: number): number {
  return Math.max(0, Math.floor((nowMs - thenMs) / 86_400_000));
}

function parseDateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  return normalizeRelPath(path.relative(projectRoot, absPath));
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
