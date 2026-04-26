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

  // 4. Resolve suggested ids → library fragments.
  // Base fragment (if present) is always included first regardless of rules.
  const selected: FragmentDefinition[] = [];
  const seen = new Set<string>();
  if (base) {
    selected.push(base);
    seen.add(base.id);
  }
  const missing: string[] = [];
  for (const rule of matched) {
    if (seen.has(rule.suggest)) continue;
    const frag = fragments.get(rule.suggest);
    if (frag) {
      selected.push(frag);
      seen.add(frag.id);
    } else {
      missing.push(rule.suggest);
    }
  }
  if (missing.length > 0) {
    throw new InitError(
      `rulebook suggests fragments not found in library: ${missing.join(", ")}`,
    );
  }

  // 5. Order by dependency; detect conflicts.
  const ordered = topologicalSort(selected);
  const conflicts = detectConflicts(ordered);
  if (conflicts.length > 0) {
    const pairs = conflicts.map(([a, b]) => `${a}↔${b}`).join(", ");
    throw new InitError(`conflicting fragments selected: ${pairs}`);
  }

  // 6. Build Agentfile.
  const projectName = opts.projectName ?? path.basename(projectRoot);
  const agentfile: Agentfile = {
    version: 1,
    project: { name: projectName },
    tools: ["claude-code"],
    fragments: ordered.map((f) => ({ id: f.id, version: f.version })),
  };

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

  // 8. Plan changes vs blank manifest (init always starts fresh).
  const { changes, nextManifest } = planChanges(actions, {
    projectRoot,
    manifest: emptyManifest(),
    allowExecAdapters: opts.allowExecAdapters,
  });

  // 9. Apply (or dry-run).
  let hookRegistrations: HookSyncResult[] = [];
  if (!opts.dryRun) {
    applyChanges(changes, { projectRoot });
    writeManifest(projectRoot, nextManifest);
    writeAgentfile(projectRoot, agentfile);
    hookRegistrations = syncWrittenHooks(changes, projectRoot);
  }

  return {
    agentfile,
    selectedFragments: ordered,
    changes,
    nextManifest,
    writtenToDisk: !opts.dryRun,
    hookRegistrations,
  };
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
