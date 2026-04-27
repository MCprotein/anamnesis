// Capability rendering IR.
//
// Each capability, for a given tool adapter, produces a list of RenderActions —
// declarative instructions for writing regions or files. Execution (applying
// the actions to disk) is a separate concern implemented later.

import type { ToolName } from "./agentfile.js";
import type { Capability, FragmentDefinition } from "./fragments.js";

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
}

export interface FileAction {
  kind: "file";
  path: string; // project-relative path
  fragmentId: string;
  fragmentVersion: number;
  content: string;
  mode?: number; // chmod bits (e.g., 0o755 for executable hooks)
  /**
   * If set, the applier should also ensure this file is registered as a hook
   * in `.claude/settings.json`. The applier handles the JSON-structural merge
   * idempotently — duplicate registrations are detected and skipped.
   *
   * `event` examples: "SessionStart", "PostToolUse", "PreToolUse".
   * `matcher` examples (PostToolUse/PreToolUse only): "Edit", "Write", "Bash".
   * SessionStart and similar tool-agnostic events have no matcher.
   */
  settingsHook?: {
    event: string;
    matcher?: string;
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
  params: Record<string, unknown>;
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
