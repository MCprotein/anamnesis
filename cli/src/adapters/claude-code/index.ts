// Claude Code adapter — registration entrypoint.
//
// Export the complete set of renderers and a helper that registers them all
// into a RendererRegistry. The `init`/`update` commands call this against
// `defaultRegistry`; tests can call it against isolated registries.

import type { RendererRegistry } from "../../core/render.js";
import { projectMemoryRenderer } from "./project_memory.js";
import { ontologyRenderer } from "./ontology.js";
import { executableHookRenderer } from "./executable_hook.js";
import { skillRenderer } from "./skill.js";
import { slashCommandRenderer } from "./slash_command.js";
import { taskHarnessRenderer } from "./task_harness.js";

export const claudeCodeRenderers = [
  projectMemoryRenderer,
  ontologyRenderer,
  executableHookRenderer,
  skillRenderer,
  slashCommandRenderer,
  taskHarnessRenderer,
] as const;

export function registerClaudeCode(registry: RendererRegistry): void {
  for (const renderer of claudeCodeRenderers) {
    registry.register(renderer);
  }
}

export {
  projectMemoryRenderer,
  ontologyRenderer,
  executableHookRenderer,
  skillRenderer,
  slashCommandRenderer,
  taskHarnessRenderer,
};
