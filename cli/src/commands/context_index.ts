import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";

export const CONTEXT_INDEX_SCHEMA_VERSION = "anamnesis.context_index.v1";
export const CONTEXT_INDEX_PATH = ".anamnesis/context/index.jsonl";

export type ContextIndexKind =
  | "agent-rule"
  | "ontology-entity"
  | "ontology-relationship"
  | "ontology-rule"
  | "handoff-task"
  | "evidence-summary"
  | "manifest-entry"
  | "doc-section"
  | "task-harness";

export type ContextIndexFreshness = "current" | "stale" | "unknown";

export interface ContextIndexEntry {
  schema_version: typeof CONTEXT_INDEX_SCHEMA_VERSION;
  id: string;
  kind: ContextIndexKind;
  source_path: string;
  source_mtime: string;
  source_hash: string;
  scope_path: string;
  stable_ref: string;
  title: string;
  snippet: string;
  tags: string[];
  freshness: ContextIndexFreshness;
}

export interface ContextIndexSummary {
  entries: number;
  sources: number;
  byKind: Record<ContextIndexKind, number>;
  warnings: number;
}

export interface ContextIndexResult {
  schema_version: typeof CONTEXT_INDEX_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  indexPath: string;
  entries: ContextIndexEntry[];
  summary: ContextIndexSummary;
  warnings: string[];
  writtenPath?: string;
}

export interface ContextIndexOptions {
  projectRoot: string;
  write?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export interface ContextQueryMatch {
  entry: ContextIndexEntry;
  score: number;
}

export interface ContextQueryResult {
  schema_version: typeof CONTEXT_INDEX_SCHEMA_VERSION;
  projectRoot: string;
  indexPath: string;
  query: string;
  kind?: ContextIndexKind;
  matches: ContextQueryMatch[];
  summary: {
    entriesSearched: number;
    matches: number;
  };
}

export interface ContextQueryOptions {
  projectRoot: string;
  query: string;
  kind?: string;
  limit?: number;
  indexPath?: string;
}

export class ContextIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextIndexError";
  }
}

interface ContextSource {
  absPath: string;
  relPath: string;
  kind: "markdown" | "yaml" | "json" | "jsonl";
}

interface SourceContext {
  projectRoot: string;
  source: ContextSource;
  content: string;
  sourceMtime: string;
}

const DEFAULT_DOCS = [
  "README.md",
  "CHANGELOG.md",
  "docs/ROADMAP.md",
  "docs/DESIGN.md",
  "docs/ADAPTER-PARITY.md",
  "docs/AGENT-TASK-BENCHMARKS.md",
  "docs/BENCHMARKS.md",
  "docs/BENCHMARK-GALLERY.md",
  "docs/CONTEXT-INDEX-DESIGN.md",
] as const;

const CONTEXT_KINDS = new Set<ContextIndexKind>([
  "agent-rule",
  "ontology-entity",
  "ontology-relationship",
  "ontology-rule",
  "handoff-task",
  "evidence-summary",
  "manifest-entry",
  "doc-section",
  "task-harness",
]);

const CONTEXT_FRESHNESS = new Set<ContextIndexFreshness>([
  "current",
  "stale",
  "unknown",
]);

export function contextIndex(opts: ContextIndexOptions): ContextIndexResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const indexPath = opts.outputPath ?? CONTEXT_INDEX_PATH;
  const sources = discoverContextSources(projectRoot);
  const warnings: string[] = [];
  const entries = sources.flatMap((source) => {
    try {
      return entriesForSource(projectRoot, source);
    } catch (e) {
      warnings.push(`${source.relPath}: ${(e as Error).message}`);
      return [];
    }
  });
  const sortedEntries = dedupeEntries(entries).sort(compareEntries);
  const result: ContextIndexResult = {
    schema_version: CONTEXT_INDEX_SCHEMA_VERSION,
    projectRoot: ".",
    generatedAt,
    indexPath,
    entries: sortedEntries,
    warnings,
    summary: {
      entries: sortedEntries.length,
      sources: sources.length,
      byKind: countByKind(sortedEntries),
      warnings: warnings.length,
    },
  };

  if (opts.write === true) {
    const absPath = path.resolve(projectRoot, indexPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, renderJsonl(sortedEntries), "utf8");
    return {
      ...result,
      writtenPath: displayPathFromProject(projectRoot, absPath),
    };
  }

  return result;
}

