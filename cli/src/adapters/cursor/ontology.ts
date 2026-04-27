// Cursor adapter — ontology.
//
// Same target as CC: `.anamnesis/ontology/<id>.yaml` (or scope-relative
// in monorepos). Cursor agents read these files when AGENTS.md or a
// `.cursor/rules/*.mdc` instructs them to. Reuse CC implementation.

import { ontologyRenderer as ccRenderer } from "../claude-code/ontology.js";
import type { CapabilityRenderer } from "../../core/render.js";

export const ontologyRenderer: CapabilityRenderer = {
  ...ccRenderer,
  adapter: "cursor",
};
