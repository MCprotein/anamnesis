// Monorepo detection — finds sub-project scopes from common monorepo
// declarations.
//
// v0.3 #4 first cut: package.json workspaces only (the most common form
// used by npm/yarn/bun/pnpm projects). pnpm-workspace.yaml, lerna.json,
// nx.json, and "conventional dir" detection (apps/* / packages/* without
// explicit declaration) are deferred to follow-up patches in v0.3.

import * as fs from "node:fs";
import * as path from "node:path";
import { matchingRules, type Rule } from "./rulebook.js";
import { ProjectContext } from "./triggers.js";

export type MonorepoDeclaration =
  | "package_json_workspaces"
  | null;

export interface ScopeCandidate {
  /** Project-relative directory, e.g. "apps/api". */
  path: string;
  /** Rulebook rules that match within this scope. */
  matchedRules: Rule[];
}

export interface MonorepoDetection {
  isMonorepo: boolean;
  declaredVia: MonorepoDeclaration;
  /** Scope candidates with at least one rulebook match. */
  scopes: ScopeCandidate[];
  /** Scope dirs found but with no rulebook hits — useful for diagnostic output. */
  emptyScopes: string[];
}

// ---------------------------------------------------------------------------
// package.json workspaces parsing
// ---------------------------------------------------------------------------

interface WorkspacesField {
  patterns: string[];
}

function readPackageJsonWorkspaces(
  projectRoot: string,
): WorkspacesField | null {
  const fp = path.join(projectRoot, "package.json");
  if (!fs.existsSync(fp)) return null;
  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
  if (typeof pkg !== "object" || pkg === null) return null;
  const ws = (pkg as Record<string, unknown>)["workspaces"];

  // Form 1: workspaces is an array of patterns
  if (Array.isArray(ws)) {
    return { patterns: ws.filter((p): p is string => typeof p === "string") };
  }
  // Form 2: workspaces is an object with `packages` array (yarn classic style)
  if (typeof ws === "object" && ws !== null) {
    const packages = (ws as Record<string, unknown>)["packages"];
    if (Array.isArray(packages)) {
      return {
        patterns: packages.filter((p): p is string => typeof p === "string"),
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Glob expansion (simple — only `<dir>/*` and exact paths)
// ---------------------------------------------------------------------------

function expandPattern(projectRoot: string, pattern: string): string[] {
  // Normalize separators to posix style for project-relative output.
  const normalized = pattern.replace(/\\/g, "/");

  if (normalized.endsWith("/*")) {
    const base = normalized.slice(0, -2);
    const baseAbs = path.join(projectRoot, base);
    if (!fs.existsSync(baseAbs)) return [];
    const entries = fs.readdirSync(baseAbs, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.posix.join(base, e.name));
  }

  // Exact path (no glob).
  if (!normalized.includes("*")) {
    const abs = path.join(projectRoot, normalized);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      return [normalized];
    }
    return [];
  }

  // More complex globs (e.g. `apps/**/foo`) deferred.
  return [];
}

function expandPatterns(
  projectRoot: string,
  patterns: string[],
): string[] {
  const out = new Set<string>();
  for (const p of patterns) {
    for (const dir of expandPattern(projectRoot, p)) {
      out.add(dir);
    }
  }
  return Array.from(out).sort();
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectMonorepo(
  projectRoot: string,
  rules: Rule[],
): MonorepoDetection {
  const root = path.resolve(projectRoot);
  const ws = readPackageJsonWorkspaces(root);

  if (!ws || ws.patterns.length === 0) {
    return {
      isMonorepo: false,
      declaredVia: null,
      scopes: [],
      emptyScopes: [],
    };
  }

  const dirs = expandPatterns(root, ws.patterns);
  const scopes: ScopeCandidate[] = [];
  const emptyScopes: string[] = [];

  for (const dir of dirs) {
    const subRoot = path.join(root, dir);
    const ctx = new ProjectContext(subRoot);
    const matched = matchingRules(rules, ctx);
    if (matched.length > 0) {
      scopes.push({ path: dir, matchedRules: matched });
    } else {
      emptyScopes.push(dir);
    }
  }

  return {
    isMonorepo: true,
    declaredVia: "package_json_workspaces",
    scopes,
    emptyScopes,
  };
}
