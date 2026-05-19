// `anamnesis init` — first-time setup.
//
// Flow (docs/DESIGN.md §5.1):
//   1. Refuse if Agentfile already present (use `update`).
//   2. Load library (rulebook + fragments).
//   3. Evaluate rulebook vs project → suggested fragments.
//   4. Build Agentfile.
//   5. Plan fragment rendering via CC adapter.
//   6. Plan changes (exec-adapter gate, drift checks — irrelevant on init).
//   7. If --dry-run, just report. Otherwise apply + write manifest + Agentfile.

import * as path from "node:path";
import {
  findAgentfile,
  writeAgentfile,
  type Agentfile,
  type ToolName,
} from "../core/agentfile.js";
import {
  emptyManifest,
  writeManifest,
  type Manifest,
} from "../core/manifest.js";
import { loadRulebook, matchingRules } from "../core/rulebook.js";
import {
  expandFragmentDependencies,
  loadAllFragments,
  loadBaseFragment,
  detectConflicts,
  type FragmentDefinition,
} from "../core/fragments.js";
import { effectiveScopes } from "../core/scope.js";
import {
  detectMonorepo,
  type MonorepoDetection,
} from "../core/monorepo.js";
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
  bootstrap,
  OntologyBootstrapError,
  type BootstrapResult,
} from "./ontology.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import {
  codexHookSyncDetails,
  fragmentLifecycleEvidenceRecord,
  hookSyncDetails,
  installedFragmentEvents,
  lifecycleChangeDetails,
  summarizeLifecycleChanges,
  summarizeLifecycleSyncStatuses,
} from "../core/lifecycle_evidence.js";
import {
  bootstrapProjectContext,
  resolveKnownSurfaceConflicts,
  type ProjectContextBootstrapResult,
  type SurfaceConflictResolution,
} from "../core/adoption.js";
import {
  planProjectDocs,
  type ProjectDocsPlan,
} from "../core/project_docs.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitOptions {
  projectRoot: string;
  libraryRoot: string;
  dryRun: boolean;
  allowExecAdapters: boolean;
  projectName?: string;
  /** Adapter surfaces to install on first init. Defaults to Claude Code. */
  tools?: ToolName[];
  /**
   * If true, detect monorepo layout (package.json `workspaces`) and
   * generate a multi-scope Agentfile with one scope per workspace
   * sub-project (each gets its own `extends: '.'` + `fragments_add`
   * derived from rulebook matches in that scope's directory).
   *
   * If no monorepo is detected, falls back to single-scope init silently.
   */
  monorepo?: boolean;
  /**
   * Skip the post-install `ontology bootstrap` pass. By default, init
   * runs bootstrap after writing files so that `.anamnesis/ontology/
   * <id>.bootstrap.yaml` files are populated for any installed fragment
   * that has a registered introspector. Disable when bootstrap output
   * would be noisy or incorrect for a specific project.
   */
  noBootstrap?: boolean;
  /**
   * Skip the conservative project-level `system_graph.yaml` draft. By default,
   * init writes it when absent. If no safe local project signals exist, the
   * draft contains only safety invariants and open questions instead of
   * invented facts.
   */
  noContextBootstrap?: boolean;
  /**
   * Create missing user-facing project docs (`README.md` and
   * `docs/PROJECT-CONTEXT.md`) with conservative managed starter regions.
   * Existing user-authored docs are left untouched unless `enhanceDocs` is set.
   */
  scaffoldDocs?: boolean;
  /**
   * Add or refresh managed context-review regions in existing project docs.
   * This is intentionally opt-in because README/docs are usually user-owned.
   */
  enhanceDocs?: boolean;
  now?: () => Date;
}

