// Cursor adapter — executable_hook → `.cursor/rules/<basename>.mdc`.
//
// Cursor doesn't run hooks but uses MDC rules to inject context when the
// agent's situation matches `description`. We render the hook intent and
// script body as an `agentRequested` rule so Cursor's agent picks it up
// when the corresponding scenario appears (e.g., editing prisma schema).

import * as fs from "node:fs";
import * as path from "node:path";
import {
  capabilitySideEffects,
  formatSideEffects,
} from "../../core/capability_side_effects.js";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

export const executableHookRenderer: CapabilityRenderer = {
  type: "executable_hook",
  adapter: "cursor",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "executable_hook") {
      throw new RenderError(
        `executable_hook (cursor) given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' hook source not found: ${sourcePath}`,
      );
    }
    const basename = path.basename(capability.source);
    const idRoot = basename.replace(/\.[^.]+$/, "");
    const scriptContent = fs.readFileSync(sourcePath, "utf8");
    const sideEffects = capabilitySideEffects(capability);

    const description =
      `Run ${basename} on ${capability.event} (from anamnesis fragment ${ctx.fragment.id}).`;

    const body = [
      `## Hook intent`,
      "",
      `**Trigger event** (Claude Code convention): \`${capability.event}\``,
      "",
      ...(sideEffects.length > 0
        ? [`**Declared side effects:** ${formatSideEffects(sideEffects)}.`, ""]
        : []),
      `Cursor doesn't run hooks. When the situation described above arises (e.g., the agent edits a file relevant to this hook), follow the script's intent. The script body is included for reference; Cursor agents should typically replicate the behavior using available tools.`,
      "",
      "```bash",
      scriptContent.trimEnd(),
      "```",
    ].join("\n");

    const mdc = renderMdc({
      description,
      agentRequested: true,
      body,
    });

    return [
      {
        kind: "file",
        path: `.cursor/rules/${idRoot}.mdc`,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content: mdc,
        sideEffects,
      },
    ];
  },
};

function renderMdc(params: {
  description: string;
  agentRequested?: boolean;
  alwaysApply?: boolean;
  body: string;
}): string {
  const fmLines = ["---", `description: ${escapeYamlString(params.description)}`];
  if (params.agentRequested) fmLines.push("agentRequested: true");
  if (params.alwaysApply) fmLines.push("alwaysApply: true");
  fmLines.push("---");
  return `${fmLines.join("\n")}\n\n${params.body.trim()}\n`;
}

function escapeYamlString(s: string): string {
  // Quote if contains special chars; otherwise plain.
  if (/[:#&*!|>'"%@`]/.test(s) || s.includes("\n")) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}
