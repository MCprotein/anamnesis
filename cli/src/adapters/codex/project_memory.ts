// Codex adapter — project_memory capability.
//
// Codex reads `AGENTS.md` natively. The rendering logic is identical to the
// Claude Code adapter (same target file, same region anchor format). When
// both adapters are active for a project, duplicate actions are deduped
// before planChanges (see init/update commands).
//
// This file deliberately re-exports the CC implementation with the adapter
// label flipped to `codex` so that future Codex-specific divergence (e.g.,
// different region format) can be introduced here without touching CC.

import { projectMemoryRenderer as ccRenderer } from "../claude-code/project_memory.js";
import type { CapabilityRenderer } from "../../core/render.js";

export const projectMemoryRenderer: CapabilityRenderer = {
  ...ccRenderer,
  adapter: "codex",
};
