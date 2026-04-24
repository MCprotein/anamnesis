// Claude Code adapter — project_memory capability.
//
// For CC, project_memory renders as a region inside the project's AGENTS.md.
// CLAUDE.md is handled separately by a top-level emitter that writes a pointer
// to AGENTS.md (not a fragment-level concern in v0.1).

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

export const projectMemoryRenderer: CapabilityRenderer = {
  type: "project_memory",
  adapter: "claude-code",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "project_memory") {
      throw new RenderError(
        `projectMemoryRenderer given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' project_memory source not found: ${sourcePath}`,
      );
    }
    const content = fs.readFileSync(sourcePath, "utf8");
    return [
      {
        kind: "region",
        file: ctx.settings.agents_md_path,
        regionId: capability.region,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
      },
    ];
  },
};
