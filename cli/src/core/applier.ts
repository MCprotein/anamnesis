// Applier: RenderActions → planned changes → (dry-run report | apply to disk).
//
// Responsibilities:
//   1. Classify each action vs current project state + manifest.
//   2. Enforce --allow-exec-adapters gate for native/fallback agent surfaces.
//   3. Produce a new manifest reflecting post-apply hashes.
//   4. Separately, apply planned changes to disk (createDirs, chmod, write).

import * as fs from "node:fs";
import * as path from "node:path";
import {
  findRegion,
  upsertRegion,
  normalizeRegionContent,
} from "./regions.js";
import {
  findRegion as findRegionEntry,
  findFile as findFileEntry,
  upsertRegion as upsertRegionEntry,
  upsertFile as upsertFileEntry,
  type Manifest,
  type RegionEntry,
  type FileEntry,
} from "./manifest.js";
import { sha256 } from "../util/hash.js";
import type { RenderAction, RegionAction, FileAction } from "./render.js";

// ---------------------------------------------------------------------------
// Executable-adapter gate
// ---------------------------------------------------------------------------

export const EXEC_ADAPTER_PREFIXES = [
  ".claude/hooks/",
  ".claude/commands/",
  ".claude/skills/",
  // Cursor adapter — .mdc files modify agent behavior the same way
  // CC commands/skills do. Treat as exec-gated for supply-chain consistency.
  ".cursor/rules/",
  // Codex adapter — git hook bridge plus executable hook copies.
  ".git/hooks/",
  ".anamnesis/codex-hooks/",
  ".anamnesis/codex-native-hooks/",
] as const;

export function isExecAdapterPath(projectRelative: string): boolean {
  return EXEC_ADAPTER_PREFIXES.some((p) => projectRelative.startsWith(p));
}

// ---------------------------------------------------------------------------
// Change types
// ---------------------------------------------------------------------------

export type ChangeStatus =
  | "create"
  | "update"
  | "noop"
  | "user-modified"
  | "blocked";

export interface RegionChange {
  target: "region";
  file: string;
  regionId: string;
  fragmentId: string;
  fragmentVersion: number;
  status: ChangeStatus;
  /** What the fragment provides (inner region content). */
  newContent?: string;
  /** Full file text that would be written (upsertRegion applied). */
  newFileText?: string;
  /** Full file text currently on disk (empty string if file absent). */
  currentFileText?: string;
  reason?: string;
}

export interface FileChange {
  target: "file";
  path: string;
  fragmentId: string;
  fragmentVersion: number;
  status: ChangeStatus;
  newContent?: string;
  currentContent?: string;
  mode?: number;
  reason?: string;
  /**
   * Propagated from the originating FileAction. Post-apply settings sync
   * uses this to register the hook in `.claude/settings.json` when the
   * change reaches `create` or `update` status.
   */
  settingsHook?: {
    event: string;
    matcher?: string;
  };
  /**
   * Propagated from the originating FileAction. Post-apply Codex sync uses
   * this to merge `.codex/config.toml` and `.codex/hooks.json`.
   */
  codexHook?: {
    event: string;
    matcher?: string;
    command: string;
    timeout?: number;
    statusMessage?: string;
  };
}

export type PlannedChange = RegionChange | FileChange;

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlanOptions {
  projectRoot: string;
  manifest: Manifest;
  allowExecAdapters: boolean;
}

export interface PlanResult {
  changes: PlannedChange[];
  nextManifest: Manifest;
}

export function planChanges(
  actions: RenderAction[],
  opts: PlanOptions,
): PlanResult {
  let manifest = opts.manifest;
  const changes: PlannedChange[] = [];

  // Track in-flight file text for region actions that target the same file.
  // Without this, two regions in the same file each plan against the
  // current disk state and produce conflicting `newFileText` values — the
  // last applier write would erase the earlier one.
  const pendingFileTexts = new Map<string, string>();

  for (const action of actions) {
    if (action.kind === "region") {
      const { change, nextManifest } = planRegion(
        action,
        opts.projectRoot,
        manifest,
        pendingFileTexts,
      );
      changes.push(change);
      manifest = nextManifest;
    } else {
      const { change, nextManifest } = planFile(
        action,
        opts.projectRoot,
        manifest,
        opts.allowExecAdapters,
      );
      changes.push(change);
      manifest = nextManifest;
    }
  }

  return { changes, nextManifest: manifest };
}