export function contextQuery(opts: ContextQueryOptions): ContextQueryResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const query = opts.query.trim();
  if (query.length === 0) {
    throw new ContextIndexError("context query requires a non-empty query string");
  }
  const kind = normalizeKind(opts.kind);
  const indexPath = opts.indexPath ?? CONTEXT_INDEX_PATH;
  const entries = readContextIndex(projectRoot, indexPath).filter((entry) =>
    kind ? entry.kind === kind : true,
  );
  const terms = tokenize(query);
  const matches = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compareEntries(a.entry, b.entry);
    })
    .slice(0, opts.limit ?? 8);

  return {
    schema_version: CONTEXT_INDEX_SCHEMA_VERSION,
    projectRoot: ".",
    indexPath,
    query,
    ...(kind ? { kind } : {}),
    matches,
    summary: {
      entriesSearched: entries.length,
      matches: matches.length,
    },
  };
}

export function readContextIndex(
  projectRoot: string,
  indexPath = CONTEXT_INDEX_PATH,
): ContextIndexEntry[] {
  const absPath = path.resolve(projectRoot, indexPath);
  if (!fs.existsSync(absPath)) {
    throw new ContextIndexError(
      `context index not found at ${displayPathFromProject(projectRoot, absPath)} - run 'anamnesis context index --write' first`,
    );
  }
  const entries: ContextIndexEntry[] = [];
  for (const line of fs.readFileSync(absPath, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isContextIndexEntry(parsed)) {
        entries.push(parsed);
      }
    } catch {
      // Ignore malformed lines in the prototype; a diagnostic command can
      // report them later without blocking all local retrieval.
    }
  }
  return entries;
}

function discoverContextSources(projectRoot: string): ContextSource[] {
  const sources = new Map<string, ContextSource>();
  const add = (relPath: string): void => {
    const normalized = normalizeRelPath(relPath);
    if (shouldExcludePath(normalized)) return;
    const absPath = path.join(projectRoot, normalized);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return;
    sources.set(normalized, {
      absPath,
      relPath: normalized,
      kind: sourceKind(normalized),
    });
  };

  add("AGENTS.md");
  add("CLAUDE.md");
  add("system_graph.yaml");
  add(".anamnesis/manifest.json");
  add(".anamnesis/evidence/events.jsonl");
  for (const doc of DEFAULT_DOCS) add(doc);
  for (const relPath of walkFiles(projectRoot, ".anamnesis/ontology")) {
    if (relPath.endsWith(".yaml") || relPath.endsWith(".yml")) add(relPath);
  }
  for (const relPath of walkFiles(projectRoot, ".anamnesis/task-harnesses")) {
    if (relPath.endsWith(".yaml") || relPath.endsWith(".yml")) add(relPath);
  }

  const activeHandoff = ".anamnesis/handoff/active.md";
  add(activeHandoff);
  const activeAbs = path.join(projectRoot, activeHandoff);
  if (fs.existsSync(activeAbs)) {
    for (const archive of handoffArchiveRefs(
      fs.readFileSync(activeAbs, "utf8"),
    )) {
      add(archive);
    }
  }

  return [...sources.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function walkFiles(projectRoot: string, relDir: string): string[] {
  const absDir = path.join(projectRoot, relDir);
  if (!fs.existsSync(absDir)) return [];
  const result: string[] = [];
  const stack = [absDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      const relPath = displayPathFromProject(projectRoot, absPath);
      if (shouldExcludePath(relPath)) continue;
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        result.push(relPath);
      }
    }
  }
  return result.sort();
}

function entriesForSource(
  projectRoot: string,
  source: ContextSource,
): ContextIndexEntry[] {
  const content = fs.readFileSync(source.absPath, "utf8");
  const stat = fs.statSync(source.absPath);
  const ctx: SourceContext = {
    projectRoot,
    source,
    content,
    sourceMtime: stat.mtime.toISOString(),
  };
  if (source.kind === "markdown") return markdownEntries(ctx);
  if (source.kind === "yaml") return yamlEntries(ctx);
  if (source.kind === "json") return jsonEntries(ctx);
  return jsonlEntries(ctx);
}

