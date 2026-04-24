// Claude Code adapter — slash_command capability.
//
// A slash command in CC is a markdown file under `.claude/commands/<name>.md`.
// CC discovers commands by filename and `/<name>` invokes them.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

export const slashCommandRenderer: CapabilityRenderer = {
  type: "slash_command",
  adapter: "claude-code",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "slash_command") {
      throw new RenderError(
        `slashCommandRenderer given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' slash_command source not found: ${sourcePath}`,
      );
    }
    const content = fs.readFileSync(sourcePath, "utf8");
    return [
      {
        kind: "file",
        path: `.claude/commands/${capability.name}.md`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
      },
    ];
  },
};
