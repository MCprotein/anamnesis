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
  topologicalSort,
  detectConflicts,
  type Capability,
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
    // Topo + conflict per scope (different scopes may share fragment ids).
    const resolvedById = new Map(
      resolved.map((r) => [r.fragment.id, r] as const),
    );
    const orderedFragments = topologicalSort(
      resolved.map((r) => r.fragment),
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
  // 7. Plan changes vs existing manifest.
  const { changes, nextManifest } = planChanges(dedupedActions, {
    projectRoot,
    manifest,
    allowExecAdapters: opts.allowExecAdapters,
  });

  // 8. Build a post-update Agentfile that reflects library-current versions.
  //    Pinned entries stay at their pinned version unless --bump-pinned was
  //    provided, in which case they move to current while remaining pinned.
  const updatedAgentfile: Agentfile = {
    ...agentfile,
    fragments: bumpFragmentEntries(
      agentfileForResolution.fragments,
      currentFragmentVersions(base, fragments),
      opts.bumpPinned === true,
    ),
    project: bumpScopeFragmentEntries(
      agentfile.project,
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
    evidencePath = appendEvidenceRecord(
      projectRoot,
      updateApplyEvidenceRecord({
        generatedAt,
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
  };
}

function updateApplyEvidenceRecord(input: {
  generatedAt: string;
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
}): RuntimeEvidenceRecord {
  const changeSummary = summarizePlannedChanges(input.changes);
  const backedUpFiles = input.backedUpFiles ?? [];
  const prunedBackupDirs = input.prunedBackupDirs ?? [];
  const command = ["anamnesis", "update", "--apply"];
  if (input.allowExecAdapters) command.push("--allow-exec-adapters");
  if (input.bumpPinned) command.push("--bump-pinned");

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "update-apply",
    generated_at: input.generatedAt,
    command,
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
        claude: summarizeSyncStatuses(input.hookRegistrations),
        codex: summarizeSyncStatuses(input.codexHookRegistrations),
      },
      flags: {
        allow_exec_adapters: input.allowExecAdapters,
        bump_pinned: input.bumpPinned,
      },
    },
    details: {
      changes: input.changes.map(changeEvidenceDetail),
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
      hook_registrations: input.hookRegistrations.map((result) => ({
        status: result.status,
        event: result.registration.event,
        ...(result.registration.matcher
          ? { matcher: result.registration.matcher }
          : {}),
        command: result.registration.command,
      })),
      codex_hook_registrations: input.codexHookRegistrations.map((result) => ({
        status: result.status,
        event: result.registration.event,
        ...(result.registration.matcher
          ? { matcher: result.registration.matcher }
          : {}),
        command: result.registration.command,
      })),
    },
  };
}

function summarizePlannedChanges(
  changes: readonly PlannedChange[],
): {
  create: number;
  update: number;
  noop: number;
  blocked: number;
  user_modified: number;
} {
  const summary = {
    create: 0,
    update: 0,
    noop: 0,
    blocked: 0,
    user_modified: 0,
  };
  for (const change of changes) {
    if (change.status === "create") summary.create++;
    else if (change.status === "update") summary.update++;
    else if (change.status === "noop") summary.noop++;
    else if (change.status === "blocked") summary.blocked++;
    else if (change.status === "user-modified") summary.user_modified++;
  }
  return summary;
}

function summarizeSyncStatuses(
  results: ReadonlyArray<{ status: string }>,
): { total: number; create: number; noop: number } {
  return {
    total: results.length,
    create: results.filter((result) => result.status === "create").length,
    noop: results.filter((result) => result.status === "noop").length,
  };
}

function changeEvidenceDetail(change: PlannedChange): Record<string, unknown> {
  const target =
    change.target === "region"
      ? `${change.file}#${change.regionId}`
      : change.path;
  return {
    target_type: change.target,
    target,
    fragment_id: change.fragmentId,
    fragment_version: change.fragmentVersion,
    status: change.status,
    ...(change.reason ? { reason: change.reason } : {}),
  };
}

function projectRelativePath(projectRoot: string, filePath: string): string {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  return relative === "" || relative.startsWith("..") ? filePath : relative;
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
