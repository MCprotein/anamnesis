// Trigger expression schema + evaluator.
// Rulebook format spec: rulebook.md "Format" section.
//
// A TriggerExpr is a recursive tagged union:
//   - atoms:    { package_json_has: "..." } / { file_exists: "..." } / etc.
//   - combinators: { any: [expr, expr, ...] }, { all: [expr, expr, ...] }

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types (manual; Zod uses z.lazy for recursion and cannot infer it cleanly)
// ---------------------------------------------------------------------------

export type TriggerExpr =
  | { package_json_has: string }
  | { pyproject_has: string }
  | { file_exists: string }
  | { dir_exists: string }
  | { any_yaml_contains: string }
  | { any: TriggerExpr[] }
  | { all: TriggerExpr[] };

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const triggerExprSchema: z.ZodType<TriggerExpr> = z.lazy(() =>
  z.union([
    z.strictObject({ package_json_has: z.string() }),
    z.strictObject({ pyproject_has: z.string() }),
    z.strictObject({ file_exists: z.string() }),
    z.strictObject({ dir_exists: z.string() }),
    z.strictObject({ any_yaml_contains: z.string() }),
    z.strictObject({ any: z.array(triggerExprSchema) }),
    z.strictObject({ all: z.array(triggerExprSchema) }),
  ]),
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TriggerEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggerEvalError";
  }
}

// ---------------------------------------------------------------------------
// Parsing (YAML string → validated TriggerExpr)
// ---------------------------------------------------------------------------

export function parseTriggerYaml(yamlStr: string): TriggerExpr {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlStr);
  } catch (e) {
    throw new TriggerEvalError(
      `trigger YAML parse error: ${(e as Error).message}`,
    );
  }
  const result = triggerExprSchema.safeParse(parsed);
  if (!result.success) {
    const msgs = result.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
    );
    throw new TriggerEvalError(
      `invalid trigger expression:\n  ${msgs.join("\n  ")}`,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Project context — cached views over the filesystem so repeated
// rule evaluation does not re-read the same files.
// ---------------------------------------------------------------------------

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
]);

export class ProjectContext {
  constructor(public readonly root: string) {}

  private _packageJsonDeps: Record<string, string> | null | undefined =
    undefined;
  private _pyprojectText: string | null | undefined = undefined;
  private _yamlFiles: string[] | undefined = undefined;

  packageJsonDeps(): Record<string, string> | null {
    if (this._packageJsonDeps !== undefined) return this._packageJsonDeps;
    const fp = path.join(this.root, "package.json");
    if (!fs.existsSync(fp)) {
      this._packageJsonDeps = null;
      return null;
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(fp, "utf8")) as Record<
        string,
        unknown
      >;
      const merged: Record<string, string> = {};
      for (const key of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        const section = pkg[key];
        if (section && typeof section === "object") {
          for (const [name, ver] of Object.entries(
            section as Record<string, unknown>,
          )) {
            if (typeof ver === "string") merged[name] = ver;
          }
        }
      }
      this._packageJsonDeps = merged;
      return merged;
    } catch {
      this._packageJsonDeps = null;
      return null;
    }
  }

  pyprojectText(): string | null {
    if (this._pyprojectText !== undefined) return this._pyprojectText;
    const fp = path.join(this.root, "pyproject.toml");
    this._pyprojectText = fs.existsSync(fp)
      ? fs.readFileSync(fp, "utf8")
      : null;
    return this._pyprojectText;
  }

  yamlFiles(): string[] {
    if (this._yamlFiles) return this._yamlFiles;
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
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
        ) {
          out.push(full);
        }
      }
    };
    walk(this.root);
    this._yamlFiles = out;
    return out;
  }

  fileExists(rel: string): boolean {
    return fs.existsSync(path.join(this.root, rel));
  }

  dirExists(rel: string): boolean {
    const p = path.join(this.root, rel);
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateTrigger(
  expr: TriggerExpr,
  ctx: ProjectContext,
): boolean {
  if ("package_json_has" in expr) {
    const deps = ctx.packageJsonDeps();
    return deps !== null && expr.package_json_has in deps;
  }
  if ("pyproject_has" in expr) {
    const text = ctx.pyprojectText();
    return text !== null && text.includes(expr.pyproject_has);
  }
  if ("file_exists" in expr) {
    return ctx.fileExists(expr.file_exists);
  }
  if ("dir_exists" in expr) {
    return ctx.dirExists(expr.dir_exists);
  }
  if ("any_yaml_contains" in expr) {
    const needle = expr.any_yaml_contains;
    return ctx.yamlFiles().some((f) => {
      try {
        return fs.readFileSync(f, "utf8").includes(needle);
      } catch {
        return false;
      }
    });
  }
  if ("any" in expr) {
    return expr.any.some((e) => evaluateTrigger(e, ctx));
  }
  if ("all" in expr) {
    return expr.all.every((e) => evaluateTrigger(e, ctx));
  }
  // Unreachable given schema validation, but exhaustive check.
  throw new TriggerEvalError(
    `unknown trigger expression: ${JSON.stringify(expr)}`,
  );
}
