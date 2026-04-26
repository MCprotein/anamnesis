// `anamnesis update` — re-apply library state to a project that already has
// an Agentfile.
//
// Differences from `init`:
//   * Requires an existing Agentfile (errors otherwise — directs to `init`).
//   * Reads the existing manifest so drift (user-modified) is preserved.
//   * Default dry-run; `--apply` to actually write.
//   * Backs up any files about to be updated under `.anamnesis/backups/<ts>/`.
//   * Auto-bumps Agentfile fragment versions to match the library on apply.
//   * Reports new rulebook matches as `suggested` — does NOT auto-install.

import * as path from "node:path";
import {
  readAgentfile,
  writeAgentfile,
  findAgentfile,
  type Agentfile,
} from "../core/agentfile.js";
import {
  readManifest,
  writeManifest,
  type Manifest,
} from "../core/manifest.js";
import {
  loadRulebook,
  matchingRules,
  type Rule,
} from "../core/rulebook.js";
import {
  loadAllFragments,
  loadBaseFragment,
  topologicalSort,
  detectConflicts,
  type FragmentDefinition,
} from "../core/fragments.js";
import { ProjectContext } from "../core/triggers.js";
import {
  RendererRegistry,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";
import { registerClaudeCode } from "../adapters/claude-code/index.js";
import {
  planChanges,
  applyChanges,
  backupBeforeApply,
  type PlannedChange,
} from "../core/applier.js";
import {
  syncHookRegistrations,
  type HookRegistration,
  type HookSyncResult,
} from "../core/settings.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  projectRoot: string;
  libraryRoot: string;
  apply: boolean;
  allowExecAdapters: boolean;
}

export interface UpdateResult {
  /** Agentfile reflecting library-current versions (only persisted on apply). */
  agentfile: Agentfile;
  changes: PlannedChange[];
  nextManifest: Manifest;
  /** Rulebook matches not yet in Agentfile and not declined. */
  suggested: Rule[];
  writtenToDisk: boolean;
  /** Absolute path of the backup directory created on apply (if any updates occurred). */
  backupDir?: string;
  backedUpFiles?: string[];
  /** Per-registration outcome of post-apply settings.json sync. */
  hookRegistrations: HookSyncResult[];
}

export class UpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateError";
  }
}

const DEFAULT_SETTINGS = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};

function fragmentDirOf(libraryRoot: string, fragmentId: string): string {
  if (fragmentId === "base") return path.join(libraryRoot, "base");
  return path.join(libraryRoot, "fragments", fragmentId);
}

