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

import * as fs from "node:fs";
import * as path from "node:path";
import {
  readAgentfile,
  writeAgentfile,
  findAgentfile,
  fragmentAdapterEnabled,
  type Agentfile,
  type Fragment,
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
  loadFragment,
  archivedFragmentDirOf,
  fragmentDirOf,
  requirementLabel,
  topologicalSort,
  detectConflicts,
  type Capability,
  type FragmentDefinition,
  type FragmentRequirement,
} from "../core/fragments.js";
import { effectiveScopes } from "../core/scope.js";
import { ProjectContext } from "../core/triggers.js";
import {
  RendererRegistry,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";
import { registerClaudeCode } from "../adapters/claude-code/index.js";
import { planClaudeMdEntrypoint } from "../adapters/claude-code/claude_md.js";
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
import {
  syncCodexNativeHookRegistrations,
  type CodexHookRegistration,
  type CodexHookSyncResult,
} from "../core/codex_native.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import {
  codexHookSyncDetails,
  fragmentLifecycleEvidenceRecord,
  hookSyncDetails,
  lifecycleChangeDetails,
  projectRelativePath,
  summarizeLifecycleChanges,
  summarizeLifecycleSyncStatuses,
  updateFragmentEvents,
} from "../core/lifecycle_evidence.js";
import {
  resolveKnownSurfaceConflicts,
  type SurfaceConflictResolution,
} from "../core/adoption.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  projectRoot: string;
  libraryRoot: string;
  apply: boolean;
  allowExecAdapters: boolean;
  /** Explicitly move pinned entries to the library-current version. */
  bumpPinned?: boolean;
  now?: () => Date;
}

export interface UpdateResult {
  /** Agentfile after version bump rules are applied (only persisted on apply). */
  agentfile: Agentfile;
  changes: PlannedChange[];
  nextManifest: Manifest;
  /** Rulebook matches not yet in Agentfile and not declined. */
  suggested: Rule[];
  writtenToDisk: boolean;
  /** Absolute path of the backup directory created on apply (if any updates occurred). */
  backupDir?: string;
  backedUpFiles?: string[];
  /** Relative backup directories pruned after apply according to backup_retention. */
  prunedBackupDirs?: string[];
  /** Per-registration outcome of post-apply settings.json sync. */
  hookRegistrations: HookSyncResult[];
  /** Per-registration outcome of post-apply Codex native hook sync. */
  codexHookRegistrations: CodexHookSyncResult[];
  /** Runtime evidence JSONL path written on apply. Dry-runs never set this. */
  evidencePath?: string;
  /** Existing project-specific agent surfaces preserved before writing ours. */
  surfaceConflicts: SurfaceConflictResolution[];
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

interface ResolvedFragment {
  entry: Fragment;
  fragment: FragmentDefinition;
  fragmentDir: string;
}

interface DependencyExpansionResult {
  resolved: ResolvedFragment[];
  autoAdded: Fragment[];
}

function timestampedBackupName(): string {
  // Filesystem-safe ISO 8601 — colons and dots are out.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveInstalledFragment(opts: {
  entry: Fragment;
  base: FragmentDefinition | null;
  fragments: Map<string, FragmentDefinition>;
  libraryRoot: string;
  bumpPinned: boolean;
}): ResolvedFragment | undefined {
  const currentDir = fragmentDirOf(opts.libraryRoot, opts.entry.id);

  if (opts.entry.pinned === true && !opts.bumpPinned) {
    if (opts.entry.id === "base" && opts.base?.version === opts.entry.version) {
      return { entry: opts.entry, fragment: opts.base, fragmentDir: currentDir };
    }
    const current = opts.fragments.get(opts.entry.id);
    if (current?.version === opts.entry.version) {
      return { entry: opts.entry, fragment: current, fragmentDir: currentDir };
    }

    const archivedDir = archivedFragmentDirOf(
      opts.libraryRoot,
      opts.entry.id,
      opts.entry.version,
    );
    if (!pathExists(path.join(archivedDir, "fragment.yaml"))) {
      throw new UpdateError(
        `pinned fragment '${opts.entry.id}@${opts.entry.version}' not found in library archive. ` +
          `Expected ${archivedDir}/fragment.yaml`,
      );
    }
    const archived = loadFragment(archivedDir, { expectedId: opts.entry.id });
    if (archived.version !== opts.entry.version) {
      throw new UpdateError(
        `pinned fragment archive '${opts.entry.id}@${opts.entry.version}' declares version ${archived.version}`,
      );
    }
    return { entry: opts.entry, fragment: archived, fragmentDir: archivedDir };
  }

  if (opts.entry.id === "base") {
    return opts.base
      ? { entry: opts.entry, fragment: opts.base, fragmentDir: currentDir }
      : undefined;
  }
  const fragment = opts.fragments.get(opts.entry.id);
  return fragment
    ? { entry: opts.entry, fragment, fragmentDir: currentDir }
    : undefined;
}

