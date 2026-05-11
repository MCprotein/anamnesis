import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { findFile as findFileEntry, type Manifest } from "./manifest.js";
import type { RenderAction } from "./render.js";
import { sha256 } from "../util/hash.js";

export type ProjectContextBootstrapOutcome =
  | "written"
  | "planned"
  | "skipped-existing"
  | "skipped-no-signals";

export interface ProjectContextBootstrapResult {
  path: "system_graph.yaml";
  outcome: ProjectContextBootstrapOutcome;
  writtenToDisk: boolean;
  signals: string[];
}

export type SurfaceConflictOutcome = "preserved" | "planned-preserve";

export interface SurfaceConflictResolution {
  path: string;
  preservedAs: string;
  outcome: SurfaceConflictOutcome;
  reason: string;
}

interface PackageInfo {
  name?: string;
  description?: string;
  type?: string;
  main?: string;
  dependencies: Record<string, unknown>;
  devDependencies: Record<string, unknown>;
}

const SYSTEM_GRAPH_PATH = "system_graph.yaml" as const;
const LOAD_CONTEXT_SKILL_PATH = ".claude/skills/load-context/SKILL.md";
const PROJECT_LOAD_CONTEXT_DIR = ".claude/skills/project-load-context";

const SECRET_PATH_PATTERNS = [
  /^\.env(?:\.|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)terraform\.tfvars$/,
  /(^|\/)terraform\.tfstate(?:\.backup)?$/,
  /\.pem$/,
  /(^|\/).+key$/,
  /(^|\/).+token$/,
  /(^|\/)logs?\//,
];

export function bootstrapProjectContext(opts: {
  projectRoot: string;
  dryRun: boolean;
}): ProjectContextBootstrapResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const rel = SYSTEM_GRAPH_PATH;
  const target = path.join(projectRoot, rel);
  if (fs.existsSync(target)) {
    return {
      path: rel,
      outcome: "skipped-existing",
      writtenToDisk: false,
      signals: [rel],
    };
  }

  const graph = buildSystemGraph(projectRoot);
  if (graph.signals.length === 0) {
    return {
      path: rel,
      outcome: "skipped-no-signals",
      writtenToDisk: false,
      signals: [],
    };
  }

  if (!opts.dryRun) {
    fs.writeFileSync(target, graph.yaml, "utf8");
  }
  return {
    path: rel,
    outcome: opts.dryRun ? "planned" : "written",
    writtenToDisk: !opts.dryRun,
    signals: graph.signals,
  };
}

export function resolveKnownSurfaceConflicts(opts: {
  projectRoot: string;
  manifest: Manifest;
  actions: readonly RenderAction[];
  dryRun: boolean;
}): SurfaceConflictResolution[] {
  const action = opts.actions.find(
    (candidate) =>
      candidate.kind === "file" && candidate.path === LOAD_CONTEXT_SKILL_PATH,
  );
  if (action === undefined || action.kind !== "file") return [];
  if (findFileEntry(opts.manifest, LOAD_CONTEXT_SKILL_PATH)) return [];

  const projectRoot = path.resolve(opts.projectRoot);
  const sourceFile = path.join(projectRoot, LOAD_CONTEXT_SKILL_PATH);
  if (!fs.existsSync(sourceFile)) return [];

  const current = fs.readFileSync(sourceFile, "utf8");
  if (sha256(current) === sha256(action.content)) return [];

  const sourceDir = path.dirname(sourceFile);
  const preservedRel = nextAvailableProjectSkillPath(projectRoot);
  const targetDir = path.join(projectRoot, preservedRel);
  const result: SurfaceConflictResolution = {
    path: LOAD_CONTEXT_SKILL_PATH,
    preservedAs: `${preservedRel}/SKILL.md`,
    outcome: opts.dryRun ? "planned-preserve" : "preserved",
    reason:
      "pre-existing project-specific load-context skill blocks the managed anamnesis load-context surface",
  };

  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(sourceDir, targetDir);
  }

  return [result];
}