function timestampedBackupName(): string {
  // Filesystem-safe ISO 8601 — colons and dots are out.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function update(opts: UpdateOptions): UpdateResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);

  // 1. Require existing Agentfile.
  if (!findAgentfile(projectRoot)) {
    throw new UpdateError(
      `no Agentfile found in ${projectRoot}. Run 'anamnesis init' first.`,
    );
  }
  const agentfile = readAgentfile(projectRoot);

  // 2. Read existing manifest (empty if first update).
  const manifest = readManifest(projectRoot);

  // 3. Load library.
  const fragments = loadAllFragments(libraryRoot);
  const base = loadBaseFragment(libraryRoot);
  const rules = loadRulebook(libraryRoot);

  // 4. Resolve selection from Agentfile.fragments (declarative source of truth).
  const selected: FragmentDefinition[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];

  for (const entry of agentfile.fragments) {
    if (seen.has(entry.id)) continue;
    let frag: FragmentDefinition | undefined;
    if (entry.id === "base") {
      frag = base ?? undefined;
    } else {
      frag = fragments.get(entry.id);
    }
    if (!frag) {
      missing.push(entry.id);
      continue;
    }
    selected.push(frag);
    seen.add(frag.id);
  }

  // base is always-on — include even if Agentfile didn't list it (older
  // Agentfile from before base existed in the library).
  if (base && !seen.has(base.id)) {
    selected.unshift(base);
    seen.add(base.id);
  }

  if (missing.length > 0) {
    throw new UpdateError(
      `Agentfile references fragments not found in library: ${missing.join(", ")}.\n` +
        `Either restore the fragment in the library or remove it from Agentfile.`,
    );
  }

  // 5. Order + conflict check.
  const ordered = topologicalSort(selected);
  const conflicts = detectConflicts(ordered);
  if (conflicts.length > 0) {
    const pairs = conflicts.map(([a, b]) => `${a}↔${b}`).join(", ");
    throw new UpdateError(`conflicting fragments selected: ${pairs}`);
  }

  // 6. Detect new rulebook suggestions (not in Agentfile and not declined).
  const ctx = new ProjectContext(projectRoot);
  const matched = matchingRules(rules, ctx);
  const declinedIds = new Set(
    (agentfile.declined ?? []).map((d) => d.id),
  );
  const suggested = matched.filter(
    (r) => !seen.has(r.suggest) && !declinedIds.has(r.suggest),
  );

  // 7. Plan rendering.
  const registry = new RendererRegistry();
  registerClaudeCode(registry);
  const actions: RenderAction[] = [];
  for (const frag of ordered) {
    const fragmentDir = fragmentDirOf(libraryRoot, frag.id);
    const renderCtx: RenderContext = {
      fragment: frag,
      fragmentDir,
      projectRoot,
      settings: DEFAULT_SETTINGS,
      params: {},
    };
    actions.push(...registry.planFragment(renderCtx, "claude-code"));
  }

  // 8. Plan changes vs existing manifest.
  const { changes, nextManifest } = planChanges(actions, {
    projectRoot,
    manifest,
    allowExecAdapters: opts.allowExecAdapters,
  });

  // 9. Build a post-update Agentfile that reflects library-current versions.
  //    `pinned` entries are preserved untouched (rendering still uses library
  //    current — full pinning is a v0.2+ concern; documented as a known gap).
  const updatedAgentfile: Agentfile = {
    ...agentfile,
    fragments: ordered.map((f) => {
      const existing = agentfile.fragments.find((x) => x.id === f.id);
      if (existing?.pinned) return existing;
      return existing
        ? { ...existing, version: f.version }
        : { id: f.id, version: f.version };
    }),
  };

  // 10. Apply (or dry-run).
  let backupDir: string | undefined;
  let backedUpFiles: string[] | undefined;
  let hookRegistrations: HookSyncResult[] = [];
  if (opts.apply) {
    backupDir = path.join(
      projectRoot,
      ".anamnesis",
      "backups",
      timestampedBackupName(),
    );
    backedUpFiles = backupBeforeApply(changes, { projectRoot, backupDir });
    applyChanges(changes, { projectRoot });
    writeManifest(projectRoot, nextManifest);
    writeAgentfile(projectRoot, updatedAgentfile);
    hookRegistrations = syncWrittenHooks(changes, projectRoot);
  }

  return {
    agentfile: updatedAgentfile,
    changes,
    nextManifest,
    suggested,
    writtenToDisk: opts.apply,
    backupDir: opts.apply ? backupDir : undefined,
    backedUpFiles: opts.apply ? backedUpFiles : undefined,
    hookRegistrations,
  };
}

/**
 * Register every file-change with `settingsHook` metadata that reached
 * `create` or `update` status into `.claude/settings.json`. Idempotent.
 * Mirrors the helper in `init.ts` — duplicated rather than extracted to a
 * shared module to keep command files self-contained.
 */
function syncWrittenHooks(
  changes: PlannedChange[],
  projectRoot: string,
): HookSyncResult[] {
  const regs: HookRegistration[] = [];
  for (const c of changes) {
    if (c.target !== "file") continue;
    // create/update/noop are all "we own this file" — register. Skip
    // user-modified (caller-owned) and blocked (we didn't write it).
    if (
      c.status !== "create" &&
      c.status !== "update" &&
      c.status !== "noop"
    ) {
      continue;
    }
    if (!c.settingsHook) continue;
    regs.push({
      event: c.settingsHook.event,
      matcher: c.settingsHook.matcher,
      command: c.path,
    });
  }
  if (regs.length === 0) return [];
  return syncHookRegistrations(projectRoot, regs).results;
}
