// Codex adapter — ontology capability.
//
// Same target as Claude Code: `.anamnesis/ontology/<id>.yaml` (or under
// the scope's directory in monorepo layouts). Base v9 can also install a
// Codex native SessionStart wrapper that injects these files when executable
// adapters are allowed; AGENTS.md load-context instructions remain the
// fallback and manual orientation path.

import { ontologyRenderer as ccRenderer } from "../claude-code/ontology.js";
import type { CapabilityRenderer } from "../../core/render.js";

export const ontologyRenderer: CapabilityRenderer = {
  ...ccRenderer,
  adapter: "codex",
};
