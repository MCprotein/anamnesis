// Codex adapter — slash_command fallback.
//
// Codex has no slash command system. The fallback emits an AGENTS.md
// region documenting the command's purpose and steps so the agent can
// honor user requests phrased as "/<name>" or "<name> please" by following
// the documented behavior.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n+/;

function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_RE, "");
}

export const slashCommandRenderer: CapabilityRenderer = {
  type: "slash_command",
  adapter: "codex",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "slash_command") {
      throw new RenderError(
        `slash_command (codex) given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' slash_command source not found: ${sourcePath}`,
      );
    }
    const raw = fs.readFileSync(sourcePath, "utf8");
    const body = stripFrontmatter(raw).trimStart();

    const content = [
      `### Command: \`/${capability.name}\``,
      "",
      `When the user invokes \`/${capability.name}\` or asks for "${capability.name}", follow the steps below. (CC users get this as a native slash command; Codex agents follow it from this region.)`,
      "",
      body.trimEnd(),
    ].join("\n");

    const scopePath = ctx.scopePath ?? ".";
    const targetFile =
      scopePath === "." || scopePath === ""
        ? ctx.settings.agents_md_path
        : path.posix.join(scopePath, ctx.settings.agents_md_path);

    return [
      {
        kind: "region",
        file: targetFile,
        regionId: `codex-cmd-${capability.name}`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
      },
    ];
  },
};
