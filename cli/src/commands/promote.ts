// `anamnesis promote` — lift a project-local file into the library as a
// reusable fragment capability.
//
// Supports project_memory, executable_hook, slash_command, skill, ontology,
// and task_harness promotion as reusable fragment templates.

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  fragmentSchema,
  type Capability,
  type FragmentDefinition,
} from "../core/fragments.js";
import { findRegion } from "../core/regions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromotableType = Capability["type"];

export interface PromoteOptions {
  projectRoot: string;
  libraryRoot: string;
  source: string;            // path relative to projectRoot
  fragmentId: string;
  capabilityType?: PromotableType;
  /** Override name for skill / slash_command. Defaults: skill→dir basename, slash→file basename without ext */
  name?: string;
  /**
   * For `project_memory` only. The AGENTS.md / CLAUDE.md region id to
   * extract content from when the source file contains anamnesis region
   * anchors. Also used as the destination region id in the new fragment.
   * Defaults to `fragmentId`.
   */
  region?: string;
  /** Optional description; replaces existing on the fragment if provided. */
  description?: string;
}

export interface PromoteResult {
  fragmentId: string;
  fragmentDir: string;
  capability: Capability;
  filesWritten: string[];    // relative to fragmentDir
  isNewFragment: boolean;
}

export class PromoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromoteError";
  }
}

// ---------------------------------------------------------------------------
// Capability inference
// ---------------------------------------------------------------------------

const SUPPORTED_TYPES: PromotableType[] = [
  "project_memory",
  "executable_hook",
  "slash_command",
  "skill",
  "ontology",
  "task_harness",
];

/**
 * Infer capability type from a project-relative source path.
 * Returns undefined when no clear signal — caller must pass `capabilityType`.
 */
export function detectCapabilityType(rel: string): PromotableType | undefined {
  const norm = rel.replace(/\\/g, "/");
  if (norm.startsWith(".claude/hooks/")) return "executable_hook";
  if (norm.startsWith(".claude/commands/")) return "slash_command";
  if (norm.startsWith(".claude/skills/")) return "skill";
  if (norm.startsWith(".anamnesis/task-harnesses/")) return "task_harness";
  if (norm.startsWith(".anamnesis/ontology/")) return "ontology";
  if (
    norm.endsWith(".sh") ||
    norm.endsWith(".bash") ||
    norm.endsWith(".py")
  ) {
    return "executable_hook";
  }
  if (norm.endsWith(".yaml") || norm.endsWith(".yml")) {
    return "ontology";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fragment.yaml read/write
// ---------------------------------------------------------------------------

function readExistingFragment(
  fragmentDir: string,
): FragmentDefinition | null {
  const yamlPath = path.join(fragmentDir, "fragment.yaml");
  if (!fs.existsSync(yamlPath)) return null;
  const raw = parseYaml(fs.readFileSync(yamlPath, "utf8"));
  const parsed = fragmentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PromoteError(
      `existing ${yamlPath} fails schema validation — refuse to overwrite. Fix it manually first.`,
    );
  }
  return parsed.data;
}

/**
 * Strip empty default arrays before serialization to keep fragment.yaml
 * readable. The Zod schema fills them with `[]`; round-tripping naively
 * would emit noise.
 */
function fragmentToYamlObject(
  def: FragmentDefinition,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: def.id,
    version: def.version,
  };
  if (def.description) out.description = def.description;
  if (def.requires.length > 0) out.requires = def.requires;
  if (def.conflicts.length > 0) out.conflicts = def.conflicts;
  out.capabilities = def.capabilities;
  if (def.owns.length > 0) out.owns = def.owns;
  return out;
}