function latestLibraryFragment(opts: {
  id: string;
  base: FragmentDefinition | null;
  fragments: Map<string, FragmentDefinition>;
  libraryRoot: string;
}): ResolvedFragment | undefined {
  const entry = opts.id === "base" ? opts.base : opts.fragments.get(opts.id);
  if (!entry) return undefined;
  return {
    entry: { id: entry.id, version: entry.version },
    fragment: entry,
    fragmentDir: fragmentDirOf(opts.libraryRoot, entry.id),
  };
}

function assertResolvedRequirement(opts: {
  scopePath: string;
  parent: ResolvedFragment;
  req: FragmentRequirement;
  dep: ResolvedFragment;
}): void {
  const min = opts.req.min_version;
  if (min === undefined || opts.dep.fragment.version >= min) return;
  const pinned = opts.dep.entry.pinned === true ? "pinned " : "";
  throw new UpdateError(
    `scope '${opts.scopePath}': fragment '${opts.parent.fragment.id}' requires ` +
      `${requirementLabel(opts.req)}, but ${pinned}installed version is ` +
      `${opts.dep.fragment.version}`,
  );
}

function expandResolvedDependencies(opts: {
  scopePath: string;
  resolved: ResolvedFragment[];
  base: FragmentDefinition | null;
  fragments: Map<string, FragmentDefinition>;
  libraryRoot: string;
}): DependencyExpansionResult {
  const byId = new Map(
    opts.resolved.map((resolved) => [resolved.fragment.id, resolved] as const),
  );
  const initialIds = new Set(byId.keys());
  const autoAdded: Fragment[] = [];
  const state = new Map<string, "gray" | "black">();

  function visit(current: ResolvedFragment, stack: string[]): void {
    const stateKey = current.fragment.id;
    const currentState = state.get(stateKey);
    if (currentState === "black") return;
    if (currentState === "gray") {
      throw new UpdateError(
        `scope '${opts.scopePath}': fragment dependency cycle: ` +
          `${[...stack, current.fragment.id].join(" -> ")}`,
      );
    }

    state.set(stateKey, "gray");
    for (const req of current.fragment.requires) {
      let dep = byId.get(req.id);
      if (!dep) {
        dep = latestLibraryFragment({
          id: req.id,
          base: opts.base,
          fragments: opts.fragments,
          libraryRoot: opts.libraryRoot,
        });
        if (!dep) {
          throw new UpdateError(
            `scope '${opts.scopePath}': fragment '${current.fragment.id}' ` +
              `requires unknown fragment '${req.id}'`,
          );
        }
        byId.set(dep.fragment.id, dep);
        if (!initialIds.has(dep.fragment.id)) {
          autoAdded.push(dep.entry);
        }
      }

      assertResolvedRequirement({
        scopePath: opts.scopePath,
        parent: current,
        req,
        dep,
      });
      visit(dep, [...stack, current.fragment.id]);
    }
    state.set(stateKey, "black");
  }

  for (const fragment of opts.resolved) visit(fragment, []);
  return { resolved: [...byId.values()], autoAdded };
}

function pathExists(fp: string): boolean {
  try {
    return fs.existsSync(fp);
  } catch {
    return false;
  }
}

function currentFragmentVersions(
  base: FragmentDefinition | null,
  fragments: Map<string, FragmentDefinition>,
): Map<string, number> {
  const versions = new Map<string, number>();
  if (base) versions.set(base.id, base.version);
  for (const fragment of fragments.values()) {
    versions.set(fragment.id, fragment.version);
  }
  return versions;
}

function bumpFragmentEntries<T extends { id: string; version: number; pinned?: boolean }>(
  entries: T[],
  versions: Map<string, number>,
  bumpPinned: boolean,
): T[] {
  return entries.map((entry) => {
    const current = versions.get(entry.id);
    if (current === undefined) return entry;
    if (entry.pinned === true && !bumpPinned) return entry;
    return { ...entry, version: current };
  });
}

