// Claude Code adapter — skill capability.
//
// A skill is a directory containing SKILL.md and optional supporting files
// (scripts, references). The source is treated as a directory; every file
// inside is mirrored into `.claude/skills/<skill-name>/`, preserving relative
// paths.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

function walkFiles(
  rootDir: string,
  rel: string,
  out: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(rootDir, rel), { withFileTypes: true });
  } catch (e) {
    throw new RenderError(
      `failed to read skill directory ${path.join(rootDir, rel)}: ${(e as Error).message}`,
    );
  }
  for (const entry of entries) {
    const childRel = rel === "" ? entry.name : path.posix.join(rel, entry.name);
    if (entry.isDirectory()) walkFiles(rootDir, childRel, out);
    else if (entry.isFile()) out.push(childRel);
  }
}

export const skillRenderer: CapabilityRenderer = {
  type: "skill",
  adapter: "claude-code",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "skill") {
      throw new RenderError(
        `skillRenderer given wrong capability type: ${capability.type}`,
      );
    }
    const sourceDir = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourceDir)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' skill source not found: ${sourceDir}`,
      );
    }
    if (!fs.statSync(sourceDir).isDirectory()) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' skill source must be a directory: ${sourceDir}`,
      );
    }

    const relFiles: string[] = [];
    walkFiles(sourceDir, "", relFiles);

    if (!relFiles.includes("SKILL.md")) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' skill '${capability.name}' is missing SKILL.md`,
      );
    }

    return relFiles.map((rel) => ({
      kind: "file",
      path: path.posix.join(".claude/skills", capability.name, rel),
      fragmentId: ctx.fragment.id,
      fragmentVersion: ctx.fragment.version,
      content: fs.readFileSync(path.join(sourceDir, rel), "utf8"),
    }));
  },
};
