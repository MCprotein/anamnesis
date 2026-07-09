import * as fs from "node:fs";
import * as path from "node:path";

export interface WorkspaceProfile {
  knownStacks: string[];
  unsupportedSignals: string[];
  artifactSignals: string[];
  agentSurfaces: string[];
  verificationSignals: string[];
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
]);

export function detectWorkspaceProfile(projectRoot: string): WorkspaceProfile {
  const root = path.resolve(projectRoot);
  const files = walkFiles(root, 1200);
  const fileSet = new Set(files);
  const packageJson = readJson(path.join(root, "package.json")) as
    | {
        scripts?: Record<string, unknown>;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      }
    | undefined;
  const deps = new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);

  const knownStacks = unique([
    fileSet.has("prisma/schema.prisma") || deps.has("@prisma/client") ? "prisma" : "",
    hasDir(files, "k8s") ? "k8s" : "",
    deps.has("@nestjs/core") ? "nestjs" : "",
    deps.has("next") ? "nextjs" : "",
    hasPyprojectDependency(root, "fastapi") ? "fastapi" : "",
    fileSet.has("uv.lock") ? "python-uv" : "",
    fileSet.has("docker-compose.yml") || fileSet.has("compose.yaml") ? "docker-compose" : "",
    fileSet.has("Gemfile") && fileSet.has("config/application.rb") ? "rails" : "",
    fileSet.has("manage.py") || hasPyprojectDependency(root, "django") ? "django" : "",
    fileSet.has("go.mod") ? "go" : "",
    fileSet.has("Cargo.toml") ? "rust" : "",
    deps.has("@sveltejs/kit") ? "sveltekit" : "",
    deps.has("@remix-run/node") || deps.has("@remix-run/react") ? "remix" : "",
    deps.has("nuxt") ? "nuxt" : "",
  ]);

  const unsupportedSignals = unique([
    deps.has("vite") || hasAny(files, ["vite.config.ts", "vite.config.js"]) ? "vite" : "",
    deps.has("astro") || hasAny(files, ["astro.config.mjs", "astro.config.ts"]) ? "astro" : "",
    fileSet.has("deno.json") || fileSet.has("deno.jsonc") ? "deno" : "",
    hasAny(files, ["bun.lock", "bun.lockb"]) ? "bun" : "",
    hasAny(files, ["turbo.json"]) ? "turborepo" : "",
    hasExt(files, ".tf") ? "terraform" : "",
    hasAny(files, ["Pulumi.yaml", "Pulumi.yml"]) ? "pulumi" : "",
    hasAny(files, ["playwright.config.ts", "playwright.config.js"]) ? "playwright" : "",
    hasAny(files, ["tauri.conf.json", "src-tauri/Cargo.toml"]) ? "tauri" : "",
  ]).filter((signal) => !knownStacks.includes(signal));

  const markdownCount = files.filter((file) => file.toLowerCase().endsWith(".md")).length;
  const docsCount = files.filter((file) => file.startsWith("docs/")).length;
  const mediaCount = files.filter((file) =>
    /\.(png|jpe?g|webp|gif|svg|pdf|pptx|docx|xlsx)$/i.test(file),
  ).length;
  const dataCount = files.filter((file) =>
    /\.(csv|tsv|jsonl|parquet|sqlite|db)$/i.test(file),
  ).length;
  const artifactSignals = unique([
    markdownCount >= 5 ? `${markdownCount} markdown files` : "",
    docsCount >= 5 ? `${docsCount} docs/ files` : "",
    mediaCount >= 3 ? `${mediaCount} media/document artifacts` : "",
    dataCount >= 3 ? `${dataCount} data artifacts` : "",
  ]);

  const agentSurfaces = unique([
    fileSet.has("AGENTS.md") ? "AGENTS.md" : "",
    fileSet.has("CLAUDE.md") ? "CLAUDE.md" : "",
    hasDir(files, ".codex") ? ".codex/" : "",
    hasDir(files, ".claude") ? ".claude/" : "",
    hasDir(files, ".cursor") ? ".cursor/" : "",
    hasDir(files, ".anamnesis") ? ".anamnesis/" : "",
  ]);

  const scripts = packageJson?.scripts ?? {};
  const verificationSignals = unique([
    typeof scripts.test === "string" ? "npm test" : "",
    typeof scripts.lint === "string" ? "npm run lint" : "",
    typeof scripts.typecheck === "string" ? "npm run typecheck" : "",
    hasAny(files, ["vitest.config.ts", "vitest.config.js"]) ? "vitest" : "",
    hasAny(files, ["pytest.ini", "pyproject.toml"]) && hasDir(files, "tests")
      ? "python tests"
      : "",
    fileSet.has("Cargo.toml") ? "cargo test" : "",
    fileSet.has("go.mod") ? "go test" : "",
  ]);

  return {
    knownStacks,
    unsupportedSignals,
    artifactSignals,
    agentSurfaces,
    verificationSignals,
  };
}

export function formatWorkspaceProfileLines(profile: WorkspaceProfile): string[] {
  const lines: string[] = [];
  pushLine(lines, "known stacks", profile.knownStacks);
  pushLine(lines, "unsupported signals", profile.unsupportedSignals);
  pushLine(lines, "artifacts", profile.artifactSignals);
  pushLine(lines, "agent surfaces", profile.agentSurfaces);
  pushLine(lines, "verification", profile.verificationSignals);
  return lines.length > 0 ? lines : ["  no strong workspace signals detected"];
}

function pushLine(lines: string[], label: string, values: string[]): void {
  if (values.length === 0) return;
  lines.push(`  ${label}: ${values.join(", ")}`);
}

function walkFiles(root: string, limit: number): string[] {
  const files: string[] = [];
  const visit = (dir: string, relDir: string): void => {
    if (files.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  visit(root, "");
  return files;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function hasPyprojectDependency(root: string, name: string): boolean {
  const file = path.join(root, "pyproject.toml");
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, "utf8").toLowerCase().includes(name.toLowerCase());
}

function hasAny(files: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => files.includes(candidate));
}

function hasDir(files: string[], dir: string): boolean {
  return files.some((file) => file === dir || file.startsWith(`${dir}/`));
}

function hasExt(files: string[], ext: string): boolean {
  return files.some((file) => file.endsWith(ext));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