function appendMissingFragmentEntries<T extends { id: string }>(
  entries: T[],
  additions: T[],
): T[] {
  const seen = new Set(entries.map((entry) => entry.id));
  const next = [...entries];
  for (const addition of additions) {
    if (seen.has(addition.id)) continue;
    next.push(addition);
    seen.add(addition.id);
  }
  return next;
}

function withAutoDependencyEntries(
  agentfile: Agentfile,
  autoByScope: Map<string, Fragment[]>,
): Agentfile {
  const rootAdditions = autoByScope.get(".") ?? [];
  const scopes = agentfile.project.scopes?.map((scope) => {
    const additions = autoByScope.get(scope.path) ?? [];
    if (additions.length === 0 || scope.path === ".") return scope;
    const overrides = scope.overrides ?? {};
    return {
      ...scope,
      overrides: {
        ...overrides,
        fragments_add: appendMissingFragmentEntries(
          overrides.fragments_add ?? [],
          additions,
        ),
      },
    };
  });

  return {
    ...agentfile,
    fragments: appendMissingFragmentEntries(agentfile.fragments, rootAdditions),
    project: scopes ? { ...agentfile.project, scopes } : agentfile.project,
  };
}

function bumpScopeFragmentEntries(
  project: Agentfile["project"],
  versions: Map<string, number>,
  bumpPinned: boolean,
): Agentfile["project"] {
  if (!project.scopes) return project;
  return {
    ...project,
    scopes: project.scopes.map((scope) => {
      const add = scope.overrides?.fragments_add;
      if (!add) return scope;
      return {
        ...scope,
        overrides: {
          ...scope.overrides,
          fragments_add: bumpFragmentEntries(add, versions, bumpPinned),
        },
      };
    }),
  };
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
    ordered: ResolvedFragment[];
  }> = [];
  const autoDependencyEntriesByScope = new Map<string, Fragment[]>();

  for (const scope of scopes) {
    const resolved: ResolvedFragment[] = [];
    const seenInScope = new Set<string>();

    for (const entry of scope.fragments) {
      if (seenInScope.has(entry.id)) continue;
      const frag = resolveInstalledFragment({
        entry,
        base,
        fragments,
        libraryRoot,
        bumpPinned: opts.bumpPinned === true,
      });
      if (!frag) {
        missing.push(`${scope.path}/${entry.id}`);
        continue;
      }
      resolved.push(frag);
      seenInScope.add(frag.fragment.id);
      allInstalledIds.add(frag.fragment.id);
    }

    perScope.push({
      scopePath: scope.path,
      tools: scope.tools,
      ordered: [],
    });
    const expanded = expandResolvedDependencies({
      scopePath: scope.path,
      resolved,
      base,
      fragments,
      libraryRoot,
    });
    if (expanded.autoAdded.length > 0) {
      autoDependencyEntriesByScope.set(scope.path, expanded.autoAdded);
      for (const entry of expanded.autoAdded) {
        allInstalledIds.add(entry.id);
      }
    }
    // Topo + conflict per scope (different scopes may share fragment ids).
    const resolvedById = new Map(
      expanded.resolved.map((r) => [r.fragment.id, r] as const),
    );
    const orderedFragments = topologicalSort(
      expanded.resolved.map((r) => r.fragment),
    );
    const ordered = orderedFragments.map(
      (fragment) => resolvedById.get(fragment.id)!,
    );
    const conflicts = detectConflicts(orderedFragments);
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

  // 6. Plan rendering across all scopes.
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
    for (const { entry, fragment, fragmentDir } of scopeOrdered) {
      const renderCtx: RenderContext = {
        fragment,
        fragmentDir,
        projectRoot,
        scopePath,
        settings: DEFAULT_SETTINGS,
        params: {},
      };
      for (const tool of tools) {
        if (!fragmentAdapterEnabled(entry, tool)) continue;
        actions.push(...registry.planFragment(renderCtx, tool));
      }
    }
    if (
      tools.includes("claude-code") &&
      hasProjectMemory(scopeOrdered, "claude-code")
    ) {
      actions.push(
        planClaudeMdEntrypoint({
          scopePath,
          settings: DEFAULT_SETTINGS,
        }),
      );
    }
  }

  // Dedupe identical actions (e.g., when both `claude-code` and `codex`
  // emit the same project_memory region action). Key by target identity.
  const dedupedActions = dedupeActions(actions);
  const surfaceConflicts = resolveKnownSurfaceConflicts({
    projectRoot,
    manifest,
    actions: dedupedActions,
    dryRun: !opts.apply,
  });
  // 7. Plan changes vs existing manifest.
  const { changes, nextManifest } = planChanges(dedupedActions, {
    projectRoot,
    manifest,
    allowExecAdapters: opts.allowExecAdapters,
  });

  // 8. Build a post-update Agentfile that reflects library-current versions.
  //    Pinned entries stay at their pinned version unless --bump-pinned was
  //    provided, in which case they move to current while remaining pinned.
  const expandedAgentfileForResolution = withAutoDependencyEntries(
    agentfileForResolution,
    autoDependencyEntriesByScope,
  );
  const updatedAgentfile: Agentfile = {
    ...expandedAgentfileForResolution,
    fragments: bumpFragmentEntries(
      expandedAgentfileForResolution.fragments,
      currentFragmentVersions(base, fragments),
      opts.bumpPinned === true,
    ),
    project: bumpScopeFragmentEntries(
      expandedAgentfileForResolution.project,
      currentFragmentVersions(base, fragments),
      opts.bumpPinned === true,
    ),
  };

  // 9. Apply (or dry-run).
  let backupDir: string | undefined;
  let backedUpFiles: string[] | undefined;
  let prunedBackupDirs: string[] | undefined;
  let hookRegistrations: HookSyncResult[] = [];
  let codexHookRegistrations: CodexHookSyncResult[] = [];
  let evidencePath: string | undefined;
  if (opts.apply) {
    backupDir = path.join(
      projectRoot,
      ".anamnesis",
      "backups",
      timestampedBackupName(),
    );
    backedUpFiles = backupBeforeApply(changes, { projectRoot, backupDir });
    prunedBackupDirs = pruneBackups({
      projectRoot,
      retention: agentfile.settings?.backup_retention ?? 10,
      enabled: backedUpFiles.length > 0,
    });
    applyChanges(changes, { projectRoot });
    writeManifest(projectRoot, nextManifest);
    writeAgentfile(projectRoot, updatedAgentfile);
    const hookSync = syncWrittenHooks(changes, projectRoot);
    hookRegistrations = hookSync.claude;
    codexHookRegistrations = hookSync.codex;
    const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
    const command = updateEvidenceCommand({
      allowExecAdapters: opts.allowExecAdapters,
      bumpPinned: opts.bumpPinned === true,
    });
    evidencePath = appendEvidenceRecord(
      projectRoot,
      updateApplyEvidenceRecord({
        generatedAt,
        command,
        projectRoot,
        projectName: updatedAgentfile.project.name,
        changes,
        suggested,
        backupDir,
        backedUpFiles,
        prunedBackupDirs,
        hookRegistrations,
        codexHookRegistrations,
        allowExecAdapters: opts.allowExecAdapters,
        bumpPinned: opts.bumpPinned === true,
        surfaceConflicts,
      }),
    );
    evidencePath = appendEvidenceRecord(
      projectRoot,
      fragmentLifecycleEvidenceRecord({
        generatedAt,
        command,
        projectName: updatedAgentfile.project.name,
        events: updateFragmentEvents({
          before: agentfile,
          after: updatedAgentfile,
          libraryVersions: currentFragmentVersions(base, fragments),
          autoDependenciesByScope: autoDependencyEntriesByScope,
          bumpPinned: opts.bumpPinned === true,
        }),
      }),
    );
  }

  return {
    agentfile: updatedAgentfile,
    changes,
    nextManifest,
    suggested,
    writtenToDisk: opts.apply,
    backupDir: opts.apply ? backupDir : undefined,
    backedUpFiles: opts.apply ? backedUpFiles : undefined,
    prunedBackupDirs: opts.apply ? prunedBackupDirs : undefined,
    hookRegistrations,
    codexHookRegistrations,
    evidencePath,
    surfaceConflicts,
  };
}

