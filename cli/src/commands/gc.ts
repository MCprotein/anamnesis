import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import {
  ManifestParseError,
  readManifest,
  writeManifest,
  type Manifest,
} from "../core/manifest.js";
import {
  analyzeHandoffLifecycle,
  type HandoffLifecycleReport,
} from "../core/handoff_lifecycle.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import { sha256 } from "../util/hash.js";

export const GC_SCHEMA_VERSION = "anamnesis.gc.v1";

export type GcHarnessLifecycle = "current" | "reusable" | "unknown";
export type GcHarnessOrigin = "managed" | "user-authored";

export type GcCandidateReason =
  | "stale-current"
  | "current-over-count"
  | "deprecated-reusable"
  | "superseded-reusable"
  | "reusable-over-count"
  | "disk-budget-exceeded";

export type GcRecommendation = "delete-candidate" | "review-user-authored";

export interface GcHarnessEntry {
  path: string;
  id: string;
  title?: string;
  lifecycle: GcHarnessLifecycle;
  origin: GcHarnessOrigin;
  bytes: number;
  mtime: string;
  ageDays: number;
  useCount?: number;
  lastUsed?: string;
  deprecated: boolean;
  supersededBy?: string;
}

export interface GcCandidate extends GcHarnessEntry {
  reasons: GcCandidateReason[];
  recommendation: GcRecommendation;
}

export interface GcResult {
  schema_version: typeof GC_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  mode: "dry-run" | "apply";
  applied: boolean;
  thresholds: {
    maxCurrentAgeDays: number;
    maxCurrentHarnesses: number;
    maxReusableHarnesses: number;
    maxTotalBytes: number;
    maxWarmHandoffArchives: number;
    maxColdHandoffAgeDays: number;
    maxHandoffBytes: number;
  };
  summary: {
    total: number;
    current: number;
    reusable: number;
    unknown: number;
    managed: number;
    userAuthored: number;
    totalBytes: number;
    diskBudgetExceeded: boolean;
    candidates: number;
    deleteCandidates: number;
    reviewUserAuthored: number;
    warnings: number;
  };
  candidates: GcCandidate[];
  handoff: HandoffLifecycleReport;
  deleted: {
    taskHarnesses: string[];
  };
  backedUpTaskHarnesses: string[];
  backupDir?: string;
  skipped: {
    userAuthoredTaskHarnesses: string[];
    userModifiedTaskHarnesses: string[];
    handoffs: string[];
  };
  warnings: string[];
  evidencePath?: string;
}

export interface GcOptions {
  projectRoot: string;
  dryRun?: boolean;
  apply?: boolean;
  maxCurrentAgeDays?: number;
  maxCurrentHarnesses?: number;
  maxReusableHarnesses?: number;
  maxTotalBytes?: number;
  maxWarmHandoffArchives?: number;
  maxColdHandoffAgeDays?: number;
  maxHandoffBytes?: number;
  now?: () => Date;
}

export class GcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GcError";
  }
}

const DEFAULT_MAX_CURRENT_AGE_DAYS = 14;
const DEFAULT_MAX_CURRENT_HARNESSES = 5;
const DEFAULT_MAX_REUSABLE_HARNESSES = 50;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const DEFAULT_MAX_WARM_HANDOFF_ARCHIVES = 5;
const DEFAULT_MAX_COLD_HANDOFF_AGE_DAYS = 90;
const DEFAULT_MAX_HANDOFF_BYTES = 512 * 1024;

