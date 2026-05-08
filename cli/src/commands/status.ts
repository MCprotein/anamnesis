// `anamnesis status` — read-only project state report.
//
// Reads the Agentfile + manifest, compares against the library, and produces
// a structured snapshot:
//   * fragments: installed version vs library version (in-sync / update / pinned / library-missing)
//   * regions: drift per AGENTS.md region anchor
//   * files: drift per tracked file
//   * suggested: rulebook matches not yet in Agentfile and not declined
//   * declined: explicit opt-outs from Agentfile
//
// No writes. No side effects. Safe to run anytime.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  findAgentfile,
  readAgentfile,
  type Agentfile,
} from "../core/agentfile.js";
import {
  readManifest,
  type Manifest,
  type RegionEntry,
  type FileEntry,
} from "../core/manifest.js";
import {
  collectDependencyProblems,
  loadAllFragments,
  loadBaseFragment,
  loadFragmentAtVersion,
  type FragmentDependencyProblem,
  type FragmentDefinition,
} from "../core/fragments.js";
import { effectiveScopes, type EffectiveScope } from "../core/scope.js";
import {
  loadRulebook,
  matchingRules,
  type Rule,
} from "../core/rulebook.js";
import { ProjectContext } from "../core/triggers.js";
import { findRegion } from "../core/regions.js";
import { sha256 } from "../util/hash.js";
import { CLAUDE_MD_REGION_ID } from "../adapters/claude-code/claude_md.js";
import {
  collectOntologyGaps,
  type OntologyGapStatus,
} from "../core/ontology-gaps.js";
import { makeBuiltinIntrospectorRegistry } from "../introspectors/index.js";
import {
  CODEX_CONFIG_PATH,
  CODEX_HOOKS_PATH,
  analyzeCodexHookOwnership,
  codexHookRegistrationPresent,
  codexHooksFeatureEnabled,
  codexNativeNodeCommand,
  type CodexHookOwnershipReport,
} from "../core/codex_native.js";
import {
  readEvidenceSummary,
  type RuntimeEvidenceSummary,
} from "../core/evidence.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Drift = "clean" | "user-modified" | "missing";

export type FragmentSyncStatus =
  | "in-sync"
  | "update-available"
  | "pinned"
  | "library-missing";

export interface FragmentStatus {
  id: string;
  installedVersion: number;
  libraryVersion: number | null;
  pinned: boolean;
  status: FragmentSyncStatus;
}

export interface RegionStatus {
  target: "region";
  file: string;
  regionId: string;
  fragmentId: string;
  fragmentVersion: number;
  drift: Drift;
}

export interface FileStatus {
  target: "file";
  path: string;
  fragmentId: string;
  fragmentVersion: number;
  drift: Drift;
}

export type EntryStatus = RegionStatus | FileStatus;

export interface DeclinedEntry {
  id: string;
  reason?: string;
  declinedAt?: string;
  /** True when the current rulebook still matches this declined fragment. */
  matched: boolean;
}

export interface ScopeStatus {
  /** Scope path (`.` for root, `apps/api` for sub-scope, etc.). */
  path: string;
  /** Effective fragment list for this scope (root + inherited + overrides). */
  fragments: FragmentStatus[];
  /** Manifest entries (regions + files) belonging to this scope. */
  entries: EntryStatus[];
}

export type ContinuityCheckId =
  | "project-memory"
  | "ontology"
  | "handoff"
  | "active-handoff"
  | "adapter-surfaces"
  | "managed-drift";

export interface ContinuityCheck {
  id: ContinuityCheckId;
  label: string;
  status: "pass" | "fail";
  detail: string;
  targets: string[];
}

export interface ContinuityStatus {
  ready: boolean;
  passed: number;
  total: number;
  checks: ContinuityCheck[];
}

export interface FragmentDependencyStatus {
  ready: boolean;
  problems: Array<FragmentDependencyProblem & { scopePath: string }>;
  summary: {
    total: number;
    missing: number;
    versionUnsatisfied: number;
    pinnedVersionUnsatisfied: number;
    cycles: number;
  };
}

