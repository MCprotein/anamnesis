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

  it("registers exec / skill / slash_command renderers (v0.3+ — fallback regions)", () => {
    const registry = new RendererRegistry();
    registerCodex(registry);
    expect(registry.get("codex", "executable_hook")).toBeDefined();
    expect(registry.get("codex", "skill")).toBeDefined();
    expect(registry.get("codex", "slash_command")).toBeDefined();
  });

  it("co-exists with claude-code adapter on the same registry", async () => {
    const registry = new RendererRegistry();
    const { registerClaudeCode } = await import(
      "../claude-code/index.js"
    );
    registerClaudeCode(registry);
    registerCodex(registry);

    // Both adapters expose all five capabilities (Codex via native SessionStart
    // for base continuity plus region fallbacks for other surfaces).
    for (const t of [
      "project_memory",
      "ontology",
      "executable_hook",
      "skill",
      "slash_command",
    ] as const) {
      expect(registry.get("claude-code", t)).toBeDefined();
      expect(registry.get("codex", t)).toBeDefined();
    }
  });

  it("exposes the adapter renderer set length 5 (full coverage)", () => {
    expect(codexRenderers).toHaveLength(5);
    for (const r of codexRenderers) {
      expect(r.adapter).toBe("codex");
    }
  });

  it("CODEX_UNSUPPORTED is empty (v0.3+ full coverage)", () => {
    expect(CODEX_UNSUPPORTED).toEqual([]);
  });
});