export function gc(opts: GcOptions): GcResult {
  if (opts.apply === true && opts.dryRun === true) {
    throw new GcError(
      "choose either --dry-run or --apply, not both",
    );
  }

  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const nowMs = Date.parse(generatedAt);
  const thresholds = {
    maxCurrentAgeDays: opts.maxCurrentAgeDays ?? DEFAULT_MAX_CURRENT_AGE_DAYS,
    maxCurrentHarnesses:
      opts.maxCurrentHarnesses ?? DEFAULT_MAX_CURRENT_HARNESSES,
    maxReusableHarnesses:
      opts.maxReusableHarnesses ?? DEFAULT_MAX_REUSABLE_HARNESSES,
    maxTotalBytes: opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxWarmHandoffArchives:
      opts.maxWarmHandoffArchives ?? DEFAULT_MAX_WARM_HANDOFF_ARCHIVES,
    maxColdHandoffAgeDays:
      opts.maxColdHandoffAgeDays ?? DEFAULT_MAX_COLD_HANDOFF_AGE_DAYS,
    maxHandoffBytes: opts.maxHandoffBytes ?? DEFAULT_MAX_HANDOFF_BYTES,
  };
  const warnings: string[] = [];
  const manifest = readManifestForGc(projectRoot, warnings);
  const handoff = analyzeHandoffLifecycle({
    projectRoot,
    now: new Date(generatedAt),
    thresholds: {
      maxWarmArchives: thresholds.maxWarmHandoffArchives,
      maxColdAgeDays: thresholds.maxColdHandoffAgeDays,
      maxTotalBytes: thresholds.maxHandoffBytes,
    },
  });
  const entries = discoverHarnessFiles(projectRoot).map((relPath) =>
    readHarnessEntry(projectRoot, relPath, manifest, nowMs, warnings),
  );

  const reasonMap = new Map<string, Set<GcCandidateReason>>();
  for (const entry of entries) {
    const reasons = reasonsForEntry(entry, thresholds);
    if (reasons.length > 0) reasonMap.set(entry.path, new Set(reasons));
  }

  markCurrentCountExcess(entries, thresholds, reasonMap);
  markReusableCountExcess(entries, thresholds, reasonMap);
  markDiskBudgetExcess(entries, thresholds, reasonMap);

  const candidates = entries
    .flatMap((entry): GcCandidate[] => {
      const reasons = reasonMap.get(entry.path);
      if (!reasons || reasons.size === 0) return [];
      return [
        {
          ...entry,
          reasons: [...reasons].sort(compareReasons),
          recommendation:
            entry.origin === "managed" ? "delete-candidate" : "review-user-authored",
        },
      ];
    })
    .sort(compareCandidates);

  const applyResult =
    opts.apply === true
      ? applyGcCleanup({
          projectRoot,
          manifest,
          candidates,
          handoff,
          generatedAt,
          warnings,
        })
      : emptyApplyResult();

  const allWarnings = [...warnings, ...handoff.warnings];
  const summary = {
    total: entries.length,
    current: entries.filter((entry) => entry.lifecycle === "current").length,
    reusable: entries.filter((entry) => entry.lifecycle === "reusable").length,
    unknown: entries.filter((entry) => entry.lifecycle === "unknown").length,
    managed: entries.filter((entry) => entry.origin === "managed").length,
    userAuthored: entries.filter((entry) => entry.origin === "user-authored")
      .length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    diskBudgetExceeded:
      entries.reduce((sum, entry) => sum + entry.bytes, 0) >
      thresholds.maxTotalBytes,
    candidates: candidates.length,
    deleteCandidates: candidates.filter(
      (candidate) => candidate.recommendation === "delete-candidate",
    ).length,
    reviewUserAuthored: candidates.filter(
      (candidate) => candidate.recommendation === "review-user-authored",
    ).length,
    warnings: allWarnings.length,
  };

  const result: GcResult = {
    schema_version: GC_SCHEMA_VERSION,
    projectRoot: ".",
    generatedAt,
    mode: opts.apply === true ? "apply" : "dry-run",
    applied: opts.apply === true,
    thresholds,
    summary,
    candidates,
    handoff,
    deleted: {
      taskHarnesses: applyResult.deletedTaskHarnesses,
    },
    backedUpTaskHarnesses: applyResult.backedUpTaskHarnesses,
    ...(applyResult.backupDir ? { backupDir: applyResult.backupDir } : {}),
    skipped: {
      userAuthoredTaskHarnesses: applyResult.skippedUserAuthoredTaskHarnesses,
      userModifiedTaskHarnesses: applyResult.skippedUserModifiedTaskHarnesses,
      handoffs: applyResult.skippedHandoffs,
    },
    warnings: allWarnings,
  };
  if (opts.apply === true) {
    result.evidencePath = appendEvidenceRecord(
      projectRoot,
      gcApplyEvidenceRecord({
        generatedAt,
        projectRoot,
        result,
      }),
    );
  }
  return result;
}

interface GcApplyResult {
  deletedTaskHarnesses: string[];
  skippedUserAuthoredTaskHarnesses: string[];
  skippedUserModifiedTaskHarnesses: string[];
  skippedHandoffs: string[];
  backedUpTaskHarnesses: string[];
  backupDir?: string;
}

function emptyApplyResult(): GcApplyResult {
  return {
    deletedTaskHarnesses: [],
    skippedUserAuthoredTaskHarnesses: [],
    skippedUserModifiedTaskHarnesses: [],
    skippedHandoffs: [],
    backedUpTaskHarnesses: [],
  };
}