export interface InitResult {
  agentfile: Agentfile;
  selectedFragments: FragmentDefinition[];
  changes: PlannedChange[];
  nextManifest: Manifest;
  writtenToDisk: boolean;
  /**
   * Per-registration outcome of post-apply settings.json sync.
   * Empty when dryRun or when no executable_hook capabilities reached
   * `create`/`update` status.
   */
  hookRegistrations: HookSyncResult[];
  /** Per-registration outcome of post-apply Codex native hook sync. */
  codexHookRegistrations: CodexHookSyncResult[];
  /**
   * Set when `opts.monorepo` was true and the project actually had
   * package.json workspaces. Includes the detected sub-scopes (with
   * matched rules per scope) and any "empty" workspace dirs that didn't
   * trigger any rulebook matches.
   */
  monorepoDetection?: MonorepoDetection;
  /**
   * Result of the post-install `ontology bootstrap` pass. Set when init
   * actually ran bootstrap (i.e. files were written and `noBootstrap`
   * was not set). On bootstrap failure, `bootstrapError` carries the
   * message and `bootstrapResult` is undefined; init itself does not
   * fail because of bootstrap errors.
   */
  bootstrapResult?: BootstrapResult;
  bootstrapError?: string;
  /** Runtime evidence JSONL path written on non-dry-run init. */
  evidencePath?: string;
  /** First-run project context draft outcome for `system_graph.yaml`. */
  contextBootstrap?: ProjectContextBootstrapResult;
  /** Optional user-facing docs scaffold/enhancement plan. */
  projectDocs?: ProjectDocsPlan;
  /** Existing project-specific agent surfaces preserved before writing ours. */
  surfaceConflicts: SurfaceConflictResolution[];
}

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitError";
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};

/**
 * Resolve the on-disk directory for a fragment in the library.
 *
 * The special `base` fragment lives at `<libraryRoot>/base/` (matching
 * docs/DESIGN.md §8.1). All other fragments live under
 * `<libraryRoot>/fragments/<id>/`.
 */
