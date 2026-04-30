// `anamnesis doctor` — read-only installation integrity diagnostics.
//
// This command is stricter than `status`: it turns drift and broken wiring
// into actionable issues, but never edits the project.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  findAgentfile,
  readAgentfile,
  type ToolName,
} from "../core/agentfile.js";
import {
  emptyManifest,
  manifestPath,
  readManifest,
  type Manifest,
  ManifestParseError,
} from "../core/manifest.js";
import {
  loadAllFragments,
  loadBaseFragment,
  loadFragment,
  archivedFragmentDirOf,
  fragmentDirOf,
  type Capability,
  type FragmentDefinition,
} from "../core/fragments.js";
import { effectiveScopes } from "../core/scope.js";
import {
  RendererRegistry,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";
import { registerClaudeCode } from "../adapters/claude-code/index.js";
import { registerCodex } from "../adapters/codex/index.js";
import { registerCursor } from "../adapters/cursor/index.js";
import {
  hookRegistrationPresent,
  readSettings,
  type HookRegistration,
} from "../core/settings.js";
import { status } from "./status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorSeverity = "error" | "warning";

export type DoctorIssueCode =
  | "manifest-missing"
  | "manifest-invalid"
  | "fragment-library-missing"
  | "fragment-update-available"
  | "tracked-entry-missing"
  | "tracked-entry-user-modified"
  | "adapter-renderer-missing"
  | "render-plan-failed"
  | "settings-invalid"
  | "hook-registration-missing";

export interface DoctorIssue {
  severity: DoctorSeverity;
  code: DoctorIssueCode;
  message: string;
  scopePath?: string;
  fragmentId?: string;
  target?: string;
}

export interface DoctorResult {
  projectRoot: string;
  libraryRoot: string;
  ok: boolean;
  issues: DoctorIssue[];
  summary: {
    errors: number;
    warnings: number;
  };
}

export interface DoctorOptions {
  projectRoot: string;
  libraryRoot: string;
}

export class DoctorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoctorError";
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function doctor(opts: DoctorOptions): DoctorResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);

  if (!findAgentfile(projectRoot)) {
    throw new DoctorError(
      `no Agentfile found in ${projectRoot}. Run 'anamnesis init' first.`,
    );
  }

  const issues: DoctorIssue[] = [];
  const agentfile = readAgentfile(projectRoot);

  let manifest: Manifest = emptyManifest();
  let manifestReadable = true;
  const mfPath = manifestPath(projectRoot);
  if (!fs.existsSync(mfPath)) {
    manifestReadable = false;
    issues.push({
      severity: "error",
      code: "manifest-missing",
      message: `.anamnesis/manifest.json is missing`,
      target: ".anamnesis/manifest.json",
    });
  } else {
    try {
      manifest = readManifest(projectRoot);
    } catch (e) {
      manifestReadable = false;
      if (e instanceof ManifestParseError) {
        issues.push({
          severity: "error",
          code: "manifest-invalid",
          message: e.message,
          target: ".anamnesis/manifest.json",
        });
      } else {
        throw e;
      }
    }
  }

  if (manifestReadable) {
    const st = status({ projectRoot, libraryRoot });
    addStatusIssues(st.entries, st.fragments, issues);
  }

  const library = libraryFragmentMap(libraryRoot);
  const renderActions = addAdapterIssuesAndCollectActions({
    projectRoot,
    libraryRoot,
    library,
    issues,
    scopes: effectiveScopes(agentfile),
  });
  addSettingsIssues(projectRoot, manifest, renderActions, issues);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    projectRoot,
    libraryRoot,
    ok: errors === 0,
    issues,
    summary: { errors, warnings },
  };
}

// ---------------------------------------------------------------------------
// Status-derived issues
// ---------------------------------------------------------------------------

type StatusEntry = ReturnType<typeof status>["entries"][number];
type StatusFragment = ReturnType<typeof status>["fragments"][number];

