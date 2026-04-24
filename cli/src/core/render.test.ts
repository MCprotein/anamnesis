import { describe, it, expect } from "vitest";
import {
  RendererRegistry,
  RenderError,
  type CapabilityRenderer,
  type RenderAction,
  type RenderContext,
} from "./render.js";
import type { Capability, FragmentDefinition } from "./fragments.js";

function makeContext(fragment: FragmentDefinition): RenderContext {
  return {
    fragment,
    fragmentDir: "/tmp/fake",
    projectRoot: "/tmp/project",
    settings: {
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
    },
    params: {},
  };
}

function stubRenderer(
  type: Capability["type"],
  adapter: "claude-code" | "codex" | "cursor" = "claude-code",
  action: RenderAction = {
    kind: "file",
    path: "stub",
    fragmentId: "f",
    fragmentVersion: 1,
    content: "x",
  },
): CapabilityRenderer {
  return {
    type,
    adapter,
    plan: () => [action],
  };
}

describe("RendererRegistry.register", () => {
  it("registers a renderer and retrieves it", () => {
    const reg = new RendererRegistry();
    const r = stubRenderer("ontology");
    reg.register(r);
    expect(reg.get("claude-code", "ontology")).toBe(r);
  });

  it("rejects duplicate registration for same adapter+type", () => {
    const reg = new RendererRegistry();
    reg.register(stubRenderer("ontology"));
    expect(() => reg.register(stubRenderer("ontology"))).toThrow(
      /duplicate renderer registration/,
    );
  });

  it("allows same capability type on different adapters", () => {
    const reg = new RendererRegistry();
    reg.register(stubRenderer("ontology", "claude-code"));
    reg.register(stubRenderer("ontology", "codex"));
    expect(reg.get("claude-code", "ontology")).toBeDefined();
    expect(reg.get("codex", "ontology")).toBeDefined();
  });

  it("get() returns undefined for unknown pair", () => {
    const reg = new RendererRegistry();
    expect(reg.get("claude-code", "skill")).toBeUndefined();
  });
});

describe("RendererRegistry.planCapability", () => {
  it("dispatches to registered renderer", () => {
    const reg = new RendererRegistry();
    reg.register(stubRenderer("ontology"));
    const cap: Capability = { type: "ontology", source: "o.yaml" };
    const ctx = makeContext({
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [cap],
    });
    const actions = reg.planCapability(cap, ctx, "claude-code");
    expect(actions).toHaveLength(1);
  });

  it("throws RenderError when no renderer registered", () => {
    const reg = new RendererRegistry();
    const cap: Capability = { type: "ontology", source: "o.yaml" };
    const ctx = makeContext({
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [cap],
    });
    expect(() => reg.planCapability(cap, ctx, "claude-code")).toThrow(
      RenderError,
    );
  });
});

describe("RendererRegistry.planFragment", () => {
  it("concatenates actions across capabilities", () => {
    const reg = new RendererRegistry();
    reg.register(
      stubRenderer("ontology", "claude-code", {
        kind: "file",
        path: "a",
        fragmentId: "f",
        fragmentVersion: 1,
        content: "1",
      }),
    );
    reg.register(
      stubRenderer("skill", "claude-code", {
        kind: "file",
        path: "b",
        fragmentId: "f",
        fragmentVersion: 1,
        content: "2",
      }),
    );
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [
        { type: "ontology", source: "o.yaml" },
        { type: "skill", name: "x", source: "s" },
      ],
    };
    const actions = reg.planFragment(makeContext(fragment), "claude-code");
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => (a.kind === "file" ? a.path : ""))).toEqual([
      "a",
      "b",
    ]);
  });

  it("skips capabilities with no renderer for this adapter", () => {
    const reg = new RendererRegistry();
    reg.register(stubRenderer("ontology", "claude-code"));
    // skill has no renderer registered
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [
        { type: "ontology", source: "o.yaml" },
        { type: "skill", name: "x", source: "s" },
      ],
    };
    const actions = reg.planFragment(makeContext(fragment), "claude-code");
    expect(actions).toHaveLength(1);
  });

  it("respects capability-level adapters_supported restriction", () => {
    const reg = new RendererRegistry();
    reg.register(stubRenderer("executable_hook", "claude-code"));
    const fragment: FragmentDefinition = {
      id: "f",
      version: 1,
      requires: [],
      conflicts: [],
      owns: [],
      capabilities: [
        {
          type: "executable_hook",
          event: "PreToolUse",
          source: "h.sh",
          adapters_supported: ["codex"], // not claude-code
        },
      ],
    };
    const actions = reg.planFragment(makeContext(fragment), "claude-code");
    expect(actions).toHaveLength(0);
  });
});