function fragmentDirOf(libraryRoot: string, fragmentId: string): string {
  if (fragmentId === "base") return path.join(libraryRoot, "base");
  return path.join(libraryRoot, "fragments", fragmentId);
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function init(opts: InitOptions): InitResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);

  // 1. Reject if already initialized.
  const existing = findAgentfile(projectRoot);
  if (existing) {
    throw new InitError(
      `Agentfile already present at ${existing}. Use \`anamnesis update\` to re-run.`,
    );
  }

  // 2. Load library.
  const rules = loadRulebook(libraryRoot);
  const fragments = loadAllFragments(libraryRoot);
  const base = loadBaseFragment(libraryRoot);
  const availableFragments = new Map(fragments);
  if (base) availableFragments.set(base.id, base);

  // 3. Evaluate rules against project.
  const ctx = new ProjectContext(projectRoot);
  const matched = matchingRules(rules, ctx);

  // 4. Resolve ROOT-scope fragments from matched rules + auto-include base.
  const rootSelected: FragmentDefinition[] = [];
  const rootSeen = new Set<string>();
  if (base) {
    rootSelected.push(base);
    rootSeen.add(base.id);
  }
  const missing: string[] = [];
  for (const rule of matched) {
    if (rootSeen.has(rule.suggest)) continue;
    const frag = fragments.get(rule.suggest);
    if (frag) {
      rootSelected.push(frag);
      rootSeen.add(frag.id);
    } else {
      missing.push(rule.suggest);
    }
  }
  if (missing.length > 0) {
    throw new InitError(
      `rulebook suggests fragments not found in library: ${missing.join(", ")}`,
    );
  }

  // 5. Expand dependencies, then order root + conflict check.
  const rootOrdered = expandFragmentDependencies(
    rootSelected,
    availableFragments,
  );
  const rootConflicts = detectConflicts(rootOrdered);
  if (rootConflicts.length > 0) {
    const pairs = rootConflicts.map(([a, b]) => `${a}↔${b}`).join(", ");
    throw new InitError(`conflicting fragments selected: ${pairs}`);
  }
  const rootInstalledIds = new Set(rootOrdered.map((fragment) => fragment.id));

  // 6. Optional monorepo detection — adds extra scopes with their own fragments.
  let monorepoDetection: MonorepoDetection | undefined;
  type SubScopeResolved = {
    scopePath: string;
    ordered: FragmentDefinition[];
    fragmentsAddEntries: Array<{ id: string; version: number }>;
  };
  const subScopes: SubScopeResolved[] = [];

  if (opts.monorepo) {
    monorepoDetection = detectMonorepo(projectRoot, rules);
    for (const candidate of monorepoDetection.scopes) {
      const subSelected: FragmentDefinition[] = [];
      const seenInSub = new Set<string>();
      for (const rule of candidate.matchedRules) {
        if (seenInSub.has(rule.suggest)) continue;
        // Skip if already inherited from root (avoid double-install).
        if (rootInstalledIds.has(rule.suggest)) continue;
        const frag = fragments.get(rule.suggest);
        if (frag) {
          subSelected.push(frag);
          seenInSub.add(frag.id);
        } else {
          missing.push(`${candidate.path}/${rule.suggest}`);
        }
      }
      const expanded = expandFragmentDependencies(
        [...rootOrdered, ...subSelected],
        availableFragments,
      );
      const subOrdered = expanded.filter(
        (fragment) => !rootInstalledIds.has(fragment.id),
      );
      const subConflicts = detectConflicts(subOrdered);
      if (subConflicts.length > 0) {
        const pairs = subConflicts.map(([a, b]) => `${a}↔${b}`).join(", ");
        throw new InitError(
          `scope '${candidate.path}': conflicting fragments: ${pairs}`,
        );
      }
      subScopes.push({
        scopePath: candidate.path,
        ordered: subOrdered,
        fragmentsAddEntries: subOrdered.map((f) => ({
          id: f.id,
          version: f.version,
        })),
      });
    }
    if (missing.length > 0) {
      throw new InitError(
        `monorepo scope rules suggest fragments not found in library: ${missing.join(", ")}`,
      );
    }
  }

  // 7. Build Agentfile.
  const projectName = opts.projectName ?? path.basename(projectRoot);
  const tools = opts.tools ?? ["claude-code"];
  const agentfile: Agentfile = {
    version: 1,
    project: subScopes.length > 0
      ? {
          name: projectName,
          scopes: [
            { path: "." },
            ...subScopes.map((s) => ({
              path: s.scopePath,
              extends: ".",
              overrides: { fragments_add: s.fragmentsAddEntries },
            })),
          ],
        }
      : { name: projectName },
    tools,
    fragments: rootOrdered.map((f) => ({ id: f.id, version: f.version })),
  };

  // 8. Plan rendering — per-scope loop (root + each sub-scope).
  const registry = new RendererRegistry();
  if (tools.includes("claude-code")) registerClaudeCode(registry);
  if (tools.includes("codex")) registerCodex(registry);
  if (tools.includes("cursor")) registerCursor(registry);

  const renderTargets: Array<{
    scopePath: string;
    ordered: FragmentDefinition[];
  }> = [
    { scopePath: ".", ordered: rootOrdered },
    ...subScopes.map((s) => ({
      scopePath: s.scopePath,
      // Sub-scope receives root fragments via inheritance (extends: '.')
      // PLUS its own additions. Render both so AGENTS.md gets all
      // applicable regions.
      ordered: [...rootOrdered, ...s.ordered],
    })),
  ];

  const actions: RenderAction[] = [];
  for (const { scopePath, ordered } of renderTargets) {
    for (const frag of ordered) {
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
    if (tools.includes("claude-code") && hasProjectMemory(ordered)) {
      actions.push(
        planClaudeMdEntrypoint({
          scopePath,
          settings: DEFAULT_SETTINGS,
        }),
      );
    }
  }

  // 9. Dedupe identical actions before planChanges.
  // Multi-scope rendering with inherited base produces duplicate exec-
  // adapter writes (every scope renders base's hooks → same .claude/hooks
  // path). Region/file dedup by target identity collapses these.
  const projectDocs = planProjectDocs({
    projectRoot,
    projectName,
    scaffoldDocs: opts.scaffoldDocs === true,
    enhanceDocs: opts.enhanceDocs === true,
  });

  const dedupedActions = dedupeActions([
    ...actions,
    ...(projectDocs?.actions ?? []),
  ]);
  const surfaceConflicts = resolveKnownSurfaceConflicts({
    projectRoot,
    manifest: emptyManifest(),
    actions: dedupedActions,
    dryRun: opts.dryRun,
  });

  // 10. Plan changes vs blank manifest (init always starts fresh).
  const { changes, nextManifest } = planChanges(dedupedActions, {
    projectRoot,
    manifest: emptyManifest(),
    allowExecAdapters: opts.allowExecAdapters,
  });

  let contextBootstrap: ProjectContextBootstrapResult | undefined;
  if (!opts.noContextBootstrap) {
    contextBootstrap = bootstrapProjectContext({
      projectRoot,
      dryRun: opts.dryRun,
    });
  }

  // 11. Apply (or dry-run).
  let hookRegistrations: HookSyncResult[] = [];
  let codexHookRegistrations: CodexHookSyncResult[] = [];
  if (!opts.dryRun) {
    applyChanges(changes, { projectRoot });
    writeManifest(projectRoot, nextManifest);
    writeAgentfile(projectRoot, agentfile);
    const hookSync = syncWrittenHooks(changes, projectRoot);
    hookRegistrations = hookSync.claude;
    codexHookRegistrations = hookSync.codex;
  }

  // 12. Post-install ontology bootstrap (Layer A). Failure does not
  // fail init — surface the message and let the user re-run explicitly.
  let bootstrapResult: BootstrapResult | undefined;
  let bootstrapError: string | undefined;
  if (!opts.dryRun && !opts.noBootstrap) {
    try {
      bootstrapResult = bootstrap({ projectRoot });
    } catch (e) {
      bootstrapError =
        e instanceof OntologyBootstrapError
          ? e.message
          : `unexpected: ${(e as Error).message}`;
    }
  }

  let evidencePath: string | undefined;
  if (!opts.dryRun) {
    const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
    const command = initEvidenceCommand({
      allowExecAdapters: opts.allowExecAdapters,
      monorepoRequested: opts.monorepo === true,
      noBootstrap: opts.noBootstrap === true,
      noContextBootstrap: opts.noContextBootstrap === true,
      scaffoldDocs: opts.scaffoldDocs === true,
      enhanceDocs: opts.enhanceDocs === true,
      projectNameOverride: opts.projectName,
      toolsOverride: opts.tools,
    });
    evidencePath = appendEvidenceRecord(
      projectRoot,
      initInstallEvidenceRecord({
        generatedAt,
        command,
        agentfile,
        selectedFragments: rootOrdered,
        changes,
        monorepoRequested: opts.monorepo === true,
        monorepoDetection,
        hookRegistrations,
        codexHookRegistrations,
        bootstrapResult,
        bootstrapError,
        allowExecAdapters: opts.allowExecAdapters,
        noBootstrap: opts.noBootstrap === true,
        noContextBootstrap: opts.noContextBootstrap === true,
        scaffoldDocs: opts.scaffoldDocs === true,
        enhanceDocs: opts.enhanceDocs === true,
        contextBootstrap,
        projectDocs,
        surfaceConflicts,
        projectNameOverride: opts.projectName,
        toolsOverride: opts.tools,
      }),
    );
    evidencePath = appendEvidenceRecord(
      projectRoot,
      fragmentLifecycleEvidenceRecord({
        generatedAt,
        command,
        projectName: agentfile.project.name,
        events: installedFragmentEvents(agentfile),
      }),
    );
  }

  return {
    agentfile,
    selectedFragments: rootOrdered,
    changes,
    nextManifest,
    writtenToDisk: !opts.dryRun,
    hookRegistrations,
    monorepoDetection,
    bootstrapResult,
    bootstrapError,
    codexHookRegistrations,
    evidencePath,
    contextBootstrap,
    projectDocs,
    surfaceConflicts,
  };
}