export interface StatusResult {
  agentfile: Agentfile;
  /** Flat union across all scopes — preserved for back-compat and quick overview. */
  fragments: FragmentStatus[];
  /** Flat union of manifest entries — preserved for back-compat. */
  entries: EntryStatus[];
  /**
   * Per-scope grouping. Single-scope projects have one entry (`.`)
   * containing the same data as the flat lists. Multi-scope projects
   * have one entry per declared scope.
   */
  scopes: ScopeStatus[];
  /** Continuity readiness for the adapters enabled in this Agentfile. */
  continuity: ContinuityStatus;
  /** Ownership and advisory warnings for co-installed Codex native hooks. */
  codexHooks: CodexHookOwnershipReport;
  /** Ontology lifecycle gaps across static, bootstrap, and enriched layers. */
  ontology: OntologyGapStatus;
  /** Durable runtime evidence emitted by append-style checks. */
  evidence: RuntimeEvidenceSummary;
  /** Fragment dependency graph health across effective scopes. */
  dependencies: FragmentDependencyStatus;
  suggested: Rule[];
  declined: DeclinedEntry[];
  /** Counts for quick check / CLI summary. */
  summary: {
    fragmentTotal: number;
    fragmentUpdatesAvailable: number;
    fragmentLibraryMissing: number;
    fragmentPinned: number;
    entriesClean: number;
    entriesUserModified: number;
    entriesMissing: number;
    ontologyGapWarnings: number;
    ontologyGapInfo: number;
    evidenceRecords: number;
    evidenceInvalidRecords: number;
    dependencyProblems: number;
    suggestedCount: number;
    declinedCount: number;
    declinedStaleCount: number;
  };
}

export class StatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatusError";
  }
}

