// Claude Code adapter — executable_hook capability.
//
// Emits a single FileAction for the hook script with mode 0o755.
// Settings.json registration (wiring the hook into the PreToolUse/PostToolUse
// event table) is handled by the applier layer against a base/ template —
// renderers do not produce settings patches in v0.1.

import * as fs from "node:fs";
import * as path from "node:path";
import { capabilitySideEffects } from "../../core/capability_side_effects.js";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

// Fragment events name the Edit tool as the generic file-edit trigger (Codex
// maps it to `Edit|Write|apply_patch`). Claude Code matchers are exact tool
// names, so widen it to every Claude file-writing tool.
const CLAUDE_MATCHER_ALIASES: Record<string, string> = {
  Edit: "Edit|Write|NotebookEdit",
};

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
    const sideEffects = capabilitySideEffects(capability);

    // Parse `event` into Claude Code settings.json layout:
    //   "PostToolUse:Edit" → { event: "PostToolUse", matcher: "Edit|Write|NotebookEdit" }
    //   "SessionStart"     → { event: "SessionStart" }
    const colon = capability.event.indexOf(":");
    const rawMatcher = colon >= 0 ? capability.event.slice(colon + 1) : null;
    const settingsHook =
      rawMatcher !== null
        ? {
            event: capability.event.slice(0, colon),
            matcher: claudeMatcher(rawMatcher),
            ...(claudeMatcher(rawMatcher) !== rawMatcher
              ? { legacyMatchers: [rawMatcher] }
              : {}),
          }
        : { event: capability.event };

    return [
      {
        kind: "file",
        path: `.claude/hooks/${basename}`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
        mode: 0o755,
        sideEffects,
        settingsHook,
      },
    ];
  },
};

function claudeMatcher(matcher: string): string {
  return CLAUDE_MATCHER_ALIASES[matcher] ?? matcher;
}