function applyGcCleanup(input: {
  projectRoot: string;
  manifest: Manifest;
  candidates: GcCandidate[];
  handoff: HandoffLifecycleReport;
  generatedAt: string;
  warnings: string[];
}): GcApplyResult {
  const result = emptyApplyResult();
  const deleted = new Set<string>();

  for (const candidate of input.candidates) {
    if (candidate.recommendation !== "delete-candidate") {
      result.skippedUserAuthoredTaskHarnesses.push(candidate.path);
      continue;
    }

    const absPath = safeTaskHarnessPath(input.projectRoot, candidate.path);
    if (!absPath) {
      input.warnings.push(`refusing to delete unsafe task harness path ${candidate.path}`);
      continue;
    }

    const fileEntry = input.manifest.files.find(
      (entry) => normalizeRelPath(entry.path) === normalizeRelPath(candidate.path),
    );
    if (!fileEntry) {
      result.skippedUserAuthoredTaskHarnesses.push(candidate.path);
      continue;
    }
    if (!fs.existsSync(absPath)) {
      input.warnings.push(`task harness candidate already missing: ${candidate.path}`);
      continue;
    }
    const currentHash = sha256(fs.readFileSync(absPath));
    if (currentHash !== fileEntry.last_applied_hash) {
      result.skippedUserModifiedTaskHarnesses.push(candidate.path);
      continue;
    }

    const backupDir = ensureGcBackupDir(input.projectRoot, input.generatedAt, result);
    const backupPath = path.join(input.projectRoot, backupDir, candidate.path);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(absPath, backupPath);
    result.backedUpTaskHarnesses.push(candidate.path);
    fs.unlinkSync(absPath);
    pruneEmptyHarnessDirs(input.projectRoot, path.dirname(absPath));
    result.deletedTaskHarnesses.push(candidate.path);
    deleted.add(normalizeRelPath(candidate.path));
  }

  if (deleted.size > 0) {
    const nextManifest: Manifest = {
      ...input.manifest,
      files: input.manifest.files.filter(
        (entry) => !deleted.has(normalizeRelPath(entry.path)),
      ),
    };
    writeManifest(input.projectRoot, nextManifest);
  }

  result.skippedHandoffs.push(
    ...input.handoff.candidates.map((candidate) => candidate.path),
  );
  return result;
}

function ensureGcBackupDir(
  projectRoot: string,
  generatedAt: string,
  result: GcApplyResult,
): string {
  if (result.backupDir) return result.backupDir;
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const backupDir = path.join(".anamnesis", "backups", `gc-${stamp}`);
  fs.mkdirSync(path.join(projectRoot, backupDir), { recursive: true });
  result.backupDir = normalizeRelPath(backupDir);
  return result.backupDir;
}

function safeTaskHarnessPath(projectRoot: string, relPath: string): string | undefined {
  const normalized = normalizeRelPath(relPath);
  if (
    path.isAbsolute(relPath) ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !/\.ya?ml$/i.test(normalized)
  ) {
    return undefined;
  }
  const harnessRoot = path.resolve(projectRoot, ".anamnesis", "task-harnesses");
  const absPath = path.resolve(projectRoot, normalized);
  const relative = path.relative(harnessRoot, absPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return absPath;
}

function pruneEmptyHarnessDirs(projectRoot: string, startDir: string): void {
  const harnessRoot = path.resolve(projectRoot, ".anamnesis", "task-harnesses");
  let current = path.resolve(startDir);
  while (current !== harnessRoot) {
    const relative = path.relative(harnessRoot, current);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return;
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function gcApplyEvidenceRecord(input: {
  generatedAt: string;
  projectRoot: string;
  result: GcResult;
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "gc-apply",
    generated_at: input.generatedAt,
    command: ["anamnesis", "gc", "--apply"],
    project: { name: path.basename(input.projectRoot) || "project" },
    summary: {
      deleted_task_harnesses: input.result.deleted.taskHarnesses.length,
      backed_up_task_harnesses: input.result.backedUpTaskHarnesses.length,
      backup_dir: input.result.backupDir,
      skipped_user_authored_task_harnesses:
        input.result.skipped.userAuthoredTaskHarnesses.length,
      skipped_user_modified_task_harnesses:
        input.result.skipped.userModifiedTaskHarnesses.length,
      handoff_review_only: input.result.skipped.handoffs.length,
      candidates: input.result.summary.candidates,
      handoff_candidates: input.result.handoff.summary.candidates,
      warnings: input.result.warnings.length,
    },
    details: {
      deleted_task_harnesses: input.result.deleted.taskHarnesses,
      backed_up_task_harnesses: input.result.backedUpTaskHarnesses,
      backup_dir: input.result.backupDir,
      skipped_user_authored_task_harnesses:
        input.result.skipped.userAuthoredTaskHarnesses,
      skipped_user_modified_task_harnesses:
        input.result.skipped.userModifiedTaskHarnesses,
      handoff_review_only: input.result.skipped.handoffs,
    },
  };
}

function readManifestForGc(projectRoot: string, warnings: string[]): Manifest {
  try {
    return readManifest(projectRoot);
  } catch (e) {
    if (e instanceof ManifestParseError) {
      warnings.push(
        `.anamnesis/manifest.json could not be read; treating harness files as user-authored: ${e.message}`,
      );
      return { version: 1, regions: [], files: [] };
    }
    throw e;
  }
}

function discoverHarnessFiles(projectRoot: string): string[] {
  const root = path.join(projectRoot, ".anamnesis", "task-harnesses");
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile() && /\.(ya?ml)$/i.test(entry.name)) {
        result.push(displayPathFromProject(projectRoot, absPath));
      }
    }
  }
  return result.sort();
}