export interface StatusOptions {
  projectRoot: string;
  libraryRoot: string;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

function regionDrift(entry: RegionEntry, projectRoot: string): Drift {
  const fp = path.join(projectRoot, entry.file);
  if (!fs.existsSync(fp)) return "missing";
  const text = fs.readFileSync(fp, "utf8");
  const region = findRegion(text, entry.region_id);
  if (!region) return "missing";
  const currentHash = sha256(region.content);
  return currentHash === entry.last_applied_hash ? "clean" : "user-modified";
}

function fileDrift(entry: FileEntry, projectRoot: string): Drift {
  const fp = path.join(projectRoot, entry.path);
  if (!fs.existsSync(fp)) return "missing";
  const currentHash = sha256(fs.readFileSync(fp, "utf8"));
  return currentHash === entry.last_applied_hash ? "clean" : "user-modified";
}

// ---------------------------------------------------------------------------
// Fragment sync analysis
// ---------------------------------------------------------------------------

function libraryFragmentMap(
  libraryRoot: string,
): Map<string, FragmentDefinition> {
  const fragments = loadAllFragments(libraryRoot);
  const base = loadBaseFragment(libraryRoot);
  if (base) fragments.set(base.id, base);
  return fragments;
}

function classifyFragment(
  installed: { id: string; version: number; pinned?: boolean },
  library: Map<string, FragmentDefinition>,
): FragmentStatus {
  const lib = library.get(installed.id);
  const pinned = installed.pinned === true;
  if (!lib) {
    return {
      id: installed.id,
      installedVersion: installed.version,
      libraryVersion: null,
      pinned,
      status: "library-missing",
    };
  }
  if (pinned) {
    return {
      id: installed.id,
      installedVersion: installed.version,
      libraryVersion: lib.version,
      pinned: true,
      status: "pinned",
    };
  }
  if (lib.version !== installed.version) {
    return {
      id: installed.id,
      installedVersion: installed.version,
      libraryVersion: lib.version,
      pinned: false,
      status: "update-available",
    };
  }
  return {
    id: installed.id,
    installedVersion: installed.version,
    libraryVersion: lib.version,
    pinned: false,
    status: "in-sync",
  };
}

function resolveDependencyFragment(
  libraryRoot: string,
  entry: { id: string; version: number; pinned?: boolean },
  library: Map<string, FragmentDefinition>,
): FragmentDefinition | undefined {
  const current = library.get(entry.id);
  if (!current) return undefined;
  if (!entry.pinned && current.version === entry.version) return current;

  try {
    return loadFragmentAtVersion(libraryRoot, entry.id, entry.version) ?? current;
  } catch {
    // Broken archives are reported elsewhere as library/doctor issues. For the
    // dependency graph, fall back to the current library fragment so status can
    // still surface actionable dependency requirements.
    return current;
  }
}

function collectDependencyStatus(input: {
  libraryRoot: string;
  scopes: EffectiveScope[];
  library: Map<string, FragmentDefinition>;
}): FragmentDependencyStatus {
  const problems: FragmentDependencyStatus["problems"] = [];

  for (const scope of input.scopes) {
    const fragments: FragmentDefinition[] = [];
    const entries = new Map<
      string,
      { version: number; pinned?: boolean; libraryVersion?: number }
    >();

    for (const entry of scope.fragments) {
      if (entries.has(entry.id)) continue;
      entries.set(entry.id, {
        version: entry.version,
        pinned: entry.pinned,
        libraryVersion: input.library.get(entry.id)?.version,
      });
      const fragment = resolveDependencyFragment(
        input.libraryRoot,
        entry,
        input.library,
      );
      if (fragment) fragments.push(fragment);
    }

    for (const problem of collectDependencyProblems({ fragments, entries })) {
      problems.push({ ...problem, scopePath: scope.path });
    }
  }

  return {
    ready: problems.length === 0,
    problems,
    summary: {
      total: problems.length,
      missing: problems.filter((p) => p.kind === "missing").length,
      versionUnsatisfied: problems.filter(
        (p) => p.kind === "version-unsatisfied",
      ).length,
      pinnedVersionUnsatisfied: problems.filter(
        (p) => p.kind === "pinned-version-unsatisfied",
      ).length,
      cycles: problems.filter((p) => p.kind === "cycle").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function status(opts: StatusOptions): StatusResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);

  if (!findAgentfile(projectRoot)) {
    throw new StatusError(
      `no Agentfile found in ${projectRoot}. Run 'anamnesis init' first.`,
    );
  }

  const agentfile = readAgentfile(projectRoot);
  const manifest = readManifest(projectRoot);

  // Fragment sync analysis.
  const library = libraryFragmentMap(libraryRoot);
  const fragments: FragmentStatus[] = agentfile.fragments.map((f) =>
    classifyFragment(f, library),
  );

  // Drift per region + per file (manifest-tracked entries only).
  const entries: EntryStatus[] = [];
  for (const r of manifest.regions) {
    entries.push({
      target: "region",
      file: r.file,
      regionId: r.region_id,
      fragmentId: r.fragment_id,
      fragmentVersion: r.fragment_version,
      drift: regionDrift(r, projectRoot),
    });
  }
  for (const f of manifest.files) {
    entries.push({
      target: "file",
      path: f.path,
      fragmentId: f.fragment_id,
      fragmentVersion: f.fragment_version,
      drift: fileDrift(f, projectRoot),
    });
  }

  // Rulebook suggestions (matches not in Agentfile and not declined).
  const installedIds = new Set(agentfile.fragments.map((f) => f.id));
  const declinedIds = new Set(
    (agentfile.declined ?? []).map((d) => d.id),
  );
  const ctx = new ProjectContext(projectRoot);
  const matched = matchingRules(loadRulebook(libraryRoot), ctx);
  const matchedSuggestedIds = new Set(matched.map((rule) => rule.suggest));
  const suggested = matched.filter(
    (r) => !installedIds.has(r.suggest) && !declinedIds.has(r.suggest),
  );

  const declined: DeclinedEntry[] = (agentfile.declined ?? []).map((d) => ({
    id: d.id,
    reason: d.reason,
    declinedAt: d.declined_at,
    matched: matchedSuggestedIds.has(d.id),
  }));

  // Per-scope grouping: assign each fragment + entry to the longest-matching
  // scope path. Single-scope projects collapse to a single ScopeStatus("." ).
  const effectiveScopeList = effectiveScopes(agentfile);
  const scopes: ScopeStatus[] = computeScopeStatus(
    effectiveScopeList,
    library,
    entries,
  );
  const dependencies = collectDependencyStatus({
    libraryRoot,
    scopes: effectiveScopeList,
    library,
  });
  const ontology = collectOntologyGaps({
    projectRoot,
    scopes: effectiveScopeList,
    library,
    registry: makeBuiltinIntrospectorRegistry(),
  });
  const codexHooks = analyzeProjectCodexHookOwnership(projectRoot);
  const evidence = readEvidenceSummary(projectRoot, {
    now: (opts.now ?? (() => new Date()))(),
  });

  // Summary counts.
  const summary = {
    fragmentTotal: fragments.length,
    fragmentUpdatesAvailable: fragments.filter(
      (f) => f.status === "update-available",
    ).length,
    fragmentLibraryMissing: fragments.filter(
      (f) => f.status === "library-missing",
    ).length,
    fragmentPinned: fragments.filter((f) => f.status === "pinned").length,
    entriesClean: entries.filter((e) => e.drift === "clean").length,
    entriesUserModified: entries.filter((e) => e.drift === "user-modified")
      .length,
    entriesMissing: entries.filter((e) => e.drift === "missing").length,
    ontologyGapWarnings: ontology.summary.warnings,
    ontologyGapInfo: ontology.summary.info,
    evidenceRecords: evidence.total,
    evidenceInvalidRecords: evidence.invalid,
    dependencyProblems: dependencies.summary.total,
    suggestedCount: suggested.length,
    declinedCount: declined.length,
    declinedStaleCount: declined.filter((d) => !d.matched).length,
  };
  const continuity = computeContinuityStatus({
    projectRoot,
    tools: agentfile.tools,
    entries,
    summary,
  });

  return {
    agentfile,
    fragments,
    entries,
    scopes,
    continuity,
    codexHooks,
    ontology,
    evidence,
    dependencies,
    suggested,
    declined,
    summary,
  };
}

function computeContinuityStatus(opts: {
  projectRoot: string;
  tools: Agentfile["tools"];
  entries: EntryStatus[];
  summary: StatusResult["summary"];
}): ContinuityStatus {
  const { projectRoot, tools, entries, summary } = opts;
  const checks: ContinuityCheck[] = [];

  const projectMemoryTargets = ["AGENTS.md [region:anamnesis-base]"];
  checks.push({
    id: "project-memory",
    label: "Project memory",
    status: hasCleanRegion(entries, "AGENTS.md", "anamnesis-base")
      ? "pass"
      : "fail",
    detail: "AGENTS.md baseline region is installed and clean",
    targets: projectMemoryTargets,
  });

  const ontologyTargets = entries
    .filter(
      (e) =>
        e.target === "file" &&
        e.path.startsWith(".anamnesis/ontology/") &&
        e.drift === "clean",
    )
    .map((e) => (e.target === "file" ? e.path : ""));
  checks.push({
    id: "ontology",
    label: "Ontology availability",
    status: ontologyTargets.length > 0 ? "pass" : "fail",
    detail:
      ontologyTargets.length > 0
        ? `${ontologyTargets.length} clean ontology file(s) are tracked`
        : "no clean .anamnesis/ontology/*.yaml file is tracked",
    targets:
      ontologyTargets.length > 0 ? ontologyTargets : [".anamnesis/ontology/*.yaml"],
  });

  const baseRegion = readRegionContent(
    projectRoot,
    "AGENTS.md",
    "anamnesis-base",
  );
  const handoffReady =
    hasCleanRegion(entries, "AGENTS.md", "anamnesis-base") &&
    baseRegion !== undefined &&
    baseRegion.includes(".anamnesis/handoff/") &&
    baseRegion.includes(".anamnesis/handoff/active.md") &&
    baseRegion.includes("stale");
  checks.push({
    id: "handoff",
    label: "Handoff startup",
    status: handoffReady ? "pass" : "fail",
    detail:
      "session-start instructions include active handoff loading and stale handoff handling",
    targets: [
      "AGENTS.md [region:anamnesis-base]",
      ".anamnesis/handoff/active.md",
    ],
  });

  const activeHandoff = validateActiveHandoff(projectRoot);
  checks.push({
    id: "active-handoff",
    label: "Active handoff state",
    status: activeHandoff.status,
    detail: activeHandoff.detail,
    targets: activeHandoff.targets,
  });

  const adapterTargets = adapterContinuityTargets(tools);
  const missingAdapterTargets = adapterTargets.filter(
    (target) => !targetClean(projectRoot, entries, target),
  );
  checks.push({
    id: "adapter-surfaces",
    label: "Adapter surfaces",
    status: missingAdapterTargets.length === 0 ? "pass" : "fail",
    detail:
      missingAdapterTargets.length === 0
        ? `enabled adapters have clean native or fallback surfaces (${tools.join(", ")})`
        : `missing or drifted surfaces: ${missingAdapterTargets.join(", ")}`,
    targets:
      missingAdapterTargets.length === 0 ? adapterTargets : missingAdapterTargets,
  });

  const driftReady =
    summary.entriesMissing === 0 &&
    summary.entriesUserModified === 0 &&
    summary.fragmentLibraryMissing === 0;
  checks.push({
    id: "managed-drift",
    label: "Managed drift",
    status: driftReady ? "pass" : "fail",
    detail: `${summary.entriesClean} clean, ${summary.entriesUserModified} modified, ${summary.entriesMissing} missing`,
    targets: [],
  });

  const passed = checks.filter((c) => c.status === "pass").length;
  return {
    ready: passed === checks.length,
    passed,
    total: checks.length,
    checks,
  };
}

function validateActiveHandoff(projectRoot: string): ContinuityCheck {
  const activeRel = ".anamnesis/handoff/active.md";
  const activePath = path.join(projectRoot, activeRel);
  if (!fs.existsSync(activePath)) {
    return {
      id: "active-handoff",
      label: "Active handoff state",
      status: "pass",
      detail: "no active handoff file is present",
      targets: [activeRel],
    };
  }

  const activeText = fs.readFileSync(activePath, "utf8");
  const activeArchiveRefs = extractArchiveRefs(activeText);
  const openTaskLines = activeHandoffOpenTaskLines(activeText);
  if (openTaskLines.length === 0) {
    return {
      id: "active-handoff",
      label: "Active handoff state",
      status: "pass",
      detail: "active handoff has no open task entries",
      targets: [activeRel],
    };
  }

  const completed = openTaskLines.filter(isCompletedHandoffTaskLine);
  if (completed.length > 0) {
    return {
      id: "active-handoff",
      label: "Active handoff state",
      status: "fail",
      detail: `active handoff has completed or superseded task entries: ${completed.join("; ")}`,
      targets: [activeRel],
    };
  }

  const archiveRefs = extractArchiveRefs(openTaskLines.join("\n"));
  if (archiveRefs.length === 0) {
    return {
      id: "active-handoff",
      label: "Active handoff state",
      status: "fail",
      detail: "active handoff has open task entries without archive references",
      targets: [activeRel],
    };
  }

  const missingArchiveRefs = archiveRefs.filter((ref) => {
    const resolved = resolveProjectPath(projectRoot, ref);
    return resolved === undefined || !fs.existsSync(resolved);
  });
  if (missingArchiveRefs.length > 0) {
    return {
      id: "active-handoff",
      label: "Active handoff state",
      status: "fail",
      detail: `active handoff references missing archive(s): ${missingArchiveRefs.join(", ")}`,
      targets: [activeRel, ...archiveRefs],
    };
  }

  const newest = newestHandoffArchive(projectRoot);
  if (newest !== undefined && !activeArchiveRefs.includes(newest.rel)) {
    return {
      id: "active-handoff",
      label: "Active handoff state",
      status: "fail",
      detail: `active handoff does not reference newest archive: ${newest.rel}`,
      targets: [activeRel, newest.rel, ...archiveRefs],
    };
  }

  const invalidArchives = archiveRefs.filter((ref) => {
    const resolved = resolveProjectPath(projectRoot, ref);
    if (resolved === undefined) return true;
    const text = fs.readFileSync(resolved, "utf8");
    return !text.includes("## Goal") || !text.includes("## Next steps");
  });
  if (invalidArchives.length > 0) {
    return {
      id: "active-handoff",
      label: "Active handoff state",
      status: "fail",
      detail: `active handoff archive(s) are missing required sections: ${invalidArchives.join(", ")}`,
      targets: [activeRel, ...archiveRefs],
    };
  }

  return {
    id: "active-handoff",
    label: "Active handoff state",
    status: "pass",
    detail: `active handoff references ${archiveRefs.length} current archive(s)`,
    targets: [activeRel, ...archiveRefs],
  };
}

function activeHandoffOpenTaskLines(text: string): string[] {
  const lines: string[] = [];
  let inOpenSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s+(Current focus|Active tasks)\s*$/i.test(line.trim())) {
      inOpenSection = true;
      continue;
    }
    if (/^##\s+/.test(line.trim())) {
      inOpenSection = false;
      continue;
    }
    if (inOpenSection && line.trim().startsWith("-")) {
      lines.push(line.trim());
    }
  }
  return lines;
}

