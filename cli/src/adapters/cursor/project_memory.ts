// Cursor adapter — project_memory.
//
// Cursor reads `AGENTS.md` natively (same as Codex). Reuse the Claude
// Code rendering logic — same target file/region. When CC + Cursor share
// `tools`, both adapters emit the same action and init/update dedupe by
// region key.

import { projectMemoryRenderer as ccRenderer } from "../claude-code/project_memory.js";
import type { CapabilityRenderer } from "../../core/render.js";

export const projectMemoryRenderer: CapabilityRenderer = {
  ...ccRenderer,
  adapter: "cursor",
};