function planRegion(
  action: RegionAction,
  projectRoot: string,
  manifest: Manifest,
  pendingFileTexts: Map<string, string>,
): { change: RegionChange; nextManifest: Manifest } {
  const fp = path.join(projectRoot, action.file);
  const currentFileText = pendingFileTexts.has(action.file)
    ? pendingFileTexts.get(action.file)!
    : fs.existsSync(fp)
      ? fs.readFileSync(fp, "utf8")
      : "";
  const currentRegion = currentFileText
    ? findRegion(currentFileText, action.regionId)
    : undefined;
  const manifestEntry = findRegionEntry(
    manifest,
    action.file,
    action.regionId,
  );

  // Hash the *normalized* content — what parseRegions returns after we write.
  // Raw action.content would mismatch the hash read back from disk.
  const newContentHash = sha256(normalizeRegionContent(action.content));
  const newFileText = upsertRegion(currentFileText, {
    id: action.regionId,
    fragmentId: action.fragmentId,
    fragmentVersion: action.fragmentVersion,
    content: action.content,
  });

  const base: RegionChange = {
    target: "region",
    file: action.file,
    regionId: action.regionId,
    fragmentId: action.fragmentId,
    fragmentVersion: action.fragmentVersion,
    status: "create",
  };

  // Case 1: neither region nor manifest entry — fresh create.
  if (!currentRegion && !manifestEntry) {
    const entry: RegionEntry = {
      file: action.file,
      region_id: action.regionId,
      fragment_id: action.fragmentId,
      fragment_version: action.fragmentVersion,
      template_version: action.fragmentVersion,
      base_rendered_hash: newContentHash,
      last_applied_hash: newContentHash,
      current_user_hash: newContentHash,
    };
    pendingFileTexts.set(action.file, newFileText);
    return {
      change: {
        ...base,
        status: "create",
        newContent: action.content,
        newFileText,
        currentFileText,
      },
      nextManifest: upsertRegionEntry(manifest, entry),
    };
  }

  // Case 2: region on disk but manifest doesn't track it — user-authored.
  if (currentRegion && !manifestEntry) {
    pendingFileTexts.set(action.file, currentFileText);
    return {
      change: {
        ...base,
        status: "user-modified",
        newContent: action.content,
        newFileText,
        currentFileText,
        reason: "region exists in file but not tracked in manifest",
      },
      nextManifest: manifest,
    };
  }

  // Case 3: manifest entry without region on disk — user deleted it.
  if (!currentRegion && manifestEntry) {
    pendingFileTexts.set(action.file, currentFileText);
    return {
      change: {
        ...base,
        status: "user-modified",
        newContent: action.content,
        newFileText,
        currentFileText,
        reason: "region tracked in manifest but not found on disk",
      },
      nextManifest: manifest,
    };
  }

  // Case 4: both exist — compare hashes.
  const currentHash = sha256(currentRegion!.content);
  if (currentHash !== manifestEntry!.last_applied_hash) {
    pendingFileTexts.set(action.file, currentFileText);
    return {
      change: {
        ...base,
        status: "user-modified",
        newContent: action.content,
        newFileText,
        currentFileText,
        reason: "region content differs from last-applied hash",
      },
      nextManifest: manifest,
    };
  }

  if (newContentHash === currentHash) {
    pendingFileTexts.set(action.file, currentFileText);
    return { change: { ...base, status: "noop" }, nextManifest: manifest };
  }

  // Update: user hasn't touched, library content differs.
  const entry: RegionEntry = {
    ...manifestEntry!,
    fragment_version: action.fragmentVersion,
    template_version: action.fragmentVersion,
    last_applied_hash: newContentHash,
    current_user_hash: newContentHash,
    // base_rendered_hash intentionally preserved — it's the original baseline.
  };
  pendingFileTexts.set(action.file, newFileText);
  return {
    change: {
      ...base,
      status: "update",
      newContent: action.content,
      newFileText,
      currentFileText,
    },
    nextManifest: upsertRegionEntry(manifest, entry),
  };
}

