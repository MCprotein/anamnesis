// Claude Code adapter — skill capability.
//
// A skill is a directory containing SKILL.md and optional supporting files
// (scripts, references). The source is treated as a directory; every file
// inside is mirrored into `.claude/skills/<skill-name>/`, preserving relative
// paths.

import * as fs from "node:fs";
import * as path from "node:path";
import { capabilitySideEffects } from "../../core/capability_side_effects.js";
import type {
  CapabilityRenderer,
  RenderAction,
  RenderContext,
} from "../../core/render.js";
import { RenderError, renderFragmentText } from "../../core/render.js";
import { isParamTemplatedSkillFile } from "../../core/fragment_params.js";

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

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const PARAM_TAG_RE = /\{\{\s*(?:params\b|#|\/|this\b)/;

/**
 * Read one skill file. Markdown bodies receive fragment param substitution;
 * scripts and other files are copied verbatim so params never reach
 * executable code. YAML frontmatter is never substituted: it carries agent
 * permissions (for example `allowed-tools`), and a multi-line value could add
 * keys there. A param tag inside frontmatter fails the render.
 */
export function readSkillFile(
  ctx: RenderContext,
  sourceDir: string,
  source: string,
  rel: string,
): string {
  const raw = fs.readFileSync(path.join(sourceDir, rel), "utf8");
  if (!isParamTemplatedSkillFile(rel)) return raw;
  if (ctx.fragment.params === undefined) return raw;
  const label = `skill source ${path.posix.join(source, rel)}`;
  const frontmatter = FRONTMATTER_RE.exec(raw)?.[0] ?? "";
  if (PARAM_TAG_RE.test(frontmatter)) {
    throw new RenderError(
      `fragment '${ctx.fragment.id}' ${label}: params are not allowed in skill frontmatter`,
    );
  }
  return frontmatter + renderFragmentText(ctx, raw.slice(frontmatter.length), label);
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

    const sideEffects = capabilitySideEffects(capability);

    return relFiles.map((rel) => ({
      kind: "file",
      path: path.posix.join(".claude/skills", capability.name, rel),
      fragmentId: ctx.fragment.id,
      fragmentVersion: ctx.fragment.version,
      content: readSkillFile(ctx, sourceDir, capability.source, rel),
      sideEffects,
    }));
  },
};
