// Cursor adapter — registration entrypoint.
//
// Cursor reads `.cursor/rules/*.mdc` natively. Strategy:
//   - project_memory / ontology: same as CC and Codex (AGENTS.md region +
//     ontology slice files; Cursor reads AGENTS.md natively too).
//   - executable_hook / skill / slash_command: emit `.cursor/rules/*.mdc`
//     with `agentRequested: true` so Cursor's agent applies them when
//     the situation matches the description.

import type { RendererRegistry } from "../../core/render.js";
import { projectMemoryRenderer } from "./project_memory.js";
import { ontologyRenderer } from "./ontology.js";
import { executableHookRenderer } from "./executable_hook.js";
import { skillRenderer } from "./skill.js";
import { slashCommandRenderer } from "./slash_command.js";

export const cursorRenderers = [
  projectMemoryRenderer,
  ontologyRenderer,
  executableHookRenderer,
  skillRenderer,
  slashCommandRenderer,
] as const;

export function registerCursor(registry: RendererRegistry): void {
  for (const renderer of cursorRenderers) {
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