function buildSystemGraph(projectRoot: string): { yaml: string; signals: string[] } {
  const packageInfo = readPackageJson(projectRoot);
  const dirs = commonDirs(projectRoot);
  const docs = docSignals(projectRoot);
  const deps = new Set([
    ...Object.keys(packageInfo?.dependencies ?? {}),
    ...Object.keys(packageInfo?.devDependencies ?? {}),
  ]);

  const signals: string[] = [];
  if (packageInfo) signals.push("package.json");
  signals.push(...dirs.map((dir) => `${dir}/`));
  signals.push(...docs.map((doc) => doc.path));

  const entities: Record<string, unknown[]> = {};
  const relationships: unknown[] = [];
  const flows: unknown[] = [];

  const runtime: Record<string, string> = {};
  if (packageInfo?.type === "module") runtime.module_system = "esm";
  if (typeof packageInfo?.main === "string") runtime.entrypoint = packageInfo.main;
  if (deps.has("typescript")) runtime.language = "typescript";

  const services: unknown[] = [];
  if (deps.has("@slack/bolt") || dirs.includes("src/slack")) {
    services.push({
      id: "slack-bot",
      kind: "service",
      paths: existingPaths(projectRoot, ["src/slack", "src/index.ts"]),
      role: "Slack event handling and user-facing conversation entrypoint",
    });
  }
  if (hasAnyPath(projectRoot, [
    "src/scripts/sync-notion.ts",
    "src/scripts/sync-confluence.ts",
    "src/scripts/sync-google-docs.ts",
  ])) {
    services.push({
      id: "sync-scripts",
      kind: "batch-jobs",
      paths: existingPaths(projectRoot, [
        "src/scripts/sync-notion.ts",
        "src/scripts/sync-confluence.ts",
        "src/scripts/sync-google-docs.ts",
      ]),
      role: "Document source synchronization into the retrieval store",
    });
  }
  if (services.length > 0) entities.services = services;

  const dataSources: unknown[] = [];
  if (deps.has("@notionhq/client") || dirs.includes("src/notion")) {
    dataSources.push({
      id: "notion",
      paths: existingPaths(projectRoot, ["src/notion"]),
      role: "Notion document source",
    });
  }
  if (dirs.includes("src/confluence")) {
    dataSources.push({
      id: "confluence",
      paths: existingPaths(projectRoot, ["src/confluence"]),
      role: "Confluence document source",
    });
  }
  if (deps.has("googleapis") || dirs.includes("src/google-docs")) {
    dataSources.push({
      id: "google-docs",
      paths: existingPaths(projectRoot, ["src/google-docs"]),
      role: "Google Drive / Google Docs document source",
    });
  }
  if (dataSources.length > 0) entities.data_sources = dataSources;

  const stores: unknown[] = [];
  if (deps.has("@supabase/supabase-js") || dirs.includes("supabase")) {
    stores.push({
      id: "supabase",
      kind: "database",
      paths: existingPaths(projectRoot, ["src/vectordb", "supabase/migrations"]),
      role: "PostgreSQL / pgvector-backed application data and retrieval store",
    });
  }
  if (stores.length > 0) entities.storage = stores;

  const ai: unknown[] = [];
  if (deps.has("@aws-sdk/client-bedrock-runtime") || dirs.includes("src/embedding")) {
    ai.push({
      id: "aws-bedrock",
      kind: "embedding-or-llm-provider",
      paths: existingPaths(projectRoot, ["src/embedding"]),
      role: "Embedding or model invocation through AWS Bedrock",
    });
  }
  if (deps.has("groq-sdk") || dirs.includes("src/llm")) {
    ai.push({
      id: "groq",
      kind: "llm-provider",
      paths: existingPaths(projectRoot, ["src/llm", "src/refine"]),
      role: "LLM classification, query expansion, answer generation, or refinement",
    });
  }
  if (deps.has("openai")) {
    ai.push({
      id: "openai",
      kind: "llm-provider",
      role: "OpenAI API integration",
    });
  }
  if (ai.length > 0) entities.ai_services = ai;

  if (dirs.includes("terraform") || fs.existsSync(path.join(projectRoot, "ecosystem.config.cjs"))) {
    entities.operations = [
      {
        id: "deployment",
        kind: "ops",
        paths: existingPaths(projectRoot, [
          "scripts/deploy.sh",
          "terraform",
          "ecosystem.config.cjs",
        ]),
        role: "Infrastructure and runtime process management",
      },
    ];
  }

  if (dataSources.length > 0 && stores.length > 0) {
    relationships.push({
      id: "source-sync-to-store",
      from: dataSources.map((entry) => (entry as { id: string }).id).join("|"),
      to: (stores[0] as { id: string }).id,
      path: "source APIs -> sync scripts -> chunking/embedding -> retrieval store",
      evidence: existingPaths(projectRoot, [
        "README.md",
        "docs/architecture.md",
        "docs/ontology.md",
      ]),
      confidence: "medium",
    });
    flows.push({
      id: "document-sync",
      name: "document sync",
      path: "source APIs -> sync scripts -> embeddings -> vector/search store",
      confidence: "medium",
    });
  }
  if (services.length > 0 && stores.length > 0) {
    relationships.push({
      id: "user-query-to-retrieval",
      from: "slack-bot",
      to: (stores[0] as { id: string }).id,
      path: "user message -> intent/search pipeline -> retrieval store -> answer",
      evidence: existingPaths(projectRoot, [
        "src/slack",
        "src/llm",
        "src/vectordb",
        "docs/search-strategies.md",
      ]),
      confidence: "medium",
    });
    flows.push({
      id: "user-query",
      name: "user query",
      path: "chat event -> classification/query expansion -> retrieval -> response",
      confidence: "medium",
    });
  }

  const graph = {
    schema_version: "anamnesis.system_graph.v1",
    generated_by: "anamnesis project context bootstrap",
    project: {
      name: packageInfo?.name ?? path.basename(projectRoot),
      ...(packageInfo?.description ? { purpose: packageInfo.description } : {}),
      ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
    },
    evidence_sources: signals,
    ...(Object.keys(entities).length > 0 ? { entities } : {}),
    ...(relationships.length > 0 ? { relationships } : {}),
    ...(flows.length > 0 ? { flows } : {}),
    invariants: [
      {
        id: "protect-secrets",
        severity: "must",
        rule:
          "Do not quote, expose, commit, or summarize secret values from .env files, Terraform tfvars/state, PEM keys, OAuth tokens, Slack tokens, Supabase keys, AWS credentials, or logs.",
      },
      {
        id: "verify-production-side-effects",
        severity: "must",
        rule:
          "Do not run production deploys, database migrations, remote SSH/SSM commands, or external-service writes without explicit user instruction.",
      },
    ],
    open_questions: [
      {
        id: "semantic-relationships-review",
        question:
          "Review this generated draft with /ontology-enrich when project-specific intent or operational constraints need stronger evidence.",
      },
    ],
  };

  return {
    yaml: stringifyYaml(graph, { lineWidth: 88 }),
    signals,
  };
}