function planFile(
  action: FileAction,
  projectRoot: string,
  manifest: Manifest,
  allowExec: boolean,
): { change: FileChange; nextManifest: Manifest } {
  const fp = path.join(projectRoot, action.path);
  const exists = fs.existsSync(fp);
  const currentContent = exists ? fs.readFileSync(fp, "utf8") : undefined;
  const manifestEntry = findFileEntry(manifest, action.path);

  const newContentHash = sha256(action.content);
  const currentHash =
    currentContent !== undefined ? sha256(currentContent) : null;
  const isExec =
    isExecAdapterPath(action.path) || action.mode !== undefined;

  const base: FileChange = {
    target: "file",
    path: action.path,
    fragmentId: action.fragmentId,
    fragmentVersion: action.fragmentVersion,
    status: "create",
    mode: action.mode,
    settingsHook: action.settingsHook,
    codexHook: action.codexHook,
  };

  // Compute intended status.
  let status: ChangeStatus;
  let reason: string | undefined;

  if (!exists && !manifestEntry) {
    status = "create";
  } else if (exists && !manifestEntry) {
    status = "user-modified";
    reason = "file exists on disk but not tracked in manifest";
  } else if (!exists && manifestEntry) {
    status = "user-modified";
    reason = "file tracked in manifest but missing on disk";
  } else if (currentHash !== manifestEntry!.last_applied_hash) {
    status = "user-modified";
    reason = "file content differs from last-applied hash";
  } else if (newContentHash === currentHash) {
    status = "noop";
  } else {
    status = "update";
  }

  // Exec-adapter gate: only blocks actual writes (create/update).
  if (isExec && !allowExec && (status === "create" || status === "update")) {
    return {
      change: {
        ...base,
        status: "blocked",
        newContent: action.content,
        currentContent,
        reason: "executable adapter write requires --allow-exec-adapters",
      },
      nextManifest: manifest,
    };
  }

  // Non-writing statuses: don't mutate manifest.
  if (status === "noop" || status === "user-modified") {
    return {
      change: {
        ...base,
        status,
        newContent: action.content,
        currentContent,
        reason,
      },
      nextManifest: manifest,
    };
  }

  // create / update
  const entry: FileEntry = manifestEntry
    ? {
        ...manifestEntry,
        fragment_version: action.fragmentVersion,
        last_applied_hash: newContentHash,
        current_user_hash: newContentHash,
      }
    : {
        path: action.path,
        fragment_id: action.fragmentId,
        fragment_version: action.fragmentVersion,
        last_applied_hash: newContentHash,
        current_user_hash: newContentHash,
      };

  return {
    change: {
      ...base,
      status,
      newContent: action.content,
      currentContent,
    },
    nextManifest: upsertFileEntry(manifest, entry),
  };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export interface ApplyOptions {
  projectRoot: string;
}

/**
 * Write planned changes to disk. Only `create` and `update` statuses perform
 * writes; `noop`, `user-modified`, `blocked` are pass-through (no-op).
 *
 * Writes happen in the order supplied — callers that need dependency ordering
 * (e.g., create directory before file inside) should order actions upstream.
 */
export function applyChanges(
  changes: PlannedChange[],
  opts: ApplyOptions,
): void {
  for (const change of changes) {
    if (change.status !== "create" && change.status !== "update") continue;

    if (change.target === "region") {
      if (change.newFileText === undefined) {
        throw new Error(
          `region change for ${change.file} missing newFileText`,
        );
      }
      const fp = path.join(opts.projectRoot, change.file);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, change.newFileText, "utf8");
    } else {
      if (change.newContent === undefined) {
        throw new Error(`file change for ${change.path} missing newContent`);
      }
      const fp = path.join(opts.projectRoot, change.path);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, change.newContent, "utf8");
      if (change.mode !== undefined) {
        fs.chmodSync(fp, change.mode);
      }
    }
  }
}

/**
 * Copy any file that would be modified into a backup directory.
 * Returns the relative paths that were backed up.
 *
 * Only `update` statuses are backed up — `create` has no prior content,
 * and `user-modified` / `blocked` / `noop` are not written in the first place.
 */
export function backupBeforeApply(
  changes: PlannedChange[],
  opts: { projectRoot: string; backupDir: string },
): string[] {
  const backedUp: string[] = [];
  for (const change of changes) {
    if (change.status !== "update") continue;
    const rel = change.target === "region" ? change.file : change.path;
    const source = path.join(opts.projectRoot, rel);
    if (!fs.existsSync(source)) continue;
    const target = path.join(opts.backupDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    backedUp.push(rel);
  }
  return backedUp;
}
