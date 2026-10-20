import * as fs from "node:fs";
import * as path from "node:path";
import {
  fragmentAdapterEnabled,
  type Fragment,
  type ToolName,
} from "../core/agentfile.js";
import {
  archivedFragmentDirOf,
  fragmentDirOf,
  loadFragment,
  type Capability,
  type FragmentDefinition,
} from "../core/fragments.js";
import {
  resolveFragmentParams,
  type FragmentParamProblem,
} from "../core/fragment_params.js";
import {
  RendererRegistry,
  findParamTargetConflicts,
  type AgentfileSettings,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";
import { registerClaudeCode } from "../adapters/claude-code/index.js";
import { registerCodex } from "../adapters/codex/index.js";
import { registerCursor } from "../adapters/cursor/index.js";

export type InstalledRenderPlanProblemCode =
  | "fragment-library-missing"
  | "adapter-renderer-missing"
  | "render-plan-failed"
  | "fragment-param-scope-conflict";

export interface InstalledRenderPlanProblem {
  code: InstalledRenderPlanProblemCode;
  scopePath: string;
  fragmentId?: string;
  target?: string;
  message: string;
}

export interface InstalledRenderParamProblem extends FragmentParamProblem {
  scopePath: string;
}

export interface InstalledRenderActionScope {
  path: string;
  tools: ToolName[];
  fragments: Fragment[];
}

interface ResolvedFragment {
  entry: Fragment;
  fragment: FragmentDefinition;
  fragmentDir: string;
}

const DEFAULT_SETTINGS: AgentfileSettings = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};

export function collectInstalledRenderActions(opts: {
  projectRoot: string;
  libraryRoot: string;
  library: Map<string, FragmentDefinition>;
  scopes: InstalledRenderActionScope[];
  settings?: AgentfileSettings;
}): {
  actions: RenderAction[];
  problems: InstalledRenderPlanProblem[];
  /** Agentfile params problems; fragments with errors are not planned. */
  paramProblems: InstalledRenderParamProblem[];
  /** Fragment ids whose output depends on params (declared or supplied). */
  parameterizedFragmentIds: string[];
} {
  const registry = buildRendererRegistry();
  const actions: RenderAction[] = [];
  const problems: InstalledRenderPlanProblem[] = [];
  const paramProblems: InstalledRenderParamProblem[] = [];
  const seenParamProblems = new Set<string>();
  const parameterized = new Set<string>();
  const declaredParamFragments = new Set<string>();
  const settings = opts.settings ?? DEFAULT_SETTINGS;

  for (const scope of opts.scopes) {
    for (const installed of scope.fragments) {
      const resolved = resolveInstalledFragmentForPlan({
        entry: installed,
        libraryRoot: opts.libraryRoot,
        library: opts.library,
        scopePath: scope.path,
        problems,
      });
      if (!resolved) continue;

      const { entry, fragment, fragmentDir } = resolved;
      const params = resolveFragmentParams({
        fragmentId: fragment.id,
        declarations: fragment.params,
        values: entry.params,
      });
      for (const problem of params.problems) {
        // Child scopes inherit root entries; report each problem once.
        const key = `${problem.code}|${problem.fragmentId}|${problem.key}|${problem.message}`;
        if (seenParamProblems.has(key)) continue;
        seenParamProblems.add(key);
        paramProblems.push({ ...problem, scopePath: scope.path });
      }
      // Only fragments that declare params substitute them, so only their
      // output can drift because of params.
      if (fragment.params !== undefined) {
        parameterized.add(fragment.id);
        declaredParamFragments.add(fragment.id);
      }
      if (params.blocking) continue;
      const ctx: RenderContext = {
        fragment,
        fragmentDir,
        projectRoot: opts.projectRoot,
        scopePath: scope.path,
        settings,
        params: params.values,
      };

      for (const tool of scope.tools) {
        if (!fragmentAdapterEnabled(entry, tool)) continue;
        for (const cap of fragment.capabilities) {
          if (!capabilitySupportsTool(cap, tool)) continue;
          if (!registry.get(tool, cap.type)) {
            problems.push({
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
          problems.push({
            code: "render-plan-failed",
            scopePath: scope.path,
            fragmentId: fragment.id,
            message: `failed to plan ${tool} output for fragment '${fragment.id}': ${(e as Error).message}`,
          });
        }
      }
    }
  }

  for (const conflict of findParamTargetConflicts(actions, declaredParamFragments)) {
    problems.push({
      code: "fragment-param-scope-conflict",
      scopePath: ".",
      fragmentId: conflict.fragmentId,
      target: conflict.target,
      message: `${conflict.target} is shared by all scopes, but scopes render different params for fragment '${conflict.fragmentId}'`,
    });
  }

  return {
    actions: dedupeActions(actions),
    problems,
    paramProblems,
    parameterizedFragmentIds: [...parameterized].sort(),
  };
}

function resolveInstalledFragmentForPlan(opts: {
  entry: Fragment;
  libraryRoot: string;
  library: Map<string, FragmentDefinition>;
  problems: InstalledRenderPlanProblem[];
  scopePath: string;
}): ResolvedFragment | undefined {
  const currentDir = fragmentDirOf(opts.libraryRoot, opts.entry.id);
  const current = opts.library.get(opts.entry.id);

  if (opts.entry.pinned !== true) {
    return current
      ? { entry: opts.entry, fragment: current, fragmentDir: currentDir }
      : undefined;
  }

  if (current?.version === opts.entry.version) {
    return { entry: opts.entry, fragment: current, fragmentDir: currentDir };
  }

  const archivedDir = archivedFragmentDirOf(
    opts.libraryRoot,
    opts.entry.id,
    opts.entry.version,
  );
  const archivedPath = path.join(archivedDir, "fragment.yaml");
  if (!fs.existsSync(archivedPath)) {
    opts.problems.push({
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
      opts.problems.push({
        code: "fragment-library-missing",
        scopePath: opts.scopePath,
        fragmentId: opts.entry.id,
        target: archivedPath,
        message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' archive declares version ${fragment.version}`,
      });
      return undefined;
    }
    return { entry: opts.entry, fragment, fragmentDir: archivedDir };
  } catch (e) {
    opts.problems.push({
      code: "fragment-library-missing",
      scopePath: opts.scopePath,
      fragmentId: opts.entry.id,
      target: archivedPath,
      message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' archive could not be loaded: ${(e as Error).message}`,
    });
    return undefined;
  }
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

function buildRendererRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registerClaudeCode(registry);
  registerCodex(registry);
  registerCursor(registry);
  return registry;
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
