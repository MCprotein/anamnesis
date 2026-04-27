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
} from "../core/agentfile.js";
import {
  emptyManifest,
  writeManifest,
  type Manifest,
} from "../core/manifest.js";
import { loadRulebook, matchingRules } from "../core/rulebook.js";
import {
  loadAllFragments,
  loadBaseFragment,
  topologicalSort,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitOptions {
  projectRoot: string;
  libraryRoot: string;
  dryRun: boolean;
  allowExecAdapters: boolean;
  projectName?: string;
  /**
   * If true, detect monorepo layout (package.json `workspaces`) and
   * generate a multi-scope Agentfile with one scope per workspace
   * sub-project (each gets its own `extends: '.'` + `fragments_add`
   * derived from rulebook matches in that scope's directory).
   *
   * If no monorepo is detected, falls back to single-scope init silently.
   */
  monorepo?: boolean;
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
  /**
   * Set when `opts.monorepo` was true and the project actually had
   * package.json workspaces. Includes the detected sub-scopes (with
   * matched rules per scope) and any "empty" workspace dirs that didn't
   * trigger any rulebook matches.
   */
  monorepoDetection?: MonorepoDetection;
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

  // 5. Order root + conflict check.
  const rootOrdered = topologicalSort(rootSelected);
  const rootConflicts = detectConflicts(rootOrdered);
  if (rootConflicts.length > 0) {
    const pairs = rootConflicts.map(([a, b]) => `${a}↔${b}`).join(", ");
    throw new InitError(`conflicting fragments selected: ${pairs}`);
  }

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
        if (rootSeen.has(rule.suggest)) continue;
        const frag = fragments.get(rule.suggest);
        if (frag) {
          subSelected.push(frag);
          seenInSub.add(frag.id);
        } else {
          missing.push(`${candidate.path}/${rule.suggest}`);
        }
      }
      const subOrdered = topologicalSort(subSelected);
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
    tools: ["claude-code"],
    fragments: rootOrdered.map((f) => ({ id: f.id, version: f.version })),
  };

  // 8. Plan rendering — per-scope loop (root + each sub-scope).
  const registry = new RendererRegistry();
  registerClaudeCode(registry);

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
      actions.push(...registry.planFragment(renderCtx, "claude-code"));
    }
  }

  // 9. Dedupe identical actions before planChanges.
  // Multi-scope rendering with inherited base produces duplicate exec-
  // adapter writes (every scope renders base's hooks → same .claude/hooks
  // path). Region/file dedup by target identity collapses these.
  const dedupedActions = dedupeActions(actions);

  // 10. Plan changes vs blank manifest (init always starts fresh).
  const { changes, nextManifest } = planChanges(dedupedActions, {
    projectRoot,
    manifest: emptyManifest(),
    allowExecAdapters: opts.allowExecAdapters,
  });

  // 11. Apply (or dry-run).
  let hookRegistrations: HookSyncResult[] = [];
  if (!opts.dryRun) {
    applyChanges(changes, { projectRoot });
    writeManifest(projectRoot, nextManifest);
    writeAgentfile(projectRoot, agentfile);
    hookRegistrations = syncWrittenHooks(changes, projectRoot);
  }

  return {
    agentfile,
    selectedFragments: rootOrdered,
    changes,
    nextManifest,
    writtenToDisk: !opts.dryRun,
    hookRegistrations,
    monorepoDetection,
  };
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

/**
 * Register every file-change with `settingsHook` metadata that reached
 * `create` or `update` status into `.claude/settings.json`. Idempotent —
 * pre-existing entries are detected and skipped.
 */
function syncWrittenHooks(
  changes: PlannedChange[],
  projectRoot: string,
): HookSyncResult[] {
  const regs: HookRegistration[] = [];
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
