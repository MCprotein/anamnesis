import { describe, it, expect } from "vitest";
import { RendererRegistry } from "../../core/render.js";
import {
  registerCodex,
  codexRenderers,
  CODEX_UNSUPPORTED,
} from "./index.js";

describe("registerCodex", () => {
  it("registers project_memory and ontology renderers", () => {
    const registry = new RendererRegistry();
    registerCodex(registry);
    expect(registry.get("codex", "project_memory")).toBeDefined();
    expect(registry.get("codex", "ontology")).toBeDefined();
  });

  it("does NOT register exec / skill / slash_command renderers (v0.2 limitation)", () => {
    const registry = new RendererRegistry();
    registerCodex(registry);
    expect(registry.get("codex", "executable_hook")).toBeUndefined();
    expect(registry.get("codex", "skill")).toBeUndefined();
    expect(registry.get("codex", "slash_command")).toBeUndefined();
  });

  it("co-exists with claude-code adapter on the same registry", async () => {
    const registry = new RendererRegistry();
    const { registerClaudeCode } = await import(
      "../claude-code/index.js"
    );
    registerClaudeCode(registry);
    registerCodex(registry);

    // CC has all five
    for (const t of [
      "project_memory",
      "ontology",
      "executable_hook",
      "skill",
      "slash_command",
    ] as const) {
      expect(registry.get("claude-code", t)).toBeDefined();
    }
    // Codex has only project_memory + ontology
    expect(registry.get("codex", "project_memory")).toBeDefined();
    expect(registry.get("codex", "ontology")).toBeDefined();
    expect(registry.get("codex", "executable_hook")).toBeUndefined();
  });

  it("exposes the adapter renderer set length 2", () => {
    expect(codexRenderers).toHaveLength(2);
    for (const r of codexRenderers) {
      expect(r.adapter).toBe("codex");
    }
  });

  it("CODEX_UNSUPPORTED lists the v0.2 gaps", () => {
    expect(CODEX_UNSUPPORTED).toContain("executable_hook");
    expect(CODEX_UNSUPPORTED).toContain("skill");
    expect(CODEX_UNSUPPORTED).toContain("slash_command");
  });
});
