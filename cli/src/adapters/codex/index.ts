// Codex adapter — registration entrypoint.
//
// v0.2 minimum scope: project_memory + ontology only. These are tool-agnostic
// outputs (AGENTS.md region, ontology slice files) — Codex reads them
// natively. Other capabilities (executable_hook, skill, slash_command) have
// no native Codex equivalent in v0.2; deferred to v0.3 where AGENTS.md
// instructions + git pre-commit hooks will provide best-effort fallbacks.
//
// When Codex is added to `tools` alongside `claude-code`, both adapters emit
// the same project_memory / ontology actions. Init/update dedupes by
// (target, path, regionId) before planChanges so the duplication produces
// no extra writes.

import type { RendererRegistry } from "../../core/render.js";
import { projectMemoryRenderer } from "./project_memory.js";
import { ontologyRenderer } from "./ontology.js";

export const codexRenderers = [
  projectMemoryRenderer,
  ontologyRenderer,
] as const;

export function registerCodex(registry: RendererRegistry): void {
  for (const renderer of codexRenderers) {
    registry.register(renderer);
  }
}

export { projectMemoryRenderer, ontologyRenderer };

/**
 * Capabilities NOT supported by the Codex adapter in v0.2.
 * Surfaced by `init` / `update` reporters when these capabilities are
 * present in selected fragments and `codex` is in `tools`, so users
 * understand which features are silently best-effort.
 */
export const CODEX_UNSUPPORTED = [
  "executable_hook",
  "skill",
  "slash_command",
] as const;
