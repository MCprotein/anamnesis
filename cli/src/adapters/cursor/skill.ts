// Cursor adapter — skill → `.cursor/rules/<name>.mdc`.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n+/;

function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_RE, "");
}

function escapeYamlString(s: string): string {
  if (/[:#&*!|>'"%@`]/.test(s) || s.includes("\n")) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

export const skillRenderer: CapabilityRenderer = {
  type: "skill",
  adapter: "cursor",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "skill") {
      throw new RenderError(
        `skill (cursor) given wrong capability type: ${capability.type}`,
      );
    }
    const skillDir = path.join(ctx.fragmentDir, capability.source);
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' skill '${capability.name}' missing SKILL.md`,
      );
    }
    const raw = fs.readFileSync(skillMdPath, "utf8");
    const body = stripFrontmatter(raw).trimStart().trimEnd();

    const description =
      `Skill ${capability.name} (from anamnesis fragment ${ctx.fragment.id}). Apply when the situation described in the body matches the user's request.`;

    const content = [
      "---",
      `description: ${escapeYamlString(description)}`,
      "agentRequested: true",
      "---",
      "",
      body,
      "",
    ].join("\n");

    return [
      {
        kind: "file",
        path: `.cursor/rules/${capability.name}.mdc`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
      },
    ];
  },
};
