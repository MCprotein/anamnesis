// Cursor adapter — slash_command → `.cursor/rules/<name>-cmd.mdc`.

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

function escapeYamlString(s: string): string {
  if (/[:#&*!|>'"%@`]/.test(s) || s.includes("\n")) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

export const slashCommandRenderer: CapabilityRenderer = {
  type: "slash_command",
  adapter: "cursor",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "slash_command") {
      throw new RenderError(
        `slash_command (cursor) given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' slash_command source not found: ${sourcePath}`,
      );
    }
    const raw = fs.readFileSync(sourcePath, "utf8");
    const body = stripFrontmatter(raw).trimStart().trimEnd();
    const sideEffects = capabilitySideEffects(capability);

    const description =
      `Command /${capability.name} (from anamnesis fragment ${ctx.fragment.id}). Apply when the user invokes /${capability.name} or asks for "${capability.name}".`;

    const content = [
      "---",
      `description: ${escapeYamlString(description)}`,
      "agentRequested: true",
      "---",
      "",
      ...(sideEffects.length > 0
        ? [`**Declared side effects:** ${formatSideEffects(sideEffects)}.`, ""]
        : []),
      body,
      "",
    ].join("\n");

    return [
      {
        kind: "file",
        path: `.cursor/rules/${capability.name}-cmd.mdc`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
        sideEffects,
      },
    ];
  },
};
