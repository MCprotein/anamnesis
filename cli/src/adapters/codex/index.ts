// Codex adapter — registration entrypoint.
//
// As of v0.3, all 5 capabilities have a Codex rendering:
//   - project_memory / ontology: same output as CC (Codex reads AGENTS.md
//     and ontology slice files natively)
//   - executable_hook: native SessionStart wrapper for base continuity hooks,
//     AGENTS.md region fallback for all hooks, optional Git pre-commit bridge
//   - skill / slash_command: AGENTS.md region fallback
//     that documents the intent so the agent can honor it manually
//
// When `codex` shares `tools` with `claude-code`, both adapters render
// in parallel. Init/update dedupe identical actions (project_memory,
// ontology) by target identity; the divergent fallback regions
// (`codex-hook-*`, `codex-skill-*`, `codex-cmd-*`) coexist with the
// CC-native files.

import type { RendererRegistry } from "../../core/render.js";
import { projectMemoryRenderer } from "./project_memory.js";
import { ontologyRenderer } from "./ontology.js";
import { executableHookRenderer } from "./executable_hook.js";
import { skillRenderer } from "./skill.js";
import { slashCommandRenderer } from "./slash_command.js";

export const codexRenderers = [
  projectMemoryRenderer,
  ontologyRenderer,
  executableHookRenderer,
  skillRenderer,
  slashCommandRenderer,
] as const;

export function registerCodex(registry: RendererRegistry): void {
  for (const renderer of codexRenderers) {
    registry.register(renderer);
  }
}

export {
  projectMemoryRenderer,
  ontologyRenderer,
  executableHookRenderer,
  skillRenderer,
  slashCommandRenderer,
};

/**
 * Capabilities not yet covered on Codex. Empty as of v0.3 #2 — all 5
 * capability types now have at least a Codex rendering. Kept for
 * symmetry with potential future capability types.
 */
export const CODEX_UNSUPPORTED: readonly string[] = [];
