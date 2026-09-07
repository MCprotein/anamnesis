import { describe, it, expect } from "vitest";
import { RendererRegistry } from "../../core/render.js";
import {
  registerClaudeCode,
  claudeCodeRenderers,
} from "./index.js";

describe("registerClaudeCode", () => {

  it("exposes the full renderer set", () => {
    expect(claudeCodeRenderers).toHaveLength(6);
    const types = claudeCodeRenderers.map((r) => r.type).sort();
    expect(types).toEqual(
      [
        "executable_hook",
        "ontology",
        "project_memory",
        "skill",
        "slash_command",
        "task_harness",
      ].sort(),
    );
  });

  it("all renderers target the claude-code adapter", () => {
    for (const r of claudeCodeRenderers) {
      expect(r.adapter).toBe("claude-code");
    }
  });

  it("throws on double registration (same registry)", () => {
    const registry = new RendererRegistry();
    registerClaudeCode(registry);
    expect(() => registerClaudeCode(registry)).toThrow(
      /duplicate renderer registration/,
    );
  });
});
