// nextjs introspector — finds App Router and Pages Router route surfaces.
//
// First cut: filesystem convention parser. It does not execute Next.js or
// evaluate rewrites/middleware matchers; it reports the route files that exist
// in source so Layer B can add intent, flows, and operational notes.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Introspector, OntologyFacts } from "../core/introspector.js";
import type { ProjectContext } from "../core/triggers.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".anamnesis",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  "out",
]);

const ROUTE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mdx"]);
const APP_ROUTE_FILES = new Set(["page", "route"]);
const PAGE_SPECIAL_FILES = new Set(["_app", "_document", "_error"]);
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface RouteFact {
  router: "app" | "pages";
  kind: "page" | "route_handler" | "api_route";
  path: string;
  file: string;
  methods?: string[];
}

interface MiddlewareFact {
  file: string;
}

interface Scan {
  routes: RouteFact[];
  middleware: MiddlewareFact[];
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function stripRouteExt(name: string): string | null {
  for (const ext of ROUTE_EXTS) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return null;
}

function hasRouteExt(name: string): boolean {
  return stripRouteExt(name) !== null;
}

function walkFiles(root: string): string[] {
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
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

function fileParts(absPath: string, projectRoot: string): string[] {
  return toPosix(path.relative(projectRoot, absPath)).split("/");
}

function findRouteRoot(parts: string[], rootName: "app" | "pages"): number {
  // Prefer the deepest app/pages directory so monorepo paths like
  // apps/web/app/page.tsx resolve against the route root, not the workspace.
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i] === rootName) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Route normalization
// ---------------------------------------------------------------------------

function normalizePath(segments: string[]): string {
  const kept = segments.filter((segment) => {
    if (!segment) return false;
    // Route groups and parallel route slots do not contribute URL segments.
    if (/^\(.+\)$/.test(segment)) return false;
    if (segment.startsWith("@")) return false;
    return true;
  });
  if (kept.length === 0) return "/";
  return `/${kept.join("/")}`;
}

function pagePathFromSegments(segments: string[]): string {
  const trimmed = [...segments];
  if (trimmed[trimmed.length - 1] === "index") trimmed.pop();
  return normalizePath(trimmed);
}

function exportedMethods(absPath: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const methods = new Set<string>();
  for (const method of HTTP_METHODS) {
    const fn = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${method}\\b`,
    );
    const variable = new RegExp(`export\\s+const\\s+${method}\\b`);
    if (fn.test(text) || variable.test(text)) methods.add(method);
  }
  return [...methods].sort();
}

// ---------------------------------------------------------------------------
// Per-router scanners
// ---------------------------------------------------------------------------

function scanAppRoute(absPath: string, projectRoot: string): RouteFact | null {
  const parts = fileParts(absPath, projectRoot);
  const base = stripRouteExt(parts[parts.length - 1] ?? "");
  if (!base || !APP_ROUTE_FILES.has(base)) return null;
  const appIdx = findRouteRoot(parts, "app");
  if (appIdx < 0) return null;
  const routePath = normalizePath(parts.slice(appIdx + 1, -1));
  const fact: RouteFact = {
    router: "app",
    kind: base === "page" ? "page" : "route_handler",
    path: routePath,
    file: toPosix(path.relative(projectRoot, absPath)),
  };
  if (base === "route") {
    const methods = exportedMethods(absPath);
    if (methods.length > 0) fact.methods = methods;
  }
  return fact;
}

function scanPagesRoute(absPath: string, projectRoot: string): RouteFact | null {
  const parts = fileParts(absPath, projectRoot);
  if (!hasRouteExt(parts[parts.length - 1] ?? "")) return null;
  const pagesIdx = findRouteRoot(parts, "pages");
  if (pagesIdx < 0) return null;
  const filename = stripRouteExt(parts[parts.length - 1]!)!;
  if (PAGE_SPECIAL_FILES.has(filename)) return null;
  const routeSegments = [...parts.slice(pagesIdx + 1, -1), filename];
  const isApi = routeSegments[0] === "api";
  return {
    router: "pages",
    kind: isApi ? "api_route" : "page",
    path: pagePathFromSegments(routeSegments),
    file: toPosix(path.relative(projectRoot, absPath)),
  };
}

function scanMiddleware(absPath: string, projectRoot: string): MiddlewareFact | null {
  const parts = fileParts(absPath, projectRoot);
  const filename = parts[parts.length - 1] ?? "";
  const base = stripRouteExt(filename);
  if (base !== "middleware") return null;
  const rel = toPosix(path.relative(projectRoot, absPath));
  if (
    rel !== "middleware.ts" &&
    rel !== "middleware.js" &&
    rel !== "src/middleware.ts" &&
    rel !== "src/middleware.js"
  ) {
    return null;
  }
  return { file: rel };
}

// ---------------------------------------------------------------------------
// Introspector
// ---------------------------------------------------------------------------

export const nextjsIntrospector: Introspector = {
  fragmentId: "nextjs",
  appliesTo(ctx: ProjectContext): boolean {
    const deps = ctx.packageJsonDeps();
    if (deps && "next" in deps) return true;
    if (
      ctx.fileExists("next.config.js") ||
      ctx.fileExists("next.config.mjs") ||
      ctx.fileExists("next.config.ts")
    ) {
      return true;
    }
    return walkFiles(ctx.root).some((file) => {
      const parts = fileParts(file, ctx.root);
      return (
        scanAppRoute(file, ctx.root) !== null ||
        scanPagesRoute(file, ctx.root) !== null ||
        parts.includes("app") ||
        parts.includes("pages")
      );
    });
  },
  introspect(ctx: ProjectContext): OntologyFacts {
    const scan: Scan = { routes: [], middleware: [] };
    for (const file of walkFiles(ctx.root)) {
      const appRoute = scanAppRoute(file, ctx.root);
      if (appRoute) {
        scan.routes.push(appRoute);
        continue;
      }
      const pagesRoute = scanPagesRoute(file, ctx.root);
      if (pagesRoute) {
        scan.routes.push(pagesRoute);
        continue;
      }
      const middleware = scanMiddleware(file, ctx.root);
      if (middleware) scan.middleware.push(middleware);
    }
    scan.routes.sort(
      (a, b) =>
        a.router.localeCompare(b.router) ||
        a.path.localeCompare(b.path) ||
        a.file.localeCompare(b.file),
    );
    scan.middleware.sort((a, b) => a.file.localeCompare(b.file));
    return scan as unknown as OntologyFacts;
  },
};