function readPackageJson(projectRoot: string): PackageInfo | undefined {
  const filepath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(filepath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filepath, "utf8")) as Record<
      string,
      unknown
    >;
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      description:
        typeof parsed.description === "string" ? parsed.description : undefined,
      type: typeof parsed.type === "string" ? parsed.type : undefined,
      main: typeof parsed.main === "string" ? parsed.main : undefined,
      dependencies: isRecord(parsed.dependencies) ? parsed.dependencies : {},
      devDependencies: isRecord(parsed.devDependencies)
        ? parsed.devDependencies
        : {},
    };
  } catch {
    return undefined;
  }
}

function commonDirs(projectRoot: string): string[] {
  const candidates = [
    "src",
    "src/slack",
    "src/scripts",
    "src/notion",
    "src/confluence",
    "src/google-docs",
    "src/embedding",
    "src/llm",
    "src/refine",
    "src/vectordb",
    "supabase",
    "supabase/migrations",
    "terraform",
    "scripts",
    "docs",
  ];
  return candidates.filter((candidate) =>
    fs.existsSync(path.join(projectRoot, candidate)),
  );
}

function docSignals(projectRoot: string): Array<{ path: string }> {
  return [
    "README.md",
    "CLAUDE.md",
    "docs/architecture.md",
    "docs/ontology.md",
    "docs/search-strategies.md",
    "docs/infra.md",
  ].filter((candidate) => fs.existsSync(path.join(projectRoot, candidate)))
    .map((candidate) => ({ path: candidate }));
}

function existingPaths(projectRoot: string, rels: string[]): string[] {
  return rels.filter((rel) => {
    if (SECRET_PATH_PATTERNS.some((pattern) => pattern.test(rel))) return false;
    return fs.existsSync(path.join(projectRoot, rel));
  });
}

function hasAnyPath(projectRoot: string, rels: string[]): boolean {
  return rels.some((rel) => fs.existsSync(path.join(projectRoot, rel)));
}

function nextAvailableProjectSkillPath(projectRoot: string): string {
  const base = PROJECT_LOAD_CONTEXT_DIR;
  if (!fs.existsSync(path.join(projectRoot, base))) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(path.join(projectRoot, candidate))) return candidate;
  }
  throw new Error("could not find a free project-load-context skill path");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
