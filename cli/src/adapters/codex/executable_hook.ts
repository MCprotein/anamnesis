// Codex adapter — executable_hook fallback.
//
// Codex has no SessionStart / PostToolUse / etc. hook system. The fallback
// emits an AGENTS.md region documenting the hook so the agent can manually
// follow the intent when relevant. Belt-and-suspenders alongside the CC
// adapter: when both `claude-code` and `codex` are in tools, CC gets the
// real script under `.claude/hooks/` AND Codex gets the AGENTS.md
// instruction. Codex-only users still see the intent.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

export const executableHookRenderer: CapabilityRenderer = {
  type: "executable_hook",
  adapter: "codex",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "executable_hook") {
      throw new RenderError(
        `executable_hook (codex) given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' hook source not found: ${sourcePath}`,
      );
    }
    const basename = path.basename(capability.source);
    const scriptContent = fs.readFileSync(sourcePath, "utf8");

    // Region id: deterministic per fragment+hook so updates align.
    const regionId = `codex-hook-${basename.replace(/\.[^.]+$/, "")}`;

    const content = formatHookRegion({
      fragmentId: ctx.fragment.id,
      basename,
      event: capability.event,
      script: scriptContent,
    });

    const scopePath = ctx.scopePath ?? ".";
    const targetFile =
      scopePath === "." || scopePath === ""
        ? ctx.settings.agents_md_path
        : path.posix.join(scopePath, ctx.settings.agents_md_path);

    return [
      {
        kind: "region",
        file: targetFile,
        regionId,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
      },
    ];
  },
};

function formatHookRegion(params: {
  fragmentId: string;
  basename: string;
  event: string;
  script: string;
}): string {
  return [
    `### ${params.fragmentId} hook: \`${params.basename}\``,
    "",
    `**When:** \`${params.event}\` (Claude Code event; Codex has no native hook system).`,
    "",
    `**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).`,
    "",
    "```bash",
    params.script.trimEnd(),
    "```",
  ].join("\n");
}
