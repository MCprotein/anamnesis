// prisma introspector — finds schema.prisma file(s) under the project
// root and extracts datasources, generators, models, and enums.
//
// First-cut parser: regex-based block scanning. The Prisma DSL grammar
// is closer to a real language (allows nested attributes, scoped names,
// multi-file schema layouts), and a full parser is overkill here. We
// produce a useful structural summary; non-supported edge cases yield
// best-effort output (skipped lines, not crashes).

import * as fs from "node:fs";
import * as path from "node:path";
import type { Introspector, OntologyFacts } from "../core/introspector.js";
import type { ProjectContext } from "../core/triggers.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".anamnesis",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "target",
]);

interface DatasourceFact {
  name: string;
  provider: string;
}

interface GeneratorFact {
  name: string;
  provider: string;
  output?: string;
}

interface FieldFact {
  name: string;
  type: string; // raw type token, e.g., "String", "Int?", "User[]"
  attributes: string[]; // e.g., ["@id", "@default(autoincrement())"]
}

interface ModelFact {
  name: string;
  file: string; // relative path from projectRoot
  fields: FieldFact[];
}

interface EnumFact {
  name: string;
  file: string;
  values: string[];
}

// ---------------------------------------------------------------------------
// Filesystem walk
// ---------------------------------------------------------------------------

function findSchemaFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".prisma")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

interface RawBlock {
  kind: "datasource" | "generator" | "model" | "enum" | "view" | "type";
  name: string;
  bodyLines: string[];
}

function stripComments(line: string): string {
  // Drop trailing `// ...` (but not inside a string; Prisma rarely
  // strings comments though, so this approximation is fine).
  const i = line.indexOf("//");
  return i >= 0 ? line.slice(0, i).trimEnd() : line.trimEnd();
}

function parseBlocks(text: string): RawBlock[] {
  const lines = text.split("\n");
  const blocks: RawBlock[] = [];
  let cur: RawBlock | null = null;
  let depth = 0;
  for (let raw of lines) {
    const line = stripComments(raw).trim();
    if (!cur) {
      // Try to start a block.
      const m = line.match(
        /^(datasource|generator|model|enum|view|type)\s+([A-Za-z_][\w]*)\s*\{?\s*$/,
      );
      if (m) {
        cur = {
          kind: m[1] as RawBlock["kind"],
          name: m[2]!,
          bodyLines: [],
        };
        if (line.endsWith("{")) depth = 1;
        else depth = 0; // brace on next line
      }
      continue;
    }
    if (depth === 0 && line === "{") {
      depth = 1;
      continue;
    }
    if (line === "}") {
      depth -= 1;
      if (depth <= 0) {
        blocks.push(cur);
        cur = null;
        depth = 0;
      }
      continue;
    }
    // Track nested braces for attributes like @@map(...) and @@index([...]).
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (line.length > 0) cur.bodyLines.push(line);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Per-kind extractors
// ---------------------------------------------------------------------------

function extractKeyValue(bodyLines: string[]): Record<string, string> {
  // datasource / generator bodies are simple `key = value` pairs.
  const out: Record<string, string> = {};
  for (const line of bodyLines) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][\w]*$/.test(key)) continue;
    const val = line.slice(eq + 1).trim();
    out[key] = val;
  }
  return out;
}

function unquote(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const m = v.match(/^"(.*)"$/);
  return m ? m[1]! : v;
}

function extractFields(bodyLines: string[]): FieldFact[] {
  const fields: FieldFact[] = [];
  for (const line of bodyLines) {
    // Skip block-level @@attributes.
    if (line.startsWith("@@")) continue;
    // A field declaration: name TypeToken [attrs...]
    // Need to be careful: "TypeToken" can include `?` or `[]`.
    const m = line.match(
      /^([A-Za-z_][\w]*)\s+([^\s]+)(.*)$/,
    );
    if (!m) continue;
    const name = m[1]!;
    const type = m[2]!;
    const tail = m[3]!.trim();
    const attributes: string[] = [];
    if (tail.length > 0) {
      // Split by whitespace but keep balanced parens.
      let depth = 0;
      let cur = "";
      for (const ch of tail) {
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
        if (/\s/.test(ch) && depth === 0) {
          if (cur.length > 0) {
            attributes.push(cur);
            cur = "";
          }
        } else {
          cur += ch;
        }
      }
      if (cur.length > 0) attributes.push(cur);
    }
    fields.push({ name, type, attributes });
  }
  return fields;
}

function extractEnumValues(bodyLines: string[]): string[] {
  return bodyLines
    .filter((l) => /^[A-Za-z_][\w]*$/.test(l) || /^[A-Za-z_][\w]*\s/.test(l))
    .map((l) => l.split(/\s/)[0]!)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// File scanner
// ---------------------------------------------------------------------------

interface Scan {
  datasources: DatasourceFact[];
  generators: GeneratorFact[];
  models: ModelFact[];
  enums: EnumFact[];
}

function scanFile(absPath: string, projectRoot: string, scan: Scan): void {
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  const rel = path.relative(projectRoot, absPath);
  const blocks = parseBlocks(text);
  for (const b of blocks) {
    if (b.kind === "datasource") {
      const kv = extractKeyValue(b.bodyLines);
      const provider = unquote(kv.provider) ?? "(unknown)";
      scan.datasources.push({ name: b.name, provider });
    } else if (b.kind === "generator") {
      const kv = extractKeyValue(b.bodyLines);
      const provider = unquote(kv.provider) ?? "(unknown)";
      const fact: GeneratorFact = { name: b.name, provider };
      const output = unquote(kv.output);
      if (output !== undefined) fact.output = output;
      scan.generators.push(fact);
    } else if (b.kind === "model" || b.kind === "view" || b.kind === "type") {
      scan.models.push({
        name: b.name,
        file: rel,
        fields: extractFields(b.bodyLines),
      });
    } else if (b.kind === "enum") {
      scan.enums.push({
        name: b.name,
        file: rel,
        values: extractEnumValues(b.bodyLines),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Introspector
// ---------------------------------------------------------------------------

export const prismaIntrospector: Introspector = {
  fragmentId: "prisma",
  appliesTo(ctx: ProjectContext): boolean {
    return findSchemaFiles(ctx.root).length > 0;
  },
  introspect(ctx: ProjectContext): OntologyFacts {
    const scan: Scan = {
      datasources: [],
      generators: [],
      models: [],
      enums: [],
    };
    for (const f of findSchemaFiles(ctx.root)) {
      scanFile(f, ctx.root, scan);
    }
    scan.datasources.sort((a, b) => a.name.localeCompare(b.name));
    scan.generators.sort((a, b) => a.name.localeCompare(b.name));
    scan.models.sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
    );
    scan.enums.sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
    );
    return scan as unknown as OntologyFacts;
  },
};