function initInstallEvidenceRecord(input: {
  generatedAt: string;
  command: string[];
  agentfile: Agentfile;
  selectedFragments: readonly FragmentDefinition[];
  changes: readonly PlannedChange[];
  monorepoRequested: boolean;
  monorepoDetection?: MonorepoDetection;
  hookRegistrations: readonly HookSyncResult[];
  codexHookRegistrations: readonly CodexHookSyncResult[];
  bootstrapResult?: BootstrapResult;
  bootstrapError?: string;
  allowExecAdapters: boolean;
  noBootstrap: boolean;
  noContextBootstrap: boolean;
  scaffoldDocs: boolean;
  enhanceDocs: boolean;
  contextBootstrap?: ProjectContextBootstrapResult;
  projectDocs?: ProjectDocsPlan;
  surfaceConflicts: readonly SurfaceConflictResolution[];
  projectNameOverride?: string;
  toolsOverride?: readonly ToolName[];
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "init-install",
    generated_at: input.generatedAt,
    command: input.command,
    project: { name: input.agentfile.project.name },
    summary: {
      schema_version: "anamnesis.init_install.v1",
      written_to_disk: true,
      changes: summarizeLifecycleChanges(input.changes),
      selected_fragment_count: input.selectedFragments.length,
      selected_fragments: input.selectedFragments.map((fragment) => fragment.id),
      tools: input.agentfile.tools,
      monorepo: {
        requested: input.monorepoRequested,
        detected: input.monorepoDetection?.isMonorepo ?? false,
        scopes: input.monorepoDetection?.scopes.length ?? 0,
        empty_scopes: input.monorepoDetection?.emptyScopes.length ?? 0,
      },
      bootstrap: bootstrapSummary(input.bootstrapResult, input.bootstrapError),
      hook_sync: {
        claude: summarizeLifecycleSyncStatuses(input.hookRegistrations),
        codex: summarizeLifecycleSyncStatuses(input.codexHookRegistrations),
      },
      flags: {
        allow_exec_adapters: input.allowExecAdapters,
        no_bootstrap: input.noBootstrap,
        no_context_bootstrap: input.noContextBootstrap,
        scaffold_docs: input.scaffoldDocs,
        enhance_docs: input.enhanceDocs,
      },
      context_bootstrap: input.contextBootstrap
        ? {
            path: input.contextBootstrap.path,
            outcome: input.contextBootstrap.outcome,
            signals: input.contextBootstrap.signals.length,
          }
        : { outcome: "disabled" },
      surface_conflicts: {
        total: input.surfaceConflicts.length,
        preserved: input.surfaceConflicts.filter(
          (conflict) => conflict.outcome === "preserved",
        ).length,
      },
      project_docs: input.projectDocs
        ? {
            mode: input.projectDocs.mode,
            targets: input.projectDocs.targets.length,
            planned: input.projectDocs.targets.filter(
              (target) => target.outcome !== "skipped-existing",
            ).length,
            skipped_existing: input.projectDocs.targets.filter(
              (target) => target.outcome === "skipped-existing",
            ).length,
          }
        : { mode: "disabled" },
    },
    details: {
      fragments: input.selectedFragments.map((fragment) => ({
        id: fragment.id,
        version: fragment.version,
      })),
      scopes: agentfileScopeDetails(input.agentfile),
      changes: lifecycleChangeDetails(input.changes),
      bootstrap: {
        ...(input.bootstrapError ? { error: input.bootstrapError } : {}),
        entries: input.bootstrapResult?.entries.map((entry) => ({
          scope_path: entry.scopePath,
          fragment_id: entry.fragmentId,
          outcome: entry.outcome,
          ...(entry.path ? { path: entry.path } : {}),
        })) ?? [],
      },
      hook_registrations: hookSyncDetails(input.hookRegistrations),
      codex_hook_registrations: codexHookSyncDetails(
        input.codexHookRegistrations,
      ),
      ...(input.contextBootstrap
        ? {
            context_bootstrap: {
              path: input.contextBootstrap.path,
              outcome: input.contextBootstrap.outcome,
              signals: input.contextBootstrap.signals,
            },
          }
        : {}),
      surface_conflicts: input.surfaceConflicts.map((conflict) => ({
        path: conflict.path,
        preserved_as: conflict.preservedAs,
        outcome: conflict.outcome,
        reason: conflict.reason,
      })),
      ...(input.projectDocs
        ? {
            project_docs: {
              mode: input.projectDocs.mode,
              targets: input.projectDocs.targets,
            },
          }
        : {}),
    },
  };
}

