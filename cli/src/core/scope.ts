// Scope resolution for monorepo Agentfiles.
//
// Each scope is a sub-project within the repository. Scopes have:
//   * a `path` (project-relative directory, e.g. "." or "apps/api")
//   * optional `extends` — inherit tools/fragments from another scope
//   * optional `overrides.tools` — replace inherited tools
//   * optional `overrides.fragments_add` — append fragments to inherited list
//   * optional `overrides.fragments_remove` — drop fragments by id
//
// `effectiveScopes(agentfile)` returns the resolved per-scope config in
// topological order (ancestors before descendants). Single-scope or
// no-scope Agentfiles map to a single root scope at path `.`.

import type {
  Agentfile,
  Fragment,
  ToolName,
} from "./agentfile.js";

export interface EffectiveScope {
  path: string;
  tools: ToolName[];
  fragments: Fragment[];
}

export class ScopeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeResolutionError";
  }
}

// ---------------------------------------------------------------------------
// Topological resolution of `extends`
// ---------------------------------------------------------------------------

interface RawScope {
  path: string;
  extends?: string;
  overrides?: {
    tools?: ToolName[];
    fragments_add?: Fragment[];
    fragments_remove?: string[];
  };
}

/**
 * Resolve a single Agentfile into per-scope effective configurations.
 *
 * If `agentfile.project.scopes` is absent or empty, returns a single root
 * scope using top-level tools/fragments. This preserves v0.1 behavior.
 *
 * Multi-scope: each scope inherits from its parent via `extends`. The
 * top-level `tools` and `fragments` arrays serve as the implicit base for
 * the root scope (path `.`). Other scopes must declare `extends` if they
 * want to inherit; otherwise they start from empty config plus their own
 * overrides.
 */
export function effectiveScopes(agentfile: Agentfile): EffectiveScope[] {
  const declared = (agentfile.project.scopes ?? []) as RawScope[];

  // Default behavior (v0.1 back-compat): no scopes → single root.
  if (declared.length === 0) {
    return [
      {
        path: ".",
        tools: [...agentfile.tools],
        fragments: [...agentfile.fragments],
      },
    ];
  }

  // Build a path → raw map for extends lookup.
  const rawByPath = new Map<string, RawScope>();
  for (const s of declared) rawByPath.set(s.path, s);

  // Topological sort: parents before children. Detect cycles.
  const order: RawScope[] = [];
  const state = new Map<string, "gray" | "black">();

  const visit = (s: RawScope, stack: string[]): void => {
    const st = state.get(s.path);
    if (st === "black") return;
    if (st === "gray") {
      throw new ScopeResolutionError(
        `scope 'extends' cycle: ${[...stack, s.path].join(" -> ")}`,
      );
    }
    state.set(s.path, "gray");
    if (s.extends !== undefined) {
      const parent = rawByPath.get(s.extends);
      if (!parent) {
        throw new ScopeResolutionError(
          `scope '${s.path}' extends unknown scope '${s.extends}'`,
        );
      }
      visit(parent, [...stack, s.path]);
    }
    state.set(s.path, "black");
    order.push(s);
  };

  for (const s of declared) visit(s, []);

  // Resolve effective config in order.
  const resolved = new Map<string, EffectiveScope>();
  for (const raw of order) {
    let baseTools: ToolName[];
    let baseFragments: Fragment[];

    if (raw.path === "." && !raw.extends) {
      // Root scope inherits implicit base from top-level Agentfile fields.
      baseTools = [...agentfile.tools];
      baseFragments = [...agentfile.fragments];
    } else if (raw.extends !== undefined) {
      const parent = resolved.get(raw.extends);
      if (!parent) {
        throw new ScopeResolutionError(
          `internal: parent '${raw.extends}' not yet resolved when resolving '${raw.path}'`,
        );
      }
      baseTools = [...parent.tools];
      baseFragments = [...parent.fragments];
    } else {
      // Non-root, non-extending scope — starts empty.
      baseTools = [];
      baseFragments = [];
    }

    const ov = raw.overrides;
    const tools = ov?.tools ? [...ov.tools] : baseTools;

    let fragments = baseFragments;
    if (ov?.fragments_remove && ov.fragments_remove.length > 0) {
      const drop = new Set(ov.fragments_remove);
      fragments = fragments.filter((f) => !drop.has(f.id));
    }
    if (ov?.fragments_add && ov.fragments_add.length > 0) {
      // De-dup by id: an added entry replaces an inherited one with same id.
      const addById = new Map(ov.fragments_add.map((f) => [f.id, f]));
      fragments = fragments.filter((f) => !addById.has(f.id));
      fragments.push(...ov.fragments_add);
    }

    resolved.set(raw.path, {
      path: raw.path,
      tools,
      fragments,
    });
  }

  // Return in declared order (deterministic for users), not topo order.
  return declared.map((s) => resolved.get(s.path)!);
}

/**
 * Returns true if the agentfile uses multi-scope (more than one scope or
 * a single non-root scope). Used by commands to decide between the v0.1
 * single-render path and the v0.2 multi-scope render loop.
 */
export function isMultiScope(agentfile: Agentfile): boolean {
  const scopes = agentfile.project.scopes;
  if (!scopes || scopes.length === 0) return false;
  if (scopes.length === 1 && scopes[0]?.path === ".") return false;
  return true;
}