function readHarnessEntry(
  projectRoot: string,
  relPath: string,
  manifest: Manifest,
  nowMs: number,
  warnings: string[],
): GcHarnessEntry {
  const absPath = path.join(projectRoot, relPath);
  const stat = fs.statSync(absPath);
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(absPath, "utf8")) as unknown;
  } catch (e) {
    warnings.push(`${relPath} could not be parsed: ${(e as Error).message}`);
    parsed = {};
  }
  const lifecycle = lifecycleKind(parsed);
  const lifecycleObject = isObject(parsed) ? objectField(parsed, "lifecycle") : undefined;
  const lastUsed =
    lifecycleObject === undefined
      ? undefined
      : stringField(lifecycleObject, "last_used") ??
        stringField(lifecycleObject, "updated_at") ??
        stringField(lifecycleObject, "created_at");
  const lastTouchedMs = parseDateMs(lastUsed) ?? stat.mtime.getTime();
  const ageDays = Math.max(0, Math.floor((nowMs - lastTouchedMs) / 86_400_000));
  const fileEntry = manifest.files.find((entry) => normalizeRelPath(entry.path) === relPath);
  const id =
    (isObject(parsed) ? stringField(parsed, "id") : undefined) ??
    path.basename(relPath).replace(/\.(ya?ml)$/i, "");

  return {
    path: relPath,
    id,
    ...(isObject(parsed) && stringField(parsed, "title")
      ? { title: stringField(parsed, "title") }
      : {}),
    lifecycle,
    origin: fileEntry ? "managed" : "user-authored",
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    ageDays,
    ...(lifecycleObject && numberField(lifecycleObject, "use_count") !== undefined
      ? { useCount: numberField(lifecycleObject, "use_count") }
      : {}),
    ...(lastUsed ? { lastUsed } : {}),
    deprecated:
      lifecycleObject !== undefined &&
      booleanField(lifecycleObject, "deprecated") === true,
    ...(lifecycleObject && stringField(lifecycleObject, "superseded_by")
      ? { supersededBy: stringField(lifecycleObject, "superseded_by") }
      : {}),
  };
}

function reasonsForEntry(
  entry: GcHarnessEntry,
  thresholds: GcResult["thresholds"],
): GcCandidateReason[] {
  const reasons: GcCandidateReason[] = [];
  if (
    entry.lifecycle === "current" &&
    entry.ageDays > thresholds.maxCurrentAgeDays
  ) {
    reasons.push("stale-current");
  }
  if (entry.lifecycle === "reusable" && entry.deprecated) {
    reasons.push("deprecated-reusable");
  }
  if (entry.lifecycle === "reusable" && entry.supersededBy) {
    reasons.push("superseded-reusable");
  }
  return reasons;
}

function markCurrentCountExcess(
  entries: GcHarnessEntry[],
  thresholds: GcResult["thresholds"],
  reasonMap: Map<string, Set<GcCandidateReason>>,
): void {
  const current = entries
    .filter((entry) => entry.lifecycle === "current")
    .sort((a, b) => newestFirst(a, b));
  for (const entry of current.slice(thresholds.maxCurrentHarnesses)) {
    addReason(reasonMap, entry.path, "current-over-count");
  }
}

function markReusableCountExcess(
  entries: GcHarnessEntry[],
  thresholds: GcResult["thresholds"],
  reasonMap: Map<string, Set<GcCandidateReason>>,
): void {
  const reusable = entries
    .filter((entry) => entry.lifecycle === "reusable")
    .sort(compareReusableKeepPriority);
  for (const entry of reusable.slice(thresholds.maxReusableHarnesses)) {
    addReason(reasonMap, entry.path, "reusable-over-count");
  }
}