function markdownEntries(ctx: SourceContext): ContextIndexEntry[] {
  const lines = ctx.content.split(/\r?\n/);
  const headings: { level: number; title: string; line: number }[] = [];
  lines.forEach((line, idx) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      headings.push({
        level: match[1]!.length,
        title: match[2]!.trim(),
        line: idx,
      });
    }
  });
  if (headings.length === 0) {
    return [
      makeEntry(ctx, {
        kind: markdownKind(ctx.source.relPath),
        stableRef: "file",
        title: path.basename(ctx.source.relPath),
        snippet: snippetFromLines(lines),
        tags: tagsForSource(ctx.source.relPath),
      }),
    ];
  }

  const slugCounts = new Map<string, number>();
  return headings.map((heading, index) => {
    const endLine = headings[index + 1]?.line ?? lines.length;
    const body = lines.slice(heading.line + 1, endLine);
    const slug = slugify(heading.title);
    const occurrence = (slugCounts.get(slug) ?? 0) + 1;
    slugCounts.set(slug, occurrence);
    const stableRef =
      occurrence === 1 ? `heading:${slug}` : `heading:${slug}:${occurrence}`;
    return makeEntry(ctx, {
      kind: markdownKind(ctx.source.relPath),
      stableRef,
      title: heading.title,
      snippet: snippetFromLines(body) || heading.title,
      tags: [...tagsForSource(ctx.source.relPath), `h${heading.level}`, slug],
    });
  });
}

function yamlEntries(ctx: SourceContext): ContextIndexEntry[] {
  const parsed = YAML.parse(ctx.content) as unknown;
  if (ctx.source.relPath.startsWith(".anamnesis/task-harnesses/")) {
    return taskHarnessEntries(ctx, parsed);
  }
  const entries: ContextIndexEntry[] = [];
  collectStructuredEntries(ctx, parsed, [], entries);
  if (entries.length === 0) {
    entries.push(
      makeEntry(ctx, {
        kind: ctx.source.relPath === "system_graph.yaml"
          ? "ontology-entity"
          : "ontology-rule",
        stableRef: "file",
        title: path.basename(ctx.source.relPath),
        snippet: snippetFromLines(ctx.content.split(/\r?\n/)),
        tags: tagsForSource(ctx.source.relPath),
      }),
    );
  }
  return entries;
}

