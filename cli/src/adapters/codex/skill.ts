// Codex adapter — native skill plus AGENTS.md fallback.
//
// Current Codex discovers project-local skills under
// `.codex/skills/<skill-name>/SKILL.md`. The AGENTS.md fallback remains
// mandatory so older Codex surfaces and manual agents can still follow the
// same procedure when native skill discovery is unavailable.

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

function walkFiles(rootDir: string, rel: string, out: string[]): void {
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
    if (entry.isDirectory()) {
      walkFiles(rootDir, childRel, out);
    } else if (entry.isFile()) {
      out.push(childRel);
    }
  }
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
    relFiles.sort();

    if (!relFiles.includes("SKILL.md")) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' skill '${capability.name}' missing SKILL.md`,
      );
    }
    const raw = fs.readFileSync(path.join(sourceDir, "SKILL.md"), "utf8");
    const body = stripFrontmatter(raw).trimStart();
    const sideEffects = capabilitySideEffects(capability);

    const content = [
      `### Skill: \`${capability.name}\``,
      "",
      `When the user asks for "${capability.name}" or the situation matches this procedure, follow the steps below. Codex should load the native project skill from \`.codex/skills/${capability.name}/SKILL.md\` when available; this region is the compatibility fallback.`,
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
      ...relFiles.map((rel) => ({
        kind: "file" as const,
        path: path.posix.join(".codex/skills", capability.name, rel),
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content: fs.readFileSync(path.join(sourceDir, rel), "utf8"),
        sideEffects,
      })),
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
