// Capability rendering IR.
//
// Each capability, for a given tool adapter, produces a list of RenderActions —
// declarative instructions for writing regions or files. Execution (applying
// the actions to disk) is a separate concern implemented later.

import type { ToolName } from "./agentfile.js";
import {
  ParamTemplateError,
  renderParamTemplate,
  type ResolvedParams,
} from "./fragment_params.js";
import type {
  Capability,
  CapabilitySideEffect,
  FragmentDefinition,
} from "./fragments.js";

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export interface RegionAction {
  kind: "region";
  file: string; // project-relative path
  regionId: string;
  fragmentId: string;
  fragmentVersion: number;
  content: string; // inner content (anchors added by applier)
  sideEffects?: CapabilitySideEffect[];
}

export interface FileAction {
  kind: "file";
  path: string; // project-relative path
  fragmentId: string;
  fragmentVersion: number;
  content: string;
  mode?: number; // chmod bits (e.g., 0o755 for executable hooks)
  sideEffects?: CapabilitySideEffect[];
  /**
   * If set, the applier should also ensure this file is registered as a hook
   * in `.claude/settings.json`. The applier handles the JSON-structural merge
   * idempotently — duplicate registrations are detected and skipped.
   *
   * `event` examples: "SessionStart", "PostToolUse", "PreToolUse",
   * "PermissionRequest", "UserPromptSubmit", "Stop".
   * `matcher` examples (tool-scoped events): "Edit", "Write", "Bash",
   * "apply_patch", or MCP tool names. UserPromptSubmit and Stop do not
   * currently honor matchers in Codex.
   */
  settingsHook?: {
    event: string;
    matcher?: string;
    /** Matchers that earlier releases registered for this hook. */
    legacyMatchers?: string[];
  };
  /**
   * If set, the applier writes the file normally and the command layer then
   * ensures the file is registered in Codex native hook config:
   *   .codex/config.toml -> [features].hooks = true
   *   .codex/hooks.json  -> hooks.<event>[] command entry
   *
   * The Codex config files are user-owned and structurally merged rather than
   * manifest-tracked, mirroring `.claude/settings.json` for Claude Code.
   */
  codexHook?: {
    event: string;
    matcher?: string;
    command: string;
    timeout?: number;
    statusMessage?: string;
    additionalContextLimit?: number;
  };
}

export type RenderAction = RegionAction | FileAction;

// ---------------------------------------------------------------------------
// Render context
// ---------------------------------------------------------------------------

export interface AgentfileSettings {
  ontology_file: string;
  agents_md_path: string;
  claude_md_path: string;
}

