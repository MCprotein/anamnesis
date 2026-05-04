// Agentfile parser / validator / serializer.
// Schema source of truth: specs/agentfile.md (v1).

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema (specs/agentfile.md §4)
// ---------------------------------------------------------------------------

const toolNameSchema = z.enum(["claude-code", "codex", "cursor"]);

const adapterOverrideSchema = z
  .object({
    "claude-code": z.boolean().optional(),
    codex: z.boolean().optional(),
    cursor: z.boolean().optional(),
  })
  .strict();

const fragmentEntrySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
  adapters: adapterOverrideSchema.optional(),
  pinned: z.boolean().optional(),
});

const scopeSchema = z.object({
  path: z.string(),
  extends: z.string().optional(),
  overrides: z
    .object({
      tools: z.array(toolNameSchema).optional(),
      // Add these fragment entries to the inherited list.
      fragments_add: z.array(fragmentEntrySchema).optional(),
      // Drop these fragment ids from the inherited list (for trimming
      // a child scope down from its parent).
      fragments_remove: z.array(z.string()).optional(),
    })
    .optional(),
});

const fragmentSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
  adapters: adapterOverrideSchema.optional(),
  pinned: z.boolean().optional(),
});

const declinedSchema = z.object({
  id: z.string().min(1),
  reason: z.string().optional(),
  declined_at: z.string().optional(),
});

const settingsSchema = z.object({
  ontology_file: z.string().default("system_graph.yaml"),
  agents_md_path: z.string().default("AGENTS.md"),
  claude_md_path: z.string().default("CLAUDE.md"),
  commit_on_apply: z.boolean().default(false),
  backup_retention: z.number().int().nonnegative().default(10),
});

const regionOverrideSchema = z.object({
  file: z.string(),
  region_id: z.string(),
  locked: z.boolean().optional(),
  reason: z.string().optional(),
});

const fileOverrideSchema = z.object({
  path: z.string(),
  locked: z.boolean().optional(),
});

const overridesSchema = z
  .object({
    regions: z.array(regionOverrideSchema).optional(),
    files: z.array(fileOverrideSchema).optional(),
  })
  .optional();

const projectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scopes: z.array(scopeSchema).optional(),
});

export const agentfileSchema = z.object({
  version: z.literal(1),
  project: projectSchema,
  tools: z.array(toolNameSchema).min(1),
  fragments: z.array(fragmentSchema),
  declined: z.array(declinedSchema).optional(),
  settings: settingsSchema.optional(),
  overrides: overridesSchema,
});

export type Agentfile = z.infer<typeof agentfileSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type Fragment = z.infer<typeof fragmentSchema>;

export function fragmentAdapterEnabled(
  fragment: Pick<Fragment, "adapters">,
  tool: ToolName,
): boolean {
  return fragment.adapters?.[tool] !== false;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AgentfileParseError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentfileParseError";
  }
}

// ---------------------------------------------------------------------------
// Semantic checks (specs/agentfile.md §5)
// ---------------------------------------------------------------------------

function semanticErrors(af: Agentfile): string[] {
  const errors: string[] = [];

  const fragIds = new Set<string>();
  for (const f of af.fragments) {
    if (fragIds.has(f.id)) errors.push(`duplicate fragments[].id: ${f.id}`);
    fragIds.add(f.id);
  }

  const declinedIds = new Set<string>();
  for (const d of af.declined ?? []) {
    if (declinedIds.has(d.id)) errors.push(`duplicate declined[].id: ${d.id}`);
    declinedIds.add(d.id);
  }

  // Scope validation (v0.2+): multi-scope monorepo layout is allowed.
  const scopes = af.project.scopes;
  if (scopes && scopes.length > 0) {
    const seenPaths = new Set<string>();
    const knownPaths = new Set(scopes.map((s) => s.path));
    for (const s of scopes) {
      if (seenPaths.has(s.path)) {
        errors.push(`project.scopes: duplicate path '${s.path}'`);
      }
      seenPaths.add(s.path);
      if (s.extends !== undefined && !knownPaths.has(s.extends)) {
        errors.push(
          `project.scopes: scope '${s.path}' extends unknown scope '${s.extends}'`,
        );
      }
      if (s.extends === s.path) {
        errors.push(`project.scopes: scope '${s.path}' cannot extend itself`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Parse / Stringify
// ---------------------------------------------------------------------------

export function parseAgentfile(input: string): Agentfile {
  let raw: unknown;
  try {
    raw = parseYaml(input);
  } catch (e) {
    throw new AgentfileParseError(
      `YAML parse error: ${(e as Error).message}`,
    );
  }

  const result = agentfileSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`,
    );
    throw new AgentfileParseError(
      `Agentfile validation failed:\n${lines.join("\n")}`,
      result.error.issues,
    );
  }

  const sem = semanticErrors(result.data);
  if (sem.length > 0) {
    throw new AgentfileParseError(
      `Agentfile semantic errors:\n${sem.map((e) => `  ${e}`).join("\n")}`,
    );
  }

  return result.data;
}

export function stringifyAgentfile(af: Agentfile): string {
  return stringifyYaml(af, { indent: 2, lineWidth: 100 });
}

// ---------------------------------------------------------------------------
// Discovery (specs/agentfile.md §1)
// ---------------------------------------------------------------------------

export const DISCOVERY_ORDER = [
  "Agentfile",
  "agentfile.yaml",
  "agentfile.yml",
  ".anamnesis/agentfile.yaml",
] as const;

export function findAgentfile(projectRoot: string): string | null {
  const found = DISCOVERY_ORDER.map((name) => path.join(projectRoot, name))
    .filter((p) => fs.existsSync(p));

  if (found.length === 0) return null;
  if (found.length > 1) {
    throw new AgentfileParseError(
      `Multiple Agentfile variants found. Only one is allowed:\n${found.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  return found[0] ?? null;
}

export function readAgentfile(projectRoot: string): Agentfile {
  const filepath = findAgentfile(projectRoot);
  if (!filepath) {
    throw new AgentfileParseError(
      `No Agentfile found in ${projectRoot}. Expected one of: ${DISCOVERY_ORDER.join(", ")}`,
    );
  }
  const content = fs.readFileSync(filepath, "utf8");
  return parseAgentfile(content);
}

export function writeAgentfile(
  projectRoot: string,
  af: Agentfile,
  filename: string = "Agentfile",
): string {
  const filepath = path.join(projectRoot, filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, stringifyAgentfile(af), "utf8");
  return filepath;
}
