// Codex adapter — ontology capability.
//
// Same target as Claude Code: `.anamnesis/ontology/<id>.yaml` (or under
// the scope's directory in monorepo layouts). Codex agents read these
// files when AGENTS.md instructs them to (the load-context skill / command
// in the base fragment, plus the SessionStart hook of the CC adapter
// which doesn't fire on Codex — Codex users may run `/load-context` or
// equivalent themselves).

import { ontologyRenderer as ccRenderer } from "../claude-code/ontology.js";
import type { CapabilityRenderer } from "../../core/render.js";

export const ontologyRenderer: CapabilityRenderer = {
  ...ccRenderer,
  adapter: "codex",
};
