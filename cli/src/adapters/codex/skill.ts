// Codex adapter — skill fallback.
//
// Codex has no skill primitive. The fallback emits an AGENTS.md region
// containing the skill body (frontmatter stripped) so the agent can follow
// the procedure when relevant. CC adapter still installs the skill under
// `.claude/skills/` for native CC invocation; the Codex region is
// belt-and-suspenders.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  capabilitySideEffects,
  formatSideEffects,
} from "../../core/capability_side_effects.js";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n+/;

function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_RE, "");
}

export const skillRenderer: CapabilityRenderer = {
  type: "skill",
  adapter: "codex",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "skill") {
      throw new RenderError(
        `skill (codex) given wrong capability type: ${capability.type}`,
      );
    }
    const skillDir = path.join(ctx.fragmentDir, capability.source);
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' skill '${capability.name}' missing SKILL.md at ${skillMdPath}`,
      );
    }
    const raw = fs.readFileSync(skillMdPath, "utf8");
    const body = stripFrontmatter(raw).trimStart();
    const sideEffects = capabilitySideEffects(capability);

    const content = [
      `### Skill: \`${capability.name}\``,
      "",
      `When the user asks for "${capability.name}" or the situation matches this procedure, follow the steps below. (CC users invoke this as a native skill; Codex agents read it from this region.)`,
      "",
      ...(sideEffects.length > 0
        ? [`**Declared side effects:** ${formatSideEffects(sideEffects)}.`, ""]
        : []),
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
        regionId: `codex-skill-${capability.name}`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        sideEffects,
        content,
      },
    ];
  },
};
