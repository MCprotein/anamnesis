// nestjs introspector — extracts controller route facts from decorators.
//
// First cut: regex-based source scan. It intentionally avoids TypeScript AST
// dependencies and focuses on stable Layer A facts that Layer B can enrich:
// controller prefix, handler name, HTTP method, and route path.

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
  ".turbo",
  ".next",
  ".venv",
  "venv",
]);

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ROUTE_DECORATORS = new Map([
  ["Get", "GET"],
  ["Post", "POST"],
  ["Put", "PUT"],
  ["Patch", "PATCH"],
  ["Delete", "DELETE"],
  ["Head", "HEAD"],
  ["Options", "OPTIONS"],
  ["All", "ALL"],
]);

interface RouteFact {
  method: string;
  path: string;
  handler: string;
}

interface ControllerFact {
  class: string;
  file: string;
  prefix: string;
  routes: RouteFact[];
}

interface Scan {
  controllers: ControllerFact[];
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function walkSourceFiles(root: string): string[] {
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
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!SOURCE_EXTS.has(ext)) continue;
        if (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".test.ts")) {
          continue;
        }
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Decorator parsing
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function extractDecoratorArg(args: string): string {
  const pathProp = args.match(/\bpath\s*:\s*(['"`])([^'"`]*)\1/);
  if (pathProp) return pathProp[2] ?? "";
  const firstString = args.match(/(['"`])([^'"`]*)\1/);
  if (firstString) return firstString[2] ?? "";
  return "";
}

function normalizeSegment(segment: string): string {
  return segment.trim().replace(/^\/+|\/+$/g, "");
}

function joinRoutePath(prefix: string, routePath: string): string {
  const parts = [normalizeSegment(prefix), normalizeSegment(routePath)].filter(
    Boolean,
  );
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface RawController {
  name: string;
  prefix: string;
  body: string;
}

function extractControllers(text: string): RawController[] {
  const controllers: RawController[] = [];
  const re =
    /@Controller\s*(?:\(([\s\S]*?)\))?\s*(?:\n\s*@[\w.]+(?:\([\s\S]*?\))?\s*)*\s*(?:export\s+)?class\s+([A-Za-z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const className = m[2]!;
    const classIdx = text.indexOf("class", m.index);
    const openIdx = text.indexOf("{", classIdx);
    if (openIdx < 0) continue;
    const closeIdx = findMatchingBrace(text, openIdx);
    if (closeIdx < 0) continue;
    controllers.push({
      name: className,
      prefix: extractDecoratorArg(m[1] ?? ""),
      body: text.slice(openIdx + 1, closeIdx),
    });
    re.lastIndex = closeIdx + 1;
  }
  return controllers;
}

function extractRoutes(body: string, prefix: string): RouteFact[] {
  const routes: RouteFact[] = [];
  const decoratorNames = [...ROUTE_DECORATORS.keys()].join("|");
  const re = new RegExp(
    `@(${decoratorNames})\\s*(?:\\(([\\s\\S]*?)\\))?\\s*(?:\\n\\s*@\\w+(?:\\([\\s\\S]*?\\))?\\s*)*\\s*(?:public\\s+|private\\s+|protected\\s+)?(?:async\\s+)?([A-Za-z_][\\w]*)\\s*\\(`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const decorator = m[1]!;
    const method = ROUTE_DECORATORS.get(decorator)!;
    const routePath = extractDecoratorArg(m[2] ?? "");
    routes.push({
      method,
      path: joinRoutePath(prefix, routePath),
      handler: m[3]!,
    });
  }
  routes.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method) ||
      a.handler.localeCompare(b.handler),
  );
  return routes;
}

function scanFile(absPath: string, projectRoot: string, scan: Scan): void {
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  if (!text.includes("@Controller")) return;
  const rel = toPosix(path.relative(projectRoot, absPath));
  const clean = stripComments(text);
  for (const c of extractControllers(clean)) {
    scan.controllers.push({
      class: c.name,
      file: rel,
      prefix: normalizeSegment(c.prefix),
      routes: extractRoutes(c.body, c.prefix),
    });
  }
}

// ---------------------------------------------------------------------------
// Introspector
// ---------------------------------------------------------------------------

export const nestjsIntrospector: Introspector = {
  fragmentId: "nestjs",
  appliesTo(ctx: ProjectContext): boolean {
    const deps = ctx.packageJsonDeps();
    if (deps && ("@nestjs/core" in deps || "@nestjs/common" in deps)) {
      return true;
    }
    if (ctx.fileExists("nest-cli.json")) return true;
    return walkSourceFiles(ctx.root).some((file) => {
      try {
        return fs.readFileSync(file, "utf8").includes("@Controller");
      } catch {
        return false;
      }
    });
  },
  introspect(ctx: ProjectContext): OntologyFacts {
    const scan: Scan = { controllers: [] };
    for (const file of walkSourceFiles(ctx.root)) {
      scanFile(file, ctx.root, scan);
    }
    scan.controllers.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.class.localeCompare(b.class),
    );
    return scan as unknown as OntologyFacts;
  },
};