export interface RenderContext {
  fragment: FragmentDefinition;
  fragmentDir: string; // absolute path to the fragment dir in the library
  projectRoot: string;
  /**
   * Scope-relative directory within the project. `"."` means the project
   * root (single-scope or root scope of a monorepo). For monorepo sub-scopes
   * like `apps/api`, the value is `"apps/api"`.
   *
   * Optional with default `"."` — single-scope projects (the v0.1 behavior)
   * never need to set it. Multi-scope `init`/`update` set it per scope.
   *
   * Renderers use this to scope per-scope artifacts (AGENTS.md regions,
   * ontology slices). Exec adapters (hooks/commands/skills) are project-
   * root only — Claude Code's `settings.json` is read only at root.
   */
  scopePath?: string;
  settings: AgentfileSettings;
  /**
   * Validated param values for this fragment (defaults applied). Callers
   * resolve them with `resolveFragmentParams`; renderers only substitute.
   */
  params: ResolvedParams;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

/**
 * Apply fragment param substitution to a text source. Fragments that declare
 * no params get the source back unchanged.
 */
export function renderFragmentText(
  ctx: RenderContext,
  source: string,
  sourceLabel: string,
): string {
  try {
    return renderParamTemplate({
      source,
      declarations: ctx.fragment.params,
      values: ctx.params,
      sourceLabel: `fragment '${ctx.fragment.id}' ${sourceLabel}`,
    });
  } catch (e) {
    if (e instanceof ParamTemplateError) throw new RenderError(e.message);
    throw e;
  }
}

/** Identity of a render target; actions with the same key write one place. */
export function renderActionKey(action: RenderAction): string {
  return action.kind === "region"
    ? `region|${action.file}|${action.regionId}`
    : `file|${action.path}`;
}

/**
 * Targets that two actions of a param-declaring fragment would write with
 * different content. Scope-independent targets (skills under `.claude/`,
 * `.codex/`) are planned once per scope, and dedupe keeps only the first, so
 * scope-specific params there would otherwise be dropped silently.
 */
export function findParamTargetConflicts(
  actions: readonly RenderAction[],
  paramFragmentIds: ReadonlySet<string>,
): Array<{ fragmentId: string; target: string }> {
  const first = new Map<string, RenderAction>();
  const conflicts = new Map<string, { fragmentId: string; target: string }>();
  for (const action of actions) {
    if (!paramFragmentIds.has(action.fragmentId)) continue;
    const key = renderActionKey(action);
    const prior = first.get(key);
    if (!prior) {
      first.set(key, action);
      continue;
    }
    if (prior.content !== action.content && !conflicts.has(key)) {
      conflicts.set(key, {
        fragmentId: action.fragmentId,
        target: action.kind === "region" ? `${action.file} [region:${action.regionId}]` : action.path,
      });
    }
  }
  return [...conflicts.values()];
}

// ---------------------------------------------------------------------------
// Renderer interface
// ---------------------------------------------------------------------------

export interface CapabilityRenderer {
  readonly type: Capability["type"];
  readonly adapter: ToolName;
  plan(capability: Capability, ctx: RenderContext): RenderAction[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function key(adapter: ToolName, type: Capability["type"]): string {
  return `${adapter}:${type}`;
}

export class RendererRegistry {
  private map = new Map<string, CapabilityRenderer>();

  register(renderer: CapabilityRenderer): this {
    const k = key(renderer.adapter, renderer.type);
    if (this.map.has(k)) {
      throw new RenderError(`duplicate renderer registration: ${k}`);
    }
    this.map.set(k, renderer);
    return this;
  }

  get(
    adapter: ToolName,
    type: Capability["type"],
  ): CapabilityRenderer | undefined {
    return this.map.get(key(adapter, type));
  }

  planCapability(
    capability: Capability,
    ctx: RenderContext,
    adapter: ToolName,
  ): RenderAction[] {
    const renderer = this.get(adapter, capability.type);
    if (!renderer) {
      throw new RenderError(
        `no renderer registered for '${capability.type}' on adapter '${adapter}'`,
      );
    }
    return renderer.plan(capability, ctx);
  }

  /**
   * Plan all capabilities of a fragment for one adapter.
   *
   * Capabilities with no matching renderer are silently skipped (they are
   * unsupported on this adapter — `limitations.md` reports them to users).
   * Likewise, capabilities that declare `adapters_supported` and exclude
   * the target adapter are skipped.
   */
  planFragment(ctx: RenderContext, adapter: ToolName): RenderAction[] {
    const actions: RenderAction[] = [];
    for (const cap of ctx.fragment.capabilities) {
      // Capability-level adapter gate (only executable_hook exposes this today).
      if (
        "adapters_supported" in cap &&
        cap.adapters_supported !== undefined &&
        !cap.adapters_supported.includes(adapter)
      ) {
        continue;
      }
      const renderer = this.get(adapter, cap.type);
      if (!renderer) continue;
      actions.push(...renderer.plan(cap, ctx));
    }
    return actions;
  }

  list(): CapabilityRenderer[] {
    return Array.from(this.map.values());
  }
}

/**
 * Default registry populated by adapter modules on import.
 * Tests should typically create their own registry for isolation.
 */
export const defaultRegistry = new RendererRegistry();