function writeFragmentYaml(
  fragmentDir: string,
  def: FragmentDefinition,
): void {
  fs.mkdirSync(fragmentDir, { recursive: true });
  fs.writeFileSync(
    path.join(fragmentDir, "fragment.yaml"),
    stringifyYaml(fragmentToYamlObject(def), { indent: 2, lineWidth: 100 }),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Tree copy helper (for skills)
// ---------------------------------------------------------------------------

function copyTree(
  sourceDir: string,
  targetDir: string,
  onFile: (rel: string) => void,
): void {
  const walk = (rel: string): void => {
    const fullSource = path.join(sourceDir, rel);
    fs.mkdirSync(path.join(targetDir, rel), { recursive: true });
    for (const entry of fs.readdirSync(fullSource, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isFile()) {
        const src = path.join(sourceDir, childRel);
        const dst = path.join(targetDir, childRel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        onFile(childRel);
      }
    }
  };
  walk("");
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function promote(opts: PromoteOptions): PromoteResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const sourceRel = opts.source;
  const sourceAbs = path.resolve(projectRoot, sourceRel);

  if (!fs.existsSync(sourceAbs)) {
    throw new PromoteError(`source not found: ${sourceAbs}`);
  }

  // 1. Determine capability type.
  const capabilityType =
    opts.capabilityType ?? detectCapabilityType(sourceRel);
  if (!capabilityType) {
    throw new PromoteError(
      `cannot infer capability type from path '${sourceRel}'. Pass --type explicitly.`,
    );
  }
  if (!SUPPORTED_TYPES.includes(capabilityType)) {
    throw new PromoteError(
      `capability type '${capabilityType}' is not supported by promote. ` +
        `Supported: ${SUPPORTED_TYPES.join(", ")}.`,
    );
  }

  // 2. Resolve fragment dir.
  const fragmentDir = path.join(libraryRoot, "fragments", opts.fragmentId);
  const existing = readExistingFragment(fragmentDir);
  const isNewFragment = existing === null;

  const definition: FragmentDefinition = existing
    ? { ...existing }
    : {
        id: opts.fragmentId,
        version: 1,
        requires: [],
        conflicts: [],
        capabilities: [],
        owns: [],
      };
  if (opts.description) definition.description = opts.description;

  // 3. Copy source + build new capability.
  const filesWritten: string[] = [];
  let newCapability: Capability;

  switch (capabilityType) {
    case "project_memory": {
      if (fs.statSync(sourceAbs).isDirectory()) {
        throw new PromoteError(
          `project_memory source must be a file, got directory: ${sourceAbs}`,
        );
      }
      const region = opts.region ?? opts.fragmentId;

      // If the source file contains an anamnesis region with the named id,
      // extract just that region's inner content. Otherwise treat the whole
      // file as the snippet body.
      const rawText = fs.readFileSync(sourceAbs, "utf8");
      let content: string;
      try {
        const found = findRegion(rawText, region);
        content = found ? found.content.replace(/^\n+|\n+$/g, "") + "\n" : rawText;
      } catch {
        // Source has malformed regions — fall back to whole-file content.
        content = rawText;
      }

      const targetRel = "content/agents.snippet.md";
      const targetAbs = path.join(fragmentDir, targetRel);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.writeFileSync(targetAbs, content, "utf8");
      filesWritten.push(targetRel);

      // A fragment can have at most one project_memory capability.
      const dup = definition.capabilities.find(
        (c) => c.type === "project_memory",
      );
      if (dup) {
        throw new PromoteError(
          `project_memory already declared in fragment '${opts.fragmentId}'.`,
        );
      }
      newCapability = {
        type: "project_memory",
        source: targetRel,
        region,
      };
      break;
    }

    case "executable_hook": {
      if (fs.statSync(sourceAbs).isDirectory()) {
        throw new PromoteError(
          `executable_hook source must be a file, got directory: ${sourceAbs}`,
        );
      }
      const basename = path.basename(sourceRel);
      const targetRel = `adapters/claude-code/hooks/${basename}`;
      const targetAbs = path.join(fragmentDir, targetRel);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.copyFileSync(sourceAbs, targetAbs);
      try {
        fs.chmodSync(targetAbs, 0o755);
      } catch {
        // chmod may fail on filesystems that don't support it — non-fatal.
      }
      filesWritten.push(targetRel);

      const dup = definition.capabilities.find(
        (c) => c.type === "executable_hook" && c.source === targetRel,
      );
      if (dup) {
        throw new PromoteError(
          `hook '${targetRel}' already declared in fragment '${opts.fragmentId}'.`,
        );
      }
      newCapability = {
        type: "executable_hook",
        event: "PostToolUse:Edit",
        source: targetRel,
        adapters_supported: ["claude-code"],
        side_effects: ["local-write"],
      };
      break;
    }

    case "slash_command": {
      if (fs.statSync(sourceAbs).isDirectory()) {
        throw new PromoteError(
          `slash_command source must be a file, got directory: ${sourceAbs}`,
        );
      }
      const name =
        opts.name ?? path.basename(sourceRel, path.extname(sourceRel));
      const targetRel = `adapters/claude-code/commands/${name}.md`;
      const targetAbs = path.join(fragmentDir, targetRel);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.copyFileSync(sourceAbs, targetAbs);
      filesWritten.push(targetRel);

      const dup = definition.capabilities.find(
        (c) => c.type === "slash_command" && c.name === name,
      );
      if (dup) {
        throw new PromoteError(
          `slash_command '${name}' already declared in fragment '${opts.fragmentId}'.`,
        );
      }
      newCapability = {
        type: "slash_command",
        name,
        source: targetRel,
      };
      break;
    }

    case "skill": {
      if (!fs.statSync(sourceAbs).isDirectory()) {
        throw new PromoteError(
          `skill source must be a directory, got file: ${sourceAbs}`,
        );
      }
      if (!fs.existsSync(path.join(sourceAbs, "SKILL.md"))) {
        throw new PromoteError(
          `skill source ${sourceAbs} is missing SKILL.md`,
        );
      }
      const name = opts.name ?? path.basename(sourceAbs);
      const targetRoot = `adapters/claude-code/skills/${name}`;
      copyTree(sourceAbs, path.join(fragmentDir, targetRoot), (rel) => {
        filesWritten.push(path.posix.join(targetRoot, rel));
      });

      const dup = definition.capabilities.find(
        (c) => c.type === "skill" && c.name === name,
      );
      if (dup) {
        throw new PromoteError(
          `skill '${name}' already declared in fragment '${opts.fragmentId}'.`,
        );
      }
      newCapability = {
        type: "skill",
        name,
        source: targetRoot,
      };
      break;
    }

    case "ontology": {
      if (fs.statSync(sourceAbs).isDirectory()) {
        throw new PromoteError(
          `ontology source must be a file, got directory: ${sourceAbs}`,
        );
      }
      const targetRel = "content/ontology.snippet.yaml";
      const targetAbs = path.join(fragmentDir, targetRel);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });

      // If fragment already has an ontology slice, append (concatenate).
      // Otherwise just write.
      let content = fs.readFileSync(sourceAbs, "utf8");
      if (fs.existsSync(targetAbs)) {
        const existingContent = fs.readFileSync(targetAbs, "utf8");
        const sep = existingContent.endsWith("\n") ? "" : "\n";
        content =
          existingContent +
          sep +
          `\n# --- promoted from ${sourceRel} ---\n` +
          content;
      }
      fs.writeFileSync(targetAbs, content, "utf8");
      filesWritten.push(targetRel);

      // A fragment can have at most one ontology capability — if it already
      // has one, we just appended content; don't add a second declaration.
      const existingOntology = definition.capabilities.find(
        (c): c is Extract<Capability, { type: "ontology" }> =>
          c.type === "ontology",
      );
      if (existingOntology) {
        writeFragmentYaml(fragmentDir, definition);
        return {
          fragmentId: opts.fragmentId,
          fragmentDir,
          capability: existingOntology,
          filesWritten,
          isNewFragment,
        };
      }
      newCapability = {
        type: "ontology",
        source: targetRel,
      };
      break;
    }

    case "task_harness": {
      if (fs.statSync(sourceAbs).isDirectory()) {
        throw new PromoteError(
          `task_harness source must be a file, got directory: ${sourceAbs}`,
        );
      }
      const name =
        opts.name ?? path.basename(sourceRel, path.extname(sourceRel));
      const targetRel = `task-harnesses/${name}.yaml`;
      const targetAbs = path.join(fragmentDir, targetRel);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.copyFileSync(sourceAbs, targetAbs);
      filesWritten.push(targetRel);

      const dup = definition.capabilities.find(
        (c) => c.type === "task_harness" && c.name === name,
      );
      if (dup) {
        throw new PromoteError(
          `task_harness '${name}' already declared in fragment '${opts.fragmentId}'.`,
        );
      }
      newCapability = {
        type: "task_harness",
        name,
        source: targetRel,
        lifecycle: "reusable",
      };
      break;
    }
  }

  // 4. Append capability + write fragment.yaml.
  definition.capabilities.push(newCapability);
  writeFragmentYaml(fragmentDir, definition);

  return {
    fragmentId: opts.fragmentId,
    fragmentDir,
    capability: newCapability,
    filesWritten,
    isNewFragment,
  };
}
