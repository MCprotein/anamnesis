// fastapi introspector — extracts FastAPI app/router route facts.
//
// First cut: regex-based Python source scan. It records factual surfaces
// (FastAPI app variables, APIRouter variables, path operation decorators, and
// include_router calls) without trying to resolve cross-file imports or merge
// include prefixes into route paths. Layer B can add intent and flow semantics.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Introspector, OntologyFacts } from "../core/introspector.js";
import type { ProjectContext } from "../core/triggers.js";

const SKIP_DIRS = new Set([
  ".git",
  ".anamnesis",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "dist",
  "build",
  "site-packages",
  "node_modules",
]);

const ROUTE_METHODS = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["head", "HEAD"],
  ["options", "OPTIONS"],
  ["trace", "TRACE"],
]);

interface AppFact {
  variable: string;
  file: string;
}

interface RouterFact {
  variable: string;
  file: string;
  prefix: string;
  tags?: string[];
}

interface RouteFact {
  owner: string;
  owner_kind: "app" | "router" | "unknown";
  methods: string[];
  path: string;
  handler: string;
  file: string;
  response_model?: string;
  tags?: string[];
}

interface IncludeFact {
  owner: string;
  router: string;
  file: string;
  prefix?: string;
  tags?: string[];
}

interface Scan {
  apps: AppFact[];
  routers: RouterFact[];
  routes: RouteFact[];
  includes: IncludeFact[];
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function walkPythonFiles(root: string): string[] {
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
      } else if (entry.isFile() && entry.name.endsWith(".py")) {
        if (entry.name.startsWith("test_") || entry.name.endsWith("_test.py")) {
          continue;
        }
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

function readIfExists(filePath: string): string | null {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source parsing helpers
// ---------------------------------------------------------------------------

function stripCommentLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function extractStringArg(args: string, key?: string): string {
  const pattern = key
    ? new RegExp(`\\b${key}\\s*=\\s*(['"])\\s*([^'"]*)\\1`)
    : /(['"])([^'"]*)\1/;
  const m = args.match(pattern);
  return m ? (m[2] ?? "") : "";
}

function extractNameArg(args: string, key: string): string | undefined {
  const m = args.match(
    new RegExp(`\\b${key}\\s*=\\s*([A-Za-z_][\\w.\\[\\], ]*)`),
  );
  return m ? m[1]!.trim() : undefined;
}

function extractStringList(args: string, key: string): string[] | undefined {
  const m = args.match(new RegExp(`\\b${key}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) return undefined;
  const values = [...m[1]!.matchAll(/(['"])([^'"]+)\1/g)]
    .map((x) => x[2]!)
    .sort();
  return values.length > 0 ? values : undefined;
}

function normalizePath(routePath: string): string {
  const trimmed = routePath.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function parseMethods(decorator: string, args: string): string[] {
  if (decorator === "api_route") {
    const methods = extractStringList(args, "methods");
    return methods ? methods.map((m) => m.toUpperCase()).sort() : ["ANY"];
  }
  const method = ROUTE_METHODS.get(decorator);
  return method ? [method] : [decorator.toUpperCase()];
}

// ---------------------------------------------------------------------------
// Per-file extraction
// ---------------------------------------------------------------------------

function extractApps(text: string, rel: string, scan: Scan): Set<string> {
  const apps = new Set<string>();
  const re = /\b([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const variable = m[1]!;
    apps.add(variable);
    scan.apps.push({ variable, file: rel });
  }
  return apps;
}

function extractRouters(text: string, rel: string, scan: Scan): Set<string> {
  const routers = new Set<string>();
  const re = /\b([A-Za-z_]\w*)\s*=\s*APIRouter\s*\(([\s\S]*?)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const variable = m[1]!;
    const args = m[2] ?? "";
    routers.add(variable);
    const fact: RouterFact = {
      variable,
      file: rel,
      prefix: normalizePrefix(extractStringArg(args, "prefix")),
    };
    const tags = extractStringList(args, "tags");
    if (tags) fact.tags = tags;
    scan.routers.push(fact);
  }
  return routers;
}

function extractRoutes(
  text: string,
  rel: string,
  scan: Scan,
  apps: Set<string>,
  routers: Set<string>,
): void {
  const decoratorNames = [...ROUTE_METHODS.keys(), "api_route"].join("|");
  const re = new RegExp(
    `@([A-Za-z_]\\w*)\\.(${decoratorNames})\\s*\\(([\\s\\S]*?)\\)\\s*(?:\\n\\s*@[^\\n]+)*\\n\\s*(async\\s+)?def\\s+([A-Za-z_]\\w*)\\s*\\(`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const owner = m[1]!;
    const decorator = m[2]!;
    const args = m[3] ?? "";
    const route: RouteFact = {
      owner,
      owner_kind: routers.has(owner)
        ? "router"
        : apps.has(owner)
          ? "app"
          : "unknown",
      methods: parseMethods(decorator, args),
      path: normalizePath(
        extractStringArg(args, "path") || extractStringArg(args),
      ),
      handler: m[5]!,
      file: rel,
    };
    const responseModel = extractNameArg(args, "response_model");
    if (responseModel) route.response_model = responseModel;
    const tags = extractStringList(args, "tags");
    if (tags) route.tags = tags;
    scan.routes.push(route);
  }
}

function extractIncludes(text: string, rel: string, scan: Scan): void {
  const re = /\b([A-Za-z_]\w*)\.include_router\s*\(([\s\S]*?)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const owner = m[1]!;
    const args = m[2] ?? "";
    const routerMatch = args.match(/^\s*([A-Za-z_]\w*)/);
    if (!routerMatch) continue;
    const include: IncludeFact = {
      owner,
      router: routerMatch[1]!,
      file: rel,
    };
    const prefix = extractStringArg(args, "prefix");
    if (prefix) include.prefix = normalizePath(prefix);
    const tags = extractStringList(args, "tags");
    if (tags) include.tags = tags;
    scan.includes.push(include);
  }
}

function scanFile(absPath: string, projectRoot: string, scan: Scan): void {
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  if (
    !text.includes("FastAPI") &&
    !text.includes("APIRouter") &&
    !text.includes(".include_router") &&
    !text.includes("@")
  ) {
    return;
  }
  const rel = toPosix(path.relative(projectRoot, absPath));
  const clean = stripCommentLines(text);
  const apps = extractApps(clean, rel, scan);
  const routers = extractRouters(clean, rel, scan);
  extractRoutes(clean, rel, scan, apps, routers);
  extractIncludes(clean, rel, scan);
}

// ---------------------------------------------------------------------------
// Introspector
// ---------------------------------------------------------------------------

export const fastapiIntrospector: Introspector = {
  fragmentId: "fastapi",
  appliesTo(ctx: ProjectContext): boolean {
    const pyproject = ctx.pyprojectText();
    if (pyproject?.includes("fastapi")) return true;
    for (const rel of ["requirements.txt", "requirements/base.txt", "uv.lock"]) {
      const text = readIfExists(path.join(ctx.root, rel));
      if (text?.includes("fastapi")) return true;
    }
    return walkPythonFiles(ctx.root).some((file) => {
      try {
        const text = fs.readFileSync(file, "utf8");
        return (
          text.includes("FastAPI(") ||
          text.includes("APIRouter(") ||
          text.includes("from fastapi")
        );
      } catch {
        return false;
      }
    });
  },
  introspect(ctx: ProjectContext): OntologyFacts {
    const scan: Scan = { apps: [], routers: [], routes: [], includes: [] };
    for (const file of walkPythonFiles(ctx.root)) {
      scanFile(file, ctx.root, scan);
    }
    scan.apps.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.variable.localeCompare(b.variable),
    );
    scan.routers.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.variable.localeCompare(b.variable),
    );
    scan.routes.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.path.localeCompare(b.path) ||
        a.owner.localeCompare(b.owner) ||
        a.handler.localeCompare(b.handler),
    );
    scan.includes.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.owner.localeCompare(b.owner) ||
        a.router.localeCompare(b.router),
    );
    return scan as unknown as OntologyFacts;
  },
};
