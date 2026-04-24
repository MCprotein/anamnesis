// Claude Code adapter — ontology capability.
//
// v0.1 strategy: each fragment writes its own file under
// `.anamnesis/ontology/<fragment-id>.yaml`. The SessionStart hook in base/
// concatenates these at session start. This avoids YAML deep-merge and keeps
// fragments additive without stepping on a user-owned `system_graph.yaml`.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

export const ontologyRenderer: CapabilityRenderer = {
  type: "ontology",
  adapter: "claude-code",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "ontology") {
      throw new RenderError(
        `ontologyRenderer given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' ontology source not found: ${sourcePath}`,
      );
    }
    const content = fs.readFileSync(sourcePath, "utf8");
    return [
      {
        kind: "file",
        path: `.anamnesis/ontology/${ctx.fragment.id}.yaml`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
      },
    ];
  },
};