function markDiskBudgetExcess(
  entries: GcHarnessEntry[],
  thresholds: GcResult["thresholds"],
  reasonMap: Map<string, Set<GcCandidateReason>>,
): void {
  let overage =
    entries.reduce((sum, entry) => sum + entry.bytes, 0) - thresholds.maxTotalBytes;
  if (overage <= 0) return;

  const existingCandidates = entries
    .filter((entry) => (reasonMap.get(entry.path)?.size ?? 0) > 0)
    .sort(compareCleanupPriority);
  for (const entry of existingCandidates) {
    addReason(reasonMap, entry.path, "disk-budget-exceeded");
    overage -= entry.bytes;
    if (overage <= 0) return;
  }
}

function addReason(
  reasonMap: Map<string, Set<GcCandidateReason>>,
  relPath: string,
  reason: GcCandidateReason,
): void {
  const existing = reasonMap.get(relPath);
  if (existing) {
    existing.add(reason);
  } else {
    reasonMap.set(relPath, new Set([reason]));
  }
}

function lifecycleKind(parsed: unknown): GcHarnessLifecycle {
  if (!isObject(parsed)) return "unknown";
  const lifecycle = parsed.lifecycle;
  const raw = typeof lifecycle === "string"
    ? lifecycle
    : isObject(lifecycle)
      ? stringField(lifecycle, "kind")
      : undefined;
  if (raw === "current" || raw === "reusable") return raw;
  return "unknown";
}

function compareCandidates(a: GcCandidate, b: GcCandidate): number {
  const rec = recommendationRank(a.recommendation) - recommendationRank(b.recommendation);
  if (rec !== 0) return rec;
  const reason = compareReasons(a.reasons[0]!, b.reasons[0]!);
  if (reason !== 0) return reason;
  return a.path.localeCompare(b.path);
}

function compareReasons(a: GcCandidateReason, b: GcCandidateReason): number {
  return reasonRank(a) - reasonRank(b);
}

function compareCleanupPriority(a: GcHarnessEntry, b: GcHarnessEntry): number {
  const managed = originRank(a.origin) - originRank(b.origin);
  if (managed !== 0) return managed;
  const deprecated = Number(b.deprecated) - Number(a.deprecated);
  if (deprecated !== 0) return deprecated;
  const superseded = Number(Boolean(b.supersededBy)) - Number(Boolean(a.supersededBy));
  if (superseded !== 0) return superseded;
  return oldestFirst(a, b);
}

function compareReusableKeepPriority(a: GcHarnessEntry, b: GcHarnessEntry): number {
  const deprecated = Number(a.deprecated) - Number(b.deprecated);
  if (deprecated !== 0) return deprecated;
  const superseded = Number(Boolean(a.supersededBy)) - Number(Boolean(b.supersededBy));
  if (superseded !== 0) return superseded;
  const useCount = (b.useCount ?? 0) - (a.useCount ?? 0);
  if (useCount !== 0) return useCount;
  return newestFirst(a, b);
}

function newestFirst(a: GcHarnessEntry, b: GcHarnessEntry): number {
  const diff = Date.parse(b.lastUsed ?? b.mtime) - Date.parse(a.lastUsed ?? a.mtime);
  if (diff !== 0) return diff;
  return a.path.localeCompare(b.path);
}

function oldestFirst(a: GcHarnessEntry, b: GcHarnessEntry): number {
  const diff = Date.parse(a.lastUsed ?? a.mtime) - Date.parse(b.lastUsed ?? b.mtime);
  if (diff !== 0) return diff;
  return a.path.localeCompare(b.path);
}

function recommendationRank(recommendation: GcRecommendation): number {
  return recommendation === "delete-candidate" ? 0 : 1;
}

function originRank(origin: GcHarnessOrigin): number {
  return origin === "managed" ? 0 : 1;
}

function reasonRank(reason: GcCandidateReason): number {
  switch (reason) {
    case "stale-current":
      return 0;
    case "current-over-count":
      return 1;
    case "deprecated-reusable":
      return 2;
    case "superseded-reusable":
      return 3;
    case "reusable-over-count":
      return 4;
    case "disk-budget-exceeded":
      return 5;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectField(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = object[key];
  return isObject(value) ? value : undefined;
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

function numberField(
  object: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanField(
  object: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = object[key];
  return typeof value === "boolean" ? value : undefined;
}

function parseDateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  return normalizeRelPath(path.relative(projectRoot, absPath));
}