function initEvidenceCommand(input: {
  allowExecAdapters: boolean;
  monorepoRequested: boolean;
  noBootstrap: boolean;
  noContextBootstrap?: boolean;
  scaffoldDocs?: boolean;
  enhanceDocs?: boolean;
  projectNameOverride?: string;
  toolsOverride?: readonly ToolName[];
}): string[] {
  const command = ["anamnesis", "init"];
  if (input.allowExecAdapters) command.push("--allow-exec-adapters");
  if (input.monorepoRequested) command.push("--monorepo");
  if (input.noBootstrap) command.push("--no-bootstrap");
  if (input.noContextBootstrap) command.push("--no-context-bootstrap");
  if (input.scaffoldDocs) command.push("--scaffold-docs");
  if (input.enhanceDocs) command.push("--enhance-docs");
  if (input.projectNameOverride) {
    command.push("--project-name", input.projectNameOverride);
  }
  if (input.toolsOverride && input.toolsOverride.length > 0) {
    command.push("--tools", input.toolsOverride.join(","));
  }
  return command;
}

function bootstrapSummary(
  result: BootstrapResult | undefined,
  error: string | undefined,
): Record<string, unknown> {
  const summary = {
    skipped: result === undefined && error === undefined,
    written: 0,
    unchanged: 0,
    skipped_not_applicable: 0,
    skipped_no_introspector: 0,
    error: error ?? null,
  };
  for (const entry of result?.entries ?? []) {
    if (entry.outcome === "written") summary.written++;
    else if (entry.outcome === "unchanged") summary.unchanged++;
    else if (entry.outcome === "skipped-not-applicable") {
      summary.skipped_not_applicable++;
    } else if (entry.outcome === "skipped-no-introspector") {
      summary.skipped_no_introspector++;
    }
  }
  return summary;
}