interface ResolvedFragment {
  fragment: FragmentDefinition;
  fragmentDir: string;
}

function addStatusIssues(
  entries: StatusEntry[],
  fragments: StatusFragment[],
  issues: DoctorIssue[],
): void {
  for (const f of fragments) {
    if (f.status === "library-missing") {
      issues.push({
        severity: "error",
        code: "fragment-library-missing",
        fragmentId: f.id,
        message: `installed fragment '${f.id}' is missing from the library`,
      });
    } else if (f.status === "update-available") {
      issues.push({
        severity: "warning",
        code: "fragment-update-available",
        fragmentId: f.id,
        message: `fragment '${f.id}' is installed at ${f.installedVersion}; library has ${f.libraryVersion}`,
      });
    }
  }

  for (const e of entries) {
    const target =
      e.target === "region"
        ? `${e.file} [region:${e.regionId}]`
        : e.path;
    if (e.drift === "missing") {
      issues.push({
        severity: "error",
        code: "tracked-entry-missing",
        fragmentId: e.fragmentId,
        target,
        message: `tracked ${e.target} is missing: ${target}`,
      });
    } else if (e.drift === "user-modified") {
      issues.push({
        severity: "warning",
        code: "tracked-entry-user-modified",
        fragmentId: e.fragmentId,
        target,
        message: `tracked ${e.target} differs from last applied content: ${target}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Adapter / settings diagnostics
// ---------------------------------------------------------------------------

function addAdapterIssuesAndCollectActions(opts: {
  projectRoot: string;
  libraryRoot: string;
  library: Map<string, FragmentDefinition>;
  issues: DoctorIssue[];
  scopes: Array<{
    path: string;
    tools: ToolName[];
    fragments: Array<{ id: string; version: number; pinned?: boolean }>;
  }>;
}): RenderAction[] {
  const registry = buildRendererRegistry();
  const actions: RenderAction[] = [];

  for (const scope of opts.scopes) {
    for (const installed of scope.fragments) {
      const resolved = resolveInstalledFragmentForDoctor({
        entry: installed,
        libraryRoot: opts.libraryRoot,
        library: opts.library,
        issues: opts.issues,
        scopePath: scope.path,
      });
      if (!resolved) continue;
      const { fragment, fragmentDir } = resolved;
      const ctx: RenderContext = {
        fragment,
        fragmentDir,
        projectRoot: opts.projectRoot,
        scopePath: scope.path,
        settings: DEFAULT_SETTINGS,
        params: {},
      };

      for (const tool of scope.tools) {
        for (const cap of fragment.capabilities) {
          if (!capabilitySupportsTool(cap, tool)) continue;
          if (!registry.get(tool, cap.type)) {
            opts.issues.push({
              severity: "error",
              code: "adapter-renderer-missing",
              scopePath: scope.path,
              fragmentId: fragment.id,
              message: `no renderer for ${tool}:${cap.type} required by fragment '${fragment.id}'`,
            });
          }
        }

        try {
          actions.push(...registry.planFragment(ctx, tool));
        } catch (e) {
          opts.issues.push({
            severity: "error",
            code: "render-plan-failed",
            scopePath: scope.path,
            fragmentId: fragment.id,
            message: `failed to plan ${tool} output for fragment '${fragment.id}': ${(e as Error).message}`,
          });
        }
      }
    }
  }

  return dedupeActions(actions);
}

function resolveInstalledFragmentForDoctor(opts: {
  entry: { id: string; version: number; pinned?: boolean };
  libraryRoot: string;
  library: Map<string, FragmentDefinition>;
  issues: DoctorIssue[];
  scopePath: string;
}): ResolvedFragment | undefined {
  const currentDir = fragmentDirOf(opts.libraryRoot, opts.entry.id);
  const current = opts.library.get(opts.entry.id);

  if (opts.entry.pinned !== true) {
    return current ? { fragment: current, fragmentDir: currentDir } : undefined;
  }

  if (current?.version === opts.entry.version) {
    return { fragment: current, fragmentDir: currentDir };
  }

  const archivedDir = archivedFragmentDirOf(
    opts.libraryRoot,
    opts.entry.id,
    opts.entry.version,
  );
  const archivedPath = path.join(archivedDir, "fragment.yaml");
  if (!fs.existsSync(archivedPath)) {
    opts.issues.push({
      severity: "error",
      code: "fragment-library-missing",
      scopePath: opts.scopePath,
      fragmentId: opts.entry.id,
      target: archivedPath,
      message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' is missing from the version archive`,
    });
    return undefined;
  }

  try {
    const fragment = loadFragment(archivedDir, { expectedId: opts.entry.id });
    if (fragment.version !== opts.entry.version) {
      opts.issues.push({
        severity: "error",
        code: "fragment-library-missing",
        scopePath: opts.scopePath,
        fragmentId: opts.entry.id,
        target: archivedPath,
        message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' archive declares version ${fragment.version}`,
      });
      return undefined;
    }
    return { fragment, fragmentDir: archivedDir };
  } catch (e) {
    opts.issues.push({
      severity: "error",
      code: "fragment-library-missing",
      scopePath: opts.scopePath,
      fragmentId: opts.entry.id,
      target: archivedPath,
      message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' archive could not be loaded: ${(e as Error).message}`,
    });
    return undefined;
  }
}

function addSettingsIssues(
  projectRoot: string,
  manifest: Manifest,
  actions: RenderAction[],
  issues: DoctorIssue[],
): void {
  const trackedFiles = new Set(manifest.files.map((f) => f.path));
  const expectedHooks: HookRegistration[] = [];

  for (const action of actions) {
    if (action.kind !== "file" || !action.settingsHook) continue;
    const installed =
      trackedFiles.has(action.path) ||
      fs.existsSync(path.join(projectRoot, action.path));
    if (!installed) continue;
    expectedHooks.push({
      event: action.settingsHook.event,
      matcher: action.settingsHook.matcher,
      command: action.path,
    });
  }

  if (expectedHooks.length === 0) return;

  let settings: Record<string, unknown>;
  try {
    settings = readSettings(projectRoot);
  } catch (e) {
    issues.push({
      severity: "error",
      code: "settings-invalid",
      target: ".claude/settings.json",
      message: `.claude/settings.json could not be parsed: ${(e as Error).message}`,
    });
    return;
  }

  for (const reg of expectedHooks) {
    if (hookRegistrationPresent(settings, reg)) continue;
    const matcher = reg.matcher ? `:${reg.matcher}` : "";
    issues.push({
      severity: "error",
      code: "hook-registration-missing",
      target: ".claude/settings.json",
      message: `.claude/settings.json is missing ${reg.event}${matcher} registration for ${reg.command}`,
    });
  }
}

function capabilitySupportsTool(cap: Capability, tool: ToolName): boolean {
  if (
    "adapters_supported" in cap &&
    cap.adapters_supported !== undefined &&
    !cap.adapters_supported.includes(tool)
  ) {
    return false;
  }
  return true;
}

function buildRendererRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registerClaudeCode(registry);
  registerCodex(registry);
  registerCursor(registry);
  return registry;
}

function libraryFragmentMap(
  libraryRoot: string,
): Map<string, FragmentDefinition> {
  const fragments = loadAllFragments(libraryRoot);
  const base = loadBaseFragment(libraryRoot);
  if (base) fragments.set(base.id, base);
  return fragments;
}

function dedupeActions(actions: RenderAction[]): RenderAction[] {
  const seen = new Set<string>();
  const out: RenderAction[] = [];
  for (const action of actions) {
    const key =
      action.kind === "region"
        ? `region|${action.file}|${action.regionId}`
        : `file|${action.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

const DEFAULT_SETTINGS = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};