function taskHarnessEntries(
  ctx: SourceContext,
  parsed: unknown,
): ContextIndexEntry[] {
  if (!isObject(parsed)) {
    return [
      makeEntry(ctx, {
        kind: "task-harness",
        stableRef: "file",
        title: path.basename(ctx.source.relPath),
        snippet: snippetFromLines(ctx.content.split(/\r?\n/)),
        tags: tagsForSource(ctx.source.relPath),
      }),
    ];
  }

  const id =
    stringField(parsed, "id") ??
    path.basename(ctx.source.relPath).replace(/\.(ya?ml)$/i, "");
  const lifecycle = objectField(parsed, "lifecycle");
  const lifecycleKind = lifecycle ? stringField(lifecycle, "kind") : undefined;
  const requiredEvidence = Array.isArray(parsed.required_evidence)
    ? parsed.required_evidence.length
    : 0;
  const testCommands = Array.isArray(parsed.test_commands)
    ? parsed.test_commands.length
    : 0;
  const snippet = [
    stringField(parsed, "goal"),
    stringField(parsed, "stop_condition"),
    requiredEvidence > 0 ? `required_evidence=${requiredEvidence}` : undefined,
    testCommands > 0 ? `test_commands=${testCommands}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");

  return [
    makeEntry(ctx, {
      kind: "task-harness",
      stableRef: `harness:${id}`,
      title: stringField(parsed, "title") ?? stringField(parsed, "name") ?? id,
      snippet:
        snippet.length > 0
          ? snippet
          : snippetFromLines(ctx.content.split(/\r?\n/)),
      tags: [
        ...tagsForSource(ctx.source.relPath),
        "task-harness",
        id,
        ...(lifecycleKind ? [lifecycleKind] : []),
      ],
    }),
  ];
}

function jsonEntries(ctx: SourceContext): ContextIndexEntry[] {
  const parsed = JSON.parse(ctx.content) as unknown;
  if (ctx.source.relPath.endsWith(".anamnesis/manifest.json")) {
    return manifestEntries(ctx, parsed);
  }
  return [
    makeEntry(ctx, {
      kind: "doc-section",
      stableRef: "file",
      title: path.basename(ctx.source.relPath),
      snippet: snippetFromLines(ctx.content.split(/\r?\n/)),
      tags: tagsForSource(ctx.source.relPath),
    }),
  ];
}

function jsonlEntries(ctx: SourceContext): ContextIndexEntry[] {
  if (!ctx.source.relPath.endsWith(".anamnesis/evidence/events.jsonl")) {
    return [];
  }
  const valid: unknown[] = [];
  let invalid = 0;
  for (const line of ctx.content.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      valid.push(JSON.parse(line) as unknown);
    } catch {
      invalid++;
    }
  }
  const byKind = new Map<string, number>();
  let latest = "";
  for (const item of valid) {
    if (!isObject(item)) continue;
    const kind = stringField(item, "kind");
    if (kind) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    const generatedAt = stringField(item, "generated_at");
    if (generatedAt && generatedAt >= latest) latest = generatedAt;
  }
  const summary = [
    `${valid.length} valid evidence record(s)`,
    invalid > 0 ? `${invalid} invalid line(s)` : "0 invalid lines",
    latest ? `latest ${latest}` : "no latest record",
    ...[...byKind.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => `${kind}=${count}`),
  ].join("; ");
  return [
    makeEntry(ctx, {
      kind: "evidence-summary",
      stableRef: "summary",
      title: "Runtime evidence summary",
      snippet: summary,
      tags: ["evidence", "runtime"],
    }),
  ];
}

function manifestEntries(ctx: SourceContext, parsed: unknown): ContextIndexEntry[] {
  if (!isObject(parsed)) return [];
  const entries: ContextIndexEntry[] = [];
  const regions = Array.isArray(parsed.regions) ? parsed.regions : [];
  for (const region of regions) {
    if (!isObject(region)) continue;
    const file = stringField(region, "file");
    const regionId = stringField(region, "region_id");
    if (!file || !regionId) continue;
    entries.push(
      makeEntry(ctx, {
        kind: "manifest-entry",
        stableRef: `regions[${regionId}]`,
        title: `Managed region ${regionId}`,
        snippet: `${file} region ${regionId} from fragment ${stringField(region, "fragment_id") ?? "unknown"}`,
        tags: ["manifest", "region", regionId, file],
      }),
    );
  }
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  for (const fileEntry of files) {
    if (!isObject(fileEntry)) continue;
    const filePath = stringField(fileEntry, "path");
    if (!filePath) continue;
    entries.push(
      makeEntry(ctx, {
        kind: "manifest-entry",
        stableRef: `files[${filePath}]`,
        title: `Managed file ${filePath}`,
        snippet: `${filePath} from fragment ${stringField(fileEntry, "fragment_id") ?? "unknown"}`,
        tags: ["manifest", "file", filePath],
      }),
    );
  }
  return entries;
}

function collectStructuredEntries(
  ctx: SourceContext,
  value: unknown,
  pointer: string[],
  entries: ContextIndexEntry[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isObject(item) && stringField(item, "id")) {
        const id = stringField(item, "id")!;
        const stableRef = `${pointer.join(".") || "items"}[${id}]`;
        const kind = kindForYamlPointer(pointer, item);
        entries.push(
          makeEntry(ctx, {
            kind,
            stableRef,
            title: titleFromObject(item, id),
            snippet: snippetFromValue(item),
            tags: [...tagsForSource(ctx.source.relPath), ...pointer, id],
          }),
        );
      }
      collectStructuredEntries(ctx, item, [...pointer, String(index)], entries);
    });
    return;
  }
  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (shouldIndexYamlObject(pointer, key, child)) {
      const childObject = child as Record<string, unknown>;
      const stableRef = [...pointer, key].join(".");
      const kind = kindForYamlPointer([...pointer, key], childObject);
      entries.push(
        makeEntry(ctx, {
          kind,
          stableRef,
          title: titleFromObject(childObject, key),
          snippet: snippetFromValue(childObject),
          tags: [...tagsForSource(ctx.source.relPath), ...pointer, key],
        }),
      );
    }
    collectStructuredEntries(ctx, child, [...pointer, key], entries);
  }
}

function shouldIndexYamlObject(
  pointer: readonly string[],
  key: string,
  value: unknown,
): boolean {
  if (!isObject(value)) return false;
  if (stringField(value, "id") || stringField(value, "name")) return true;
  if (pointer.length === 0) return key !== "schema_version" && key !== "managed_by";
  return false;
}

function kindForYamlPointer(
  pointer: readonly string[],
  value: Record<string, unknown>,
): ContextIndexKind {
  const joined = pointer.join(".").toLowerCase();
  if (
    joined.includes("relationship") ||
    joined.includes("flow") ||
    stringField(value, "from") ||
    stringField(value, "to")
  ) {
    return "ontology-relationship";
  }
  if (
    joined.includes("rule") ||
    joined.includes("invariant") ||
    joined.includes("operational_note") ||
    joined.includes("note") ||
    stringField(value, "rule") ||
    stringField(value, "question")
  ) {
    return "ontology-rule";
  }
  return "ontology-entity";
}

function makeEntry(
  ctx: SourceContext,
  fields: {
    kind: ContextIndexKind;
    stableRef: string;
    title: string;
    snippet: string;
    tags: string[];
  },
): ContextIndexEntry {
  const scopePath = scopePathForSource(ctx.source.relPath);
  const sliceHash = hashString(
    `${ctx.source.relPath}\n${fields.stableRef}\n${fields.title}\n${fields.snippet}`,
  );
  return {
    schema_version: CONTEXT_INDEX_SCHEMA_VERSION,
    id: stableEntryId(fields.kind, ctx.source.relPath, fields.stableRef),
    kind: fields.kind,
    source_path: ctx.source.relPath,
    source_mtime: ctx.sourceMtime,
    source_hash: sliceHash,
    scope_path: scopePath,
    stable_ref: fields.stableRef,
    title: cleanText(fields.title, 96),
    snippet: cleanText(fields.snippet, 240),
    tags: uniqueStrings(fields.tags.map(slugify).filter(Boolean)).slice(0, 12),
    freshness: freshnessForSource(ctx),
  };
}

function handoffArchiveRefs(content: string): string[] {
  const refs = new Set<string>();
  const archiveRegex = /archive:\s*`?([^`\s)]+\.md)`?/g;
  let match: RegExpExecArray | null;
  while ((match = archiveRegex.exec(content)) !== null) {
    const candidate = normalizeRelPath(match[1]!);
    if (candidate.startsWith(".anamnesis/handoff/")) refs.add(candidate);
  }
  return [...refs].sort();
}

function markdownKind(relPath: string): ContextIndexKind {
  if (relPath === "AGENTS.md" || relPath === "CLAUDE.md") return "agent-rule";
  if (relPath.startsWith(".anamnesis/handoff/")) return "handoff-task";
  return "doc-section";
}

function sourceKind(relPath: string): ContextSource["kind"] {
  if (relPath.endsWith(".yaml") || relPath.endsWith(".yml")) return "yaml";
  if (relPath.endsWith(".jsonl")) return "jsonl";
  if (relPath.endsWith(".json")) return "json";
  return "markdown";
}

function shouldExcludePath(relPath: string): boolean {
  const parts = relPath.split("/");
  if (
    parts.includes("node_modules") ||
    parts.includes(".git") ||
    parts.includes("dist") ||
    parts.includes("build") ||
    parts.includes(".next") ||
    parts.includes(".venv") ||
    parts.includes("venv") ||
    parts.includes("__pycache__") ||
    relPath.startsWith(".anamnesis/backups/") ||
    relPath.startsWith(".anamnesis/overrides/")
  ) {
    return true;
  }
  const name = parts.at(-1) ?? relPath;
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".tfstate") ||
    name.endsWith(".tfstate.backup") ||
    name.endsWith(".log")
  );
}

function isContextIndexEntry(value: unknown): value is ContextIndexEntry {
  if (!isObject(value)) return false;
  return (
    value.schema_version === CONTEXT_INDEX_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    CONTEXT_KINDS.has(value.kind as ContextIndexKind) &&
    typeof value.source_path === "string" &&
    typeof value.source_mtime === "string" &&
    typeof value.source_hash === "string" &&
    typeof value.scope_path === "string" &&
    typeof value.stable_ref === "string" &&
    typeof value.title === "string" &&
    typeof value.snippet === "string" &&
    CONTEXT_FRESHNESS.has(value.freshness as ContextIndexFreshness) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string")
  );
}

function renderJsonl(entries: readonly ContextIndexEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function countByKind(
  entries: readonly ContextIndexEntry[],
): Record<ContextIndexKind, number> {
  const counts = Object.fromEntries(
    [...CONTEXT_KINDS].map((kind) => [kind, 0]),
  ) as Record<ContextIndexKind, number>;
  for (const entry of entries) counts[entry.kind]++;
  return counts;
}

function scoreEntry(entry: ContextIndexEntry, terms: readonly string[]): number {
  const title = searchable(entry.title);
  const tags = searchable(entry.tags.join(" "));
  const snippet = searchable(entry.snippet);
  const source = searchable(`${entry.source_path} ${entry.stable_ref}`);
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 6;
    if (tags.includes(term)) score += 4;
    if (snippet.includes(term)) score += 3;
    if (source.includes(term)) score += 2;
  }
  return score;
}

function normalizeKind(kind: string | undefined): ContextIndexKind | undefined {
  if (kind === undefined) return undefined;
  if (CONTEXT_KINDS.has(kind as ContextIndexKind)) return kind as ContextIndexKind;
  throw new ContextIndexError(
    `unknown context kind '${kind}'. Expected one of: ${[...CONTEXT_KINDS].sort().join(", ")}`,
  );
}

function tokenize(input: string): string[] {
  return uniqueStrings(
    searchable(input)
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0),
  );
}

