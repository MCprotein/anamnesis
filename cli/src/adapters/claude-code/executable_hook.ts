// Claude Code adapter — executable_hook capability.
//
// Emits a single FileAction for the hook script with mode 0o755.
// Settings.json registration (wiring the hook into the PreToolUse/PostToolUse
// event table) is handled by the applier layer against a base/ template —
// renderers do not produce settings patches in v0.1.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

export const executableHookRenderer: CapabilityRenderer = {
  type: "executable_hook",
  adapter: "claude-code",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "executable_hook") {
      throw new RenderError(
        `executableHookRenderer given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' hook source not found: ${sourcePath}`,
      );
    }
    const basename = path.basename(capability.source);
    const content = fs.readFileSync(sourcePath, "utf8");
    return [
      {
        kind: "file",
        path: `.claude/hooks/${basename}`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
        mode: 0o755,
      },
    ];
  },
};
