// fragment.yaml loader + dependency resolver.
// Schema source of truth: docs/DESIGN.md §4.3.
//
// Note: `triggers` live in rulebook.md, not in fragment.yaml, to avoid
// duplication. Fragments only declare what they install and what they need.

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const toolNameSchema = z.enum(["claude-code", "codex", "cursor"]);

const projectMemoryCapSchema = z.object({
  type: z.literal("project_memory"),
  source: z.string(),
  region: z.string(),
});

const ontologyCapSchema = z.object({
  type: z.literal("ontology"),
  source: z.string(),
});

const executableHookCapSchema = z.object({
  type: z.literal("executable_hook"),
  event: z.string(),
  source: z.string(),
  adapters_supported: z.array(toolNameSchema).optional(),
});

const skillCapSchema = z.object({
  type: z.literal("skill"),
  name: z.string(),
  source: z.string(),
});

const slashCommandCapSchema = z.object({
  type: z.literal("slash_command"),
  name: z.string(),
  source: z.string(),
});

export const capabilitySchema = z.discriminatedUnion("type", [
  projectMemoryCapSchema,
  ontologyCapSchema,
  executableHookCapSchema,
  skillCapSchema,
  slashCommandCapSchema,
]);

const ownsEntrySchema = z.union([
  z.object({ region: z.string() }),
  z.object({ file: z.string() }),
]);

export const fragmentSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  description: z.string().optional(),
  requires: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  capabilities: z.array(capabilitySchema),
  owns: z.array(ownsEntrySchema).default([]),
});

export type Capability = z.infer<typeof capabilitySchema>;
export type FragmentDefinition = z.infer<typeof fragmentSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FragmentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FragmentParseError";
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadFragment(
  fragmentDir: string,
  opts: { expectedId?: string } = {},
): FragmentDefinition {
  const yamlPath = path.join(fragmentDir, "fragment.yaml");
  if (!fs.existsSync(yamlPath)) {
    throw new FragmentParseError(`fragment.yaml not found at ${yamlPath}`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(yamlPath, "utf8"));
  } catch (e) {
    throw new FragmentParseError(
      `${yamlPath}: YAML parse error: ${(e as Error).message}`,
    );
  }

  const result = fragmentSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`,
    );
    throw new FragmentParseError(`${yamlPath}:\n${lines.join("\n")}`);
  }

  const expectedId = opts.expectedId ?? path.basename(fragmentDir);
  if (result.data.id !== expectedId) {
    throw new FragmentParseError(
      `${yamlPath}: id '${result.data.id}' must match expected id '${expectedId}'`,
    );
  }

  return result.data;
}

export function fragmentDirOf(libraryRoot: string, fragmentId: string): string {
  if (fragmentId === "base") return path.join(libraryRoot, "base");
  return path.join(libraryRoot, "fragments", fragmentId);
}

export function archivedFragmentDirOf(
  libraryRoot: string,
  fragmentId: string,
  version: number,
): string {
  return path.join(fragmentDirOf(libraryRoot, fragmentId), ".versions", String(version));
}

export function loadFragmentAtVersion(
  libraryRoot: string,
  fragmentId: string,
  version: number,
): FragmentDefinition | null {
  const currentDir = fragmentDirOf(libraryRoot, fragmentId);
  if (fs.existsSync(path.join(currentDir, "fragment.yaml"))) {
    const current = loadFragment(currentDir);
    if (current.version === version) return current;
  }

  const archivedDir = archivedFragmentDirOf(libraryRoot, fragmentId, version);
  if (!fs.existsSync(path.join(archivedDir, "fragment.yaml"))) return null;
  const archived = loadFragment(archivedDir, { expectedId: fragmentId });
  if (archived.version !== version) {
    throw new FragmentParseError(
      `${path.join(archivedDir, "fragment.yaml")}: version '${archived.version}' must match archive directory '${version}'`,
    );
  }
  return archived;
}

/**
 * Load every fragment under `<libraryRoot>/fragments/`.
 * Only directories containing a `fragment.yaml` are considered.
 * Throws on duplicate ids (shouldn't happen given filesystem unique names,
 * but guards against symlinks / accidents).
 */
export function loadAllFragments(
  libraryRoot: string,
): Map<string, FragmentDefinition> {
  const fragmentsDir = path.join(libraryRoot, "fragments");
  const map = new Map<string, FragmentDefinition>();
  if (!fs.existsSync(fragmentsDir)) return map;

  const entries = fs.readdirSync(fragmentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(fragmentsDir, entry.name);
    if (!fs.existsSync(path.join(dir, "fragment.yaml"))) continue;
    const frag = loadFragment(dir);
    if (map.has(frag.id)) {
      throw new FragmentParseError(`duplicate fragment id '${frag.id}'`);
    }
    map.set(frag.id, frag);
  }
  return map;
}

export function resolveCapabilitySource(
  fragmentDir: string,
  cap: Capability,
): string {
  return path.join(fragmentDir, cap.source);
}

/**
 * Load the special `base` fragment from `<libraryRoot>/base/`.
 *
 * The base fragment is auto-included by `init` regardless of rulebook
 * matches — it carries the always-on baseline (load-context skill, ontology
 * inject hook, etc.). Returns null if the library has no `base/` directory
 * or no `fragment.yaml` inside it.
 */
export function loadBaseFragment(
  libraryRoot: string,
): FragmentDefinition | null {
  const dir = path.join(libraryRoot, "base");
  if (!fs.existsSync(path.join(dir, "fragment.yaml"))) return null;
  return loadFragment(dir);
}

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

/**
 * Topologically sort fragments by `requires`. Dependencies come before
 * dependents in the output. Throws on cycles or missing dependencies.
 */
export function topologicalSort(
  fragments: FragmentDefinition[],
): FragmentDefinition[] {
  const byId = new Map(fragments.map((f) => [f.id, f]));
  const state = new Map<string, "gray" | "black">();
  const sorted: FragmentDefinition[] = [];

  function visit(f: FragmentDefinition, stack: string[]): void {
    const s = state.get(f.id);
    if (s === "black") return;
    if (s === "gray") {
      throw new FragmentParseError(
        `fragment dependency cycle: ${[...stack, f.id].join(" -> ")}`,
      );
    }
    state.set(f.id, "gray");
    for (const depId of f.requires) {
      const dep = byId.get(depId);
      if (!dep) {
        throw new FragmentParseError(
          `fragment '${f.id}' requires unknown fragment '${depId}'`,
        );
      }
      visit(dep, [...stack, f.id]);
    }
    state.set(f.id, "black");
    sorted.push(f);
  }

  for (const f of fragments) visit(f, []);
  return sorted;
}

/**
 * Return conflicting fragment id pairs, each pair in lexicographic order
 * and reported only once.
 */
export function detectConflicts(
  fragments: FragmentDefinition[],
): Array<[string, string]> {
  const byId = new Map(fragments.map((f) => [f.id, f]));
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const f of fragments) {
    for (const conflictId of f.conflicts) {
      if (!byId.has(conflictId)) continue;
      const [a, b] = f.id < conflictId ? [f.id, conflictId] : [conflictId, f.id];
      const key = `${a}|${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