function searchable(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9가-힣_.:/-]+/g, " ");
}

function snippetFromLines(lines: readonly string[]): string {
  const clean = lines
    .filter((line) => !line.trim().startsWith("```"))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 4)
    .join(" ");
  return cleanText(clean, 240);
}

function snippetFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (isObject(value)) {
    const candidates = [
      stringField(value, "rule"),
      stringField(value, "reason"),
      stringField(value, "description"),
      stringField(value, "question"),
      stringField(value, "path"),
      stringField(value, "source"),
    ].filter((item): item is string => item !== undefined);
    if (candidates.length > 0) return candidates.join(" ");
  }
  return JSON.stringify(value);
}

function titleFromObject(value: Record<string, unknown>, fallback: string): string {
  return (
    stringField(value, "title") ??
    stringField(value, "name") ??
    stringField(value, "id") ??
    stringField(value, "rule") ??
    fallback
  );
}

function tagsForSource(relPath: string): string[] {
  const tags = relPath
    .split(/[/.]+/)
    .map(slugify)
    .filter((tag) => tag.length > 0);
  if (relPath.startsWith(".anamnesis/ontology/")) tags.push("ontology");
  if (relPath.startsWith(".anamnesis/handoff/")) tags.push("handoff");
  if (relPath.startsWith(".anamnesis/task-harnesses/")) {
    tags.push("task-harness");
  }
  if (relPath.startsWith("docs/")) tags.push("docs");
  return uniqueStrings(tags);
}