function isCompletedHandoffTaskLine(line: string): boolean {
  return (
    /\[(done|completed|superseded)\]/i.test(line) ||
    /\bcompleted in\b/i.test(line) ||
    /\bsuperseded by\b/i.test(line)
  );
}

function extractArchiveRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/archive:\s*`([^`]+)`/g)) {
    refs.add(match[1]!.trim());
  }
  for (const match of text.matchAll(/archive:\s*([^\s]+)/g)) {
    refs.add(match[1]!.replace(/^`+|[`.,;)]+$/g, "").trim());
  }
  return Array.from(refs).filter((ref) => ref.length > 0);
}

function newestHandoffArchive(
  projectRoot: string,
): { rel: string; mtimeMs: number } | undefined {
  const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
  if (!fs.existsSync(handoffDir)) return undefined;
  return fs
    .readdirSync(handoffDir)
    .filter((name) => name.endsWith(".md") && name !== "active.md")
    .map((name) => {
      const rel = path.join(".anamnesis", "handoff", name);
      const abs = path.join(projectRoot, rel);
      return {
        rel: rel.split(path.sep).join("/"),
        mtimeMs: fs.statSync(abs).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel))[0];
}

function resolveProjectPath(projectRoot: string, rel: string): string | undefined {
  const resolved = path.resolve(projectRoot, rel);
  const root = path.resolve(projectRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return undefined;
  }
  return resolved;
}

function adapterContinuityTargets(tools: Agentfile["tools"]): string[] {
  const targets: string[] = [];
  if (tools.includes("claude-code")) {
    targets.push(
      `CLAUDE.md [region:${CLAUDE_MD_REGION_ID}]`,
      ".claude/hooks/inject-ontology.sh",
      ".claude/hooks/inject-handoff.sh",
      ".claude/hooks/handoff-reminder.sh",
      ".claude/commands/load-context.md",
      ".claude/commands/handoff-prepare.md",
      ".claude/skills/load-context/SKILL.md",
      ".claude/skills/ontology-enrich/SKILL.md",
    );
  }
  if (tools.includes("codex")) {
    targets.push(
      ".anamnesis/codex-native-hooks/session-start.mjs",
      `${CODEX_CONFIG_PATH} [features.codex_hooks=true]`,
      `${CODEX_HOOKS_PATH} [hook:SessionStart:${codexNativeNodeCommand(".anamnesis/codex-native-hooks/session-start.mjs")}]`,
      `${CODEX_HOOKS_PATH} [hook:PostToolUse:${codexNativeNodeCommand(".anamnesis/codex-native-hooks/base-PostToolUse-Edit-remind-uncommitted.mjs")}]`,
      `${CODEX_HOOKS_PATH} [hook:Stop:${codexNativeNodeCommand(".anamnesis/codex-native-hooks/base-Stop-handoff-reminder.mjs")}]`,
      "AGENTS.md [region:codex-cmd-load-context]",
      "AGENTS.md [region:codex-cmd-handoff-prepare]",
      "AGENTS.md [region:codex-skill-load-context]",
      "AGENTS.md [region:codex-skill-ontology-enrich]",
    );
  }
  if (tools.includes("cursor")) {
    targets.push(
      ".cursor/rules/load-context-cmd.mdc",
      ".cursor/rules/handoff-prepare-cmd.mdc",
      ".cursor/rules/load-context.mdc",
      ".cursor/rules/ontology-enrich.mdc",
    );
  }
  return targets;
}

function targetClean(
  projectRoot: string,
  entries: EntryStatus[],
  target: string,
): boolean {
  if (target === `${CODEX_CONFIG_PATH} [features.codex_hooks=true]`) {
    return codexConfigTargetReady(projectRoot);
  }
  const codexHook = target.match(
    /^\.codex\/hooks\.json \[hook:([^:]+):(.+)\]$/,
  );
  if (codexHook) {
    return codexHookTargetReady(projectRoot, codexHook[1]!, codexHook[2]!);
  }
  const regionMatch = target.match(/^(.+) \[region:(.+)\]$/);
  if (regionMatch) {
    return hasCleanRegion(entries, regionMatch[1]!, regionMatch[2]!);
  }
  return hasCleanFile(entries, target);
}

function hasCleanRegion(
  entries: EntryStatus[],
  file: string,
  regionId: string,
): boolean {
  return entries.some(
    (e) =>
      e.target === "region" &&
      e.file === file &&
      e.regionId === regionId &&
      e.drift === "clean",
  );
}

function hasCleanFile(entries: EntryStatus[], filepath: string): boolean {
  return entries.some(
    (e) => e.target === "file" && e.path === filepath && e.drift === "clean",
  );
}

function codexConfigTargetReady(projectRoot: string): boolean {
  const fp = path.join(projectRoot, CODEX_CONFIG_PATH);
  if (!fs.existsSync(fp)) return false;
  try {
    return codexHooksFeatureEnabled(fs.readFileSync(fp, "utf8"));
  } catch {
    return false;
  }
}

function codexHookTargetReady(
  projectRoot: string,
  event: string,
  command: string,
): boolean {
  const fp = path.join(projectRoot, CODEX_HOOKS_PATH);
  if (!fs.existsSync(fp)) return false;
  try {
    return codexHookRegistrationPresent(fs.readFileSync(fp, "utf8"), {
      event,
      matcher: codexContinuityMatcher(event, command),
      command,
    });
  } catch {
    return false;
  }
}

function analyzeProjectCodexHookOwnership(
  projectRoot: string,
): CodexHookOwnershipReport {
  const fp = path.join(projectRoot, CODEX_HOOKS_PATH);
  if (!fs.existsSync(fp)) return analyzeCodexHookOwnership(undefined);
  try {
    return analyzeCodexHookOwnership(fs.readFileSync(fp, "utf8"));
  } catch (e) {
    return {
      ...analyzeCodexHookOwnership(undefined),
      parseError: `${CODEX_HOOKS_PATH} could not be read: ${(e as Error).message}`,
    };
  }
}

function codexContinuityMatcher(
  event: string,
  command: string,
): string | undefined {
  if (event === "SessionStart") return "startup|resume|clear";
  if (
    event === "PostToolUse" &&
    command.includes("base-PostToolUse-Edit-remind-uncommitted.mjs")
  ) {
    return "Edit|Write|apply_patch";
  }
  return undefined;
}

function readRegionContent(
  projectRoot: string,
  file: string,
  regionId: string,
): string | undefined {
  const fp = path.join(projectRoot, file);
  if (!fs.existsSync(fp)) return undefined;
  return findRegion(fs.readFileSync(fp, "utf8"), regionId)?.content;
}

/**
 * Distribute fragment statuses + manifest entries into per-scope buckets.
 *
 * - Fragment status is computed against each scope's effective fragment list
 *   (so a sub-scope that adds `nestjs` shows it; root doesn't).
 * - Each entry is assigned to the longest-matching scope path. Exec-adapter
 *   files (`.claude/*`) always belong to root since CC settings.json is
 *   read only at root.
 */
function computeScopeStatus(
  effectiveScopeList: EffectiveScope[],
  library: Map<string, FragmentDefinition>,
  allEntries: EntryStatus[],
): ScopeStatus[] {
  const scopes: ScopeStatus[] = [];
  for (const scope of effectiveScopeList) {
    const fragments: FragmentStatus[] = scope.fragments.map((f) =>
      classifyFragment(f, library),
    );
    scopes.push({ path: scope.path, fragments, entries: [] });
  }

  // Bucket entries: longest-matching non-root scope wins; otherwise root.
  for (const entry of allEntries) {
    const entryPath =
      entry.target === "region" ? entry.file : entry.path;
    let bestScope = scopes.find((s) => s.path === ".");
    let bestLen = 0;
    for (const scope of scopes) {
      if (scope.path === ".") continue;
      if (
        entryPath === scope.path ||
        entryPath.startsWith(scope.path + "/")
      ) {
        if (scope.path.length > bestLen) {
          bestLen = scope.path.length;
          bestScope = scope;
        }
      }
    }
    if (bestScope) bestScope.entries.push(entry);
  }

  return scopes;
}

// ---------------------------------------------------------------------------
// Manifest typing for compactness (used internally above)
// ---------------------------------------------------------------------------

// Re-export type-only; consumers don't need to import Manifest directly.
export type { Manifest };
