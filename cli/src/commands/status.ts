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
  loadAllFragments,
  loadBaseFragment,
  type FragmentDefinition,
} from "../core/fragments.js";
import {
  loadRulebook,
  matchingRules,
  type Rule,
} from "../core/rulebook.js";
import { ProjectContext } from "../core/triggers.js";
import { findRegion } from "../core/regions.js";
import { sha256 } from "../util/hash.js";

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
}

export interface StatusResult {
  agentfile: Agentfile;
  fragments: FragmentStatus[];
  entries: EntryStatus[];
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
    suggestedCount: number;
    declinedCount: number;
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
  const suggested = matched.filter(
    (r) => !installedIds.has(r.suggest) && !declinedIds.has(r.suggest),
  );

  const declined: DeclinedEntry[] = (agentfile.declined ?? []).map((d) => ({
    id: d.id,
    reason: d.reason,
    declinedAt: d.declined_at,
  }));

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
    suggestedCount: suggested.length,
    declinedCount: declined.length,
  };

  return {
    agentfile,
    fragments,
    entries,
    suggested,
    declined,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Manifest typing for compactness (used internally above)
// ---------------------------------------------------------------------------

// Re-export type-only; consumers don't need to import Manifest directly.
export type { Manifest };