function agentfileScopeDetails(
  agentfile: Agentfile,
): Array<Record<string, unknown>> {
  return (agentfile.project.scopes ?? [{ path: "." }]).map((scope) => ({
    path: scope.path,
    ...(scope.extends ? { extends: scope.extends } : {}),
    fragments_add: (scope.overrides?.fragments_add ?? []).map((fragment) => ({
      id: fragment.id,
      version: fragment.version,
    })),
  }));
}

/**
 * Dedupe RenderActions by target identity. Multi-scope rendering with
 * inherited fragments produces duplicate exec-adapter writes
 * (`.claude/hooks/...` is project-root regardless of scope), and
 * dedupe collapses these to a single action.
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

function hasProjectMemory(fragments: FragmentDefinition[]): boolean {
  return fragments.some((fragment) =>
    fragment.capabilities.some(
      (capability) => capability.type === "project_memory",
    ),
  );
}

/**
 * Register every file-change with `settingsHook` metadata that reached
 * `create` or `update` status into `.claude/settings.json`. Idempotent —
 * pre-existing entries are detected and skipped.
 */
function syncWrittenHooks(
  changes: PlannedChange[],
  projectRoot: string,
): { claude: HookSyncResult[]; codex: CodexHookSyncResult[] } {
  const regs: HookRegistration[] = [];
  const codexRegs: CodexHookRegistration[] = [];
  for (const c of changes) {
    if (c.target !== "file") continue;
    // Register hooks we own: freshly written (create/update) AND already-
    // installed-and-unchanged (noop). Noop inclusion is what allows older
    // installs (with hooks but no settings.json entry) to self-heal on the
    // next update. We never register `user-modified` (caller-owned) or
    // `blocked` (we didn't write it).
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

// ---------------------------------------------------------------------------
// Reporting (used by CLI wrapper)
// ---------------------------------------------------------------------------

export interface ChangeSummary {
  create: number;
  update: number;
  noop: number;
  blocked: number;
  userModified: number;
}

export function summarizeChanges(changes: PlannedChange[]): ChangeSummary {
  const s: ChangeSummary = {
    create: 0,
    update: 0,
    noop: 0,
    blocked: 0,
    userModified: 0,
  };
  for (const c of changes) {
    if (c.status === "create") s.create++;
    else if (c.status === "update") s.update++;
    else if (c.status === "noop") s.noop++;
    else if (c.status === "blocked") s.blocked++;
    else if (c.status === "user-modified") s.userModified++;
  }
  return s;
}