function updateApplyEvidenceRecord(input: {
  generatedAt: string;
  command: string[];
  projectRoot: string;
  projectName: string;
  changes: readonly PlannedChange[];
  suggested: readonly Rule[];
  backupDir?: string;
  backedUpFiles?: readonly string[];
  prunedBackupDirs?: readonly string[];
  hookRegistrations: readonly HookSyncResult[];
  codexHookRegistrations: readonly CodexHookSyncResult[];
  allowExecAdapters: boolean;
  bumpPinned: boolean;
  surfaceConflicts: readonly SurfaceConflictResolution[];
}): RuntimeEvidenceRecord {
  const changeSummary = summarizeLifecycleChanges(input.changes);
  const backedUpFiles = input.backedUpFiles ?? [];
  const prunedBackupDirs = input.prunedBackupDirs ?? [];

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "update-apply",
    generated_at: input.generatedAt,
    command: input.command,
    project: { name: input.projectName },
    summary: {
      schema_version: "anamnesis.update_apply.v1",
      written_to_disk: true,
      changes: changeSummary,
      suggested_count: input.suggested.length,
      backup: {
        created: backedUpFiles.length > 0,
        files: backedUpFiles.length,
        pruned: prunedBackupDirs.length,
      },
      hook_sync: {
        claude: summarizeLifecycleSyncStatuses(input.hookRegistrations),
        codex: summarizeLifecycleSyncStatuses(input.codexHookRegistrations),
      },
      flags: {
        allow_exec_adapters: input.allowExecAdapters,
        bump_pinned: input.bumpPinned,
      },
      surface_conflicts: {
        total: input.surfaceConflicts.length,
        preserved: input.surfaceConflicts.filter(
          (conflict) => conflict.outcome === "preserved",
        ).length,
      },
    },
    details: {
      changes: lifecycleChangeDetails(input.changes),
      suggested: input.suggested.map((rule) => ({
        id: rule.id,
        suggest: rule.suggest,
      })),
      backup: {
        ...(input.backupDir && backedUpFiles.length > 0
          ? { dir: projectRelativePath(input.projectRoot, input.backupDir) }
          : {}),
        files: backedUpFiles,
        pruned_dirs: prunedBackupDirs,
      },
      hook_registrations: hookSyncDetails(input.hookRegistrations),
      codex_hook_registrations: codexHookSyncDetails(
        input.codexHookRegistrations,
      ),
      surface_conflicts: input.surfaceConflicts.map((conflict) => ({
        path: conflict.path,
        preserved_as: conflict.preservedAs,
        outcome: conflict.outcome,
        reason: conflict.reason,
      })),
    },
  };
}

