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
  type ToolName,
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
import { effectiveScopes } from "../core/scope.js";
import { ProjectContext } from "../core/triggers.js";
import {
  RendererRegistry,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";
import { registerClaudeCode } from "../adapters/claude-code/index.js";
import { registerCodex } from "../adapters/codex/index.js";
import { registerCursor } from "../adapters/cursor/index.js";
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

  // 4. Resolve scopes. Auto-inject base into top-level fragments BEFORE
  // computing effective scopes, so sub-scopes that `extends: .` inherit it.
  const agentfileForResolution: Agentfile =
    base && !agentfile.fragments.some((f) => f.id === base.id)
      ? {
          ...agentfile,
          fragments: [
            { id: base.id, version: base.version },
            ...agentfile.fragments,
          ],
        }
      : agentfile;

  const scopes = effectiveScopes(agentfileForResolution);
  const allInstalledIds = new Set<string>();
  const missing: string[] = [];

  // Per-scope rendering plan.
  const perScope: Array<{
    scopePath: string;
    tools: ToolName[];
    ordered: FragmentDefinition[];
    rootOrdered: boolean;
  }> = [];

  for (const scope of scopes) {
    const resolved: FragmentDefinition[] = [];
    const seenInScope = new Set<string>();

    for (const entry of scope.fragments) {
      if (seenInScope.has(entry.id)) continue;
      let frag: FragmentDefinition | undefined;
      if (entry.id === "base") {
        frag = base ?? undefined;
      } else {
        frag = fragments.get(entry.id);
      }
      if (!frag) {
        missing.push(`${scope.path}/${entry.id}`);
        continue;
      }
      resolved.push(frag);
      seenInScope.add(frag.id);
      allInstalledIds.add(frag.id);
    }

    perScope.push({
      scopePath: scope.path,
      tools: scope.tools,
      ordered: [],
      rootOrdered: scope.path === ".",
    });
    // Topo + conflict per scope (different scopes may share fragment ids).
    const ordered = topologicalSort(resolved);
    const conflicts = detectConflicts(ordered);
    if (conflicts.length > 0) {
      const pairs = conflicts.map(([a, b]) => `${a}↔${b}`).join(", ");
      throw new UpdateError(
        `scope '${scope.path}': conflicting fragments: ${pairs}`,
      );
    }
    perScope[perScope.length - 1]!.ordered = ordered;
  }

  if (missing.length > 0) {
    throw new UpdateError(
      `Agentfile references fragments not found in library: ${missing.join(", ")}.\n` +
        `Either restore the fragment in the library or remove it from Agentfile.`,
    );
  }

  // 5. Detect new rulebook suggestions (not installed in any scope and not declined).
  const ctx = new ProjectContext(projectRoot);
  const matched = matchingRules(rules, ctx);
  const declinedIds = new Set(
    (agentfile.declined ?? []).map((d) => d.id),
  );
  const suggested = matched.filter(
    (r) => !allInstalledIds.has(r.suggest) && !declinedIds.has(r.suggest),
  );

  // 6. Determine the "ordered" list used for Agentfile version-bump (only
  // the root scope's fragments are bumped; sub-scope overrides preserved).
  const rootOrdered =
    perScope.find((s) => s.rootOrdered)?.ordered ?? [];
  const ordered = rootOrdered;

  // 7. Plan rendering across all scopes.
  // Register every adapter that any scope's `tools` declares. Adapters
  // not in any scope's tools are not registered (their rendering paths
  // don't run).
  const allTools = new Set<ToolName>();
  for (const s of perScope) for (const t of s.tools) allTools.add(t);

  const registry = new RendererRegistry();
  if (allTools.has("claude-code")) registerClaudeCode(registry);
  if (allTools.has("codex")) registerCodex(registry);
  if (allTools.has("cursor")) registerCursor(registry);

  const actions: RenderAction[] = [];
  for (const { scopePath, ordered: scopeOrdered, tools } of perScope) {
    for (const frag of scopeOrdered) {
      const fragmentDir = fragmentDirOf(libraryRoot, frag.id);
      const renderCtx: RenderContext = {
        fragment: frag,
        fragmentDir,
        projectRoot,
        scopePath,
        settings: DEFAULT_SETTINGS,
        params: {},
      };
      for (const tool of tools) {
        actions.push(...registry.planFragment(renderCtx, tool));
      }
    }
  }

  // Dedupe identical actions (e.g., when both `claude-code` and `codex`
  // emit the same project_memory region action). Key by target identity.
  const dedupedActions = dedupeActions(actions);
  // 8. Plan changes vs existing manifest.
  const { changes, nextManifest } = planChanges(dedupedActions, {
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
 * Dedupe a list of RenderActions by target identity.
 *
 * Two adapters (e.g., `claude-code` and `codex`) may emit the same
 * tool-agnostic action (a region in AGENTS.md, an ontology slice file).
 * Identical actions are equivalent; we keep the first emission and drop
 * subsequent duplicates so that planChanges/applyChanges don't traverse
 * the same target twice.
 *
 * Identity:
 *   * region action: `region|<file>|<regionId>`
 *   * file action:   `file|<path>`
 */
function dedupeActions(actions: RenderAction[]): RenderAction[] {
  const seen = new Set<string>();
  const out: RenderAction[] = [];
  for (const a of actions) {
    const key =
      a.kind === "region"
        ? `region|${a.file}|${a.regionId}`
        : `file|${a.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
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
