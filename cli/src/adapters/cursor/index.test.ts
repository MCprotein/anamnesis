import { describe, it, expect } from "vitest";
import { RendererRegistry } from "../../core/render.js";
import { registerCursor, cursorRenderers } from "./index.js";

describe("registerCursor", () => {
  it("registers all five capability renderers", () => {
    const registry = new RendererRegistry();
    registerCursor(registry);
    for (const t of [
      "project_memory",
      "ontology",
      "executable_hook",
      "skill",
      "slash_command",
    ] as const) {
      expect(registry.get("cursor", t)).toBeDefined();
    }
  });

  it("co-exists with claude-code + codex on the same registry", async () => {
    const registry = new RendererRegistry();
    const { registerClaudeCode } = await import("../claude-code/index.js");
    const { registerCodex } = await import("../codex/index.js");
    registerClaudeCode(registry);
    registerCodex(registry);
    registerCursor(registry);
    for (const adapter of ["claude-code", "codex", "cursor"] as const) {
      for (const t of [
        "project_memory",
        "ontology",
        "executable_hook",
        "skill",
        "slash_command",
      ] as const) {
        expect(registry.get(adapter, t)).toBeDefined();
      }
    }
  });

  it("exposes 5 renderers all with adapter cursor", () => {
    expect(cursorRenderers).toHaveLength(5);
    for (const r of cursorRenderers) {
      expect(r.adapter).toBe("cursor");
    }
  });
});