function updateEvidenceCommand(input: {
  allowExecAdapters: boolean;
  bumpPinned: boolean;
}): string[] {
  const command = ["anamnesis", "update", "--apply"];
  if (input.allowExecAdapters) command.push("--allow-exec-adapters");
  if (input.bumpPinned) command.push("--bump-pinned");
  return command;
}

function pruneBackups(opts: {
  projectRoot: string;
  retention: number;
  enabled: boolean;
}): string[] {
  if (!opts.enabled || opts.retention === 0) return [];
  const backupsRoot = path.join(opts.projectRoot, ".anamnesis", "backups");
  if (!fs.existsSync(backupsRoot)) return [];

  const dirs = listBackupDirs(backupsRoot);
  const stale = dirs.slice(opts.retention);
  for (const dir of stale) {
    fs.rmSync(path.join(backupsRoot, dir.name), {
      recursive: true,
      force: true,
    });
  }
  return stale.map((dir) =>
    path.posix.join(".anamnesis/backups", dir.name),
  );
}

function listBackupDirs(
  backupsRoot: string,
): Array<{ name: string; mtimeMs: number }> {
  return fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      mtimeMs: fs.statSync(path.join(backupsRoot, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
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

function hasProjectMemory(
  fragments: ResolvedFragment[],
  tool: ToolName,
): boolean {
  return fragments.some(({ entry, fragment }) =>
    fragmentAdapterEnabled(entry, tool) &&
    fragment.capabilities.some(
      (capability) =>
        capability.type === "project_memory" &&
        capabilitySupportsTool(capability, tool),
    ),
  );
}

function capabilitySupportsTool(capability: Capability, tool: ToolName): boolean {
  if (
    "adapters_supported" in capability &&
    capability.adapters_supported !== undefined &&
    !capability.adapters_supported.includes(tool)
  ) {
    return false;
  }
  return true;
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
): { claude: HookSyncResult[]; codex: CodexHookSyncResult[] } {
  const regs: HookRegistration[] = [];
  const codexRegs: CodexHookRegistration[] = [];
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
    if (c.settingsHook) {
      regs.push({
        event: c.settingsHook.event,
        matcher: c.settingsHook.matcher,
        command: c.path,
      });
    }
    if (c.codexHook) {
      codexRegs.push(c.codexHook);
    }
  }
  return {
    claude: regs.length === 0
      ? []
      : syncHookRegistrations(projectRoot, regs).results,
    codex: codexRegs.length === 0
      ? []
      : syncCodexNativeHookRegistrations(projectRoot, codexRegs).results,
  };
}