function scopePathForSource(relPath: string): string {
  const marker = "/.anamnesis/";
  const idx = relPath.indexOf(marker);
  if (idx < 0) return ".";
  return relPath.slice(0, idx) || ".";
}

function freshnessForSource(ctx: SourceContext): ContextIndexFreshness {
  if (ctx.source.relPath === ".anamnesis/handoff/active.md") {
    const missing = handoffArchiveRefs(ctx.content).filter(
      (archive) => !fs.existsSync(path.join(ctx.projectRoot, archive)),
    );
    return missing.length > 0 ? "stale" : "current";
  }
  return "current";
}

function stableEntryId(
  kind: ContextIndexKind,
  relPath: string,
  stableRef: string,
): string {
  const readable = `${kind}:${slugify(relPath.replace(/\.[^.]+$/, ""))}:${slugify(stableRef)}`;
  if (readable.length <= 120) return readable;
  return `${kind}:${shortHash(`${relPath}:${stableRef}`)}`;
}

function dedupeEntries(entries: readonly ContextIndexEntry[]): ContextIndexEntry[] {
  const byId = new Map<string, ContextIndexEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing || compareEntries(entry, existing) < 0) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

function compareEntries(a: ContextIndexEntry, b: ContextIndexEntry): number {
  return (
    a.source_path.localeCompare(b.source_path) ||
    a.kind.localeCompare(b.kind) ||
    a.stable_ref.localeCompare(b.stable_ref) ||
    a.id.localeCompare(b.id)
  );
}

function cleanText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}

function hashString(content: string): string {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function shortHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const field = value[key];
  return isObject(field) ? field : undefined;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}
