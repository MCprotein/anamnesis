import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";

export const CONTEXT_DOCS_SCHEMA_VERSION = "anamnesis.context_docs.v1";

export type DocumentLinkKind = "internal" | "external" | "anchor";
export type DocumentLinkStatus = "ok" | "missing" | "missing-anchor" | "external";

export interface DocumentGraphPage {
  source_path: string;
  title: string;
  canonical: boolean;
  source_hash: string;
  heading_count: number;
  outbound_links: number;
  inbound_links: number;
  ontology_refs: number;
}

export interface DocumentGraphHeading {
  source_path: string;
  stable_ref: string;
  line: number;
  depth: number;
  title: string;
  slug: string;
}

export interface DocumentGraphLink {
  source_path: string;
  stable_ref: string;
  line: number;
  text: string;
  target: string;
  kind: DocumentLinkKind;
  status: DocumentLinkStatus;
  resolved_path?: string;
  resolved_ref?: string;
}

export interface DocumentGraphBacklink {
  target_path: string;
  source_path: string;
  source_ref: string;
  line: number;
}

export interface DocumentGraphOntologyRef {
  source_path: string;
  stable_ref: string;
  line: number;
  target: string;
  status: "ok" | "missing";
}

export interface ContextDocsCatalog {
  path?: string;
  roots: string[];
  excludes: string[];
  canonical: string[];
  ontology_reference_prefixes: string[];
}

export interface ContextDocsSummary {
  pages: number;
  canonicalPages: number;
  headings: number;
  links: number;
  internalLinks: number;
  externalLinks: number;
  brokenLinks: number;
  backlinks: number;
  ontologyRefs: number;
  missingOntologyRefs: number;
  warnings: number;
}

export interface ContextDocsResult {
  schema_version: typeof CONTEXT_DOCS_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  catalog: ContextDocsCatalog;
  pages: DocumentGraphPage[];
  headings: DocumentGraphHeading[];
  links: DocumentGraphLink[];
  backlinks: DocumentGraphBacklink[];
  ontology_refs: DocumentGraphOntologyRef[];
  warnings: string[];
  summary: ContextDocsSummary;
}

export interface ContextDocsOptions {
  projectRoot: string;
  catalogPath?: string;
  now?: () => Date;
}

interface MarkdownSource {
  relPath: string;
  absPath: string;
  content: string;
}

interface PageParseResult {
  page: Omit<DocumentGraphPage, "outbound_links" | "inbound_links" | "ontology_refs">;
  headings: DocumentGraphHeading[];
  headingSlugs: Set<string>;
  ontologyRefs: DocumentGraphOntologyRef[];
}

const DEFAULT_ROOTS = ["README.md", "docs", "specs"] as const;
const DEFAULT_EXCLUDES = [
  "docs/deprecated",
  "docs/benchmark-evidence",
] as const;
const DEFAULT_CANONICAL = ["README.md"] as const;
const DEFAULT_ONTOLOGY_REFERENCE_PREFIXES = [
  "system_graph.yaml",
  ".anamnesis/ontology/",
] as const;

export function contextDocs(opts: ContextDocsOptions): ContextDocsResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const warnings: string[] = [];
  const catalog = loadCatalog(projectRoot, opts.catalogPath, warnings);
  const sources = discoverMarkdownSources(projectRoot, catalog);

  const parsed = sources.map((source) =>
    parseMarkdownSource(projectRoot, source, catalog),
  );
  const headingSlugsByPath = new Map(
    parsed.map((item) => [item.page.source_path, item.headingSlugs]),
  );
  const pagePaths = new Set(parsed.map((item) => item.page.source_path));
  const links = sources.flatMap((source) =>
    markdownLinks(projectRoot, source, pagePaths, headingSlugsByPath),
  );
  const ontologyRefs = dedupeOntologyRefs([
    ...parsed.flatMap((item) => item.ontologyRefs),
    ...links.flatMap((link) =>
      ontologyRefsFromLink(
        projectRoot,
        link,
        catalog.ontology_reference_prefixes,
      ),
    ),
  ]);
  const backlinks = backlinksForLinks(links);
  const pages = parsed.map((item) => {
    const sourcePath = item.page.source_path;
    return {
      ...item.page,
      outbound_links: links.filter((link) => link.source_path === sourcePath).length,
      inbound_links: backlinks.filter((link) => link.target_path === sourcePath).length,
      ontology_refs: ontologyRefs.filter((ref) => ref.source_path === sourcePath).length,
    };
  });
  const headings = parsed.flatMap((item) => item.headings);

  return {
    schema_version: CONTEXT_DOCS_SCHEMA_VERSION,
    projectRoot: ".",
    generatedAt,
    catalog,
    pages: pages.sort(comparePages),
    headings: headings.sort(compareHeadings),
    links: links.sort(compareLinks),
    backlinks: backlinks.sort(compareBacklinks),
    ontology_refs: ontologyRefs.sort(compareOntologyRefs),
    warnings,
    summary: summarize({
      pages,
      headings,
      links,
      backlinks,
      ontologyRefs,
      warnings,
    }),
  };
}

function loadCatalog(
  projectRoot: string,
  catalogPath: string | undefined,
  warnings: string[],
): ContextDocsCatalog {
  const relPath = normalizeRelPath(catalogPath ?? ".anamnesis/docs/catalog.yaml");
  const absPath = path.join(projectRoot, relPath);
  const roots: string[] = [...DEFAULT_ROOTS];
  const excludes: string[] = [...DEFAULT_EXCLUDES];
  const canonical: string[] = [...DEFAULT_CANONICAL];
  const ontologyReferencePrefixes: string[] = [
    ...DEFAULT_ONTOLOGY_REFERENCE_PREFIXES,
  ];

  if (!fs.existsSync(absPath)) {
    return {
      roots: uniqueStrings(roots),
      excludes: uniqueStrings(excludes),
      canonical: uniqueStrings(canonical),
      ontology_reference_prefixes: uniqueStrings(ontologyReferencePrefixes),
    };
  }

  try {
    const parsed = YAML.parse(fs.readFileSync(absPath, "utf8")) as unknown;
    if (isObject(parsed)) {
      roots.push(...stringArrayField(parsed, "roots"));
      excludes.push(...stringArrayField(parsed, "excludes"));
      canonical.push(
        ...stringArrayField(parsed, "canonical"),
        ...stringArrayField(parsed, "canonical_docs"),
      );
      ontologyReferencePrefixes.push(
        ...stringArrayField(parsed, "ontology_reference_prefixes"),
        ...stringArrayField(parsed, "allowed_ontology_reference_prefixes"),
      );
    }
  } catch (e) {
    warnings.push(`${relPath}: ${(e as Error).message}`);
  }

  return {
    path: relPath,
    roots: uniqueStrings(roots.map(normalizeRelPath)),
    excludes: uniqueStrings(excludes.map(normalizeRelPath)),
    canonical: uniqueStrings(canonical.map(normalizeRelPath)),
    ontology_reference_prefixes: normalizeOntologyReferencePrefixes(
      ontologyReferencePrefixes,
      relPath,
      warnings,
    ),
  };
}

function discoverMarkdownSources(
  projectRoot: string,
  catalog: ContextDocsCatalog,
): MarkdownSource[] {
  const sources = new Map<string, MarkdownSource>();
  const add = (relPath: string): void => {
    const normalized = normalizeRelPath(relPath);
    if (!normalized.endsWith(".md")) return;
    if (shouldExcludeDocumentPath(normalized, catalog.excludes)) return;
    const absPath = path.join(projectRoot, normalized);
    if (!safeProjectFileExists(projectRoot, normalized)) return;
    if (!fs.statSync(absPath).isFile()) return;
    sources.set(normalized, {
      relPath: normalized,
      absPath,
      content: fs.readFileSync(absPath, "utf8"),
    });
  };

  for (const root of catalog.roots) {
    const absRoot = path.join(projectRoot, root);
    if (!fs.existsSync(absRoot)) continue;
    const stat = fs.statSync(absRoot);
    if (stat.isFile()) {
      add(root);
    } else if (stat.isDirectory()) {
      for (const relPath of walkFiles(projectRoot, root)) add(relPath);
    }
  }

  return [...sources.values()].sort((a, b) => compareRelPaths(a.relPath, b.relPath));
}

function parseMarkdownSource(
  projectRoot: string,
  source: MarkdownSource,
  catalog: ContextDocsCatalog,
): PageParseResult {
  const lines = source.content.split(/\r?\n/);
  const headings: DocumentGraphHeading[] = [];
  const headingSlugs = new Set<string>();
  const slugCounts = new Map<string, number>();
  const ontologyRefs: DocumentGraphOntologyRef[] = [];
  let inFence = false;

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const heading = parseHeading(line);
    if (heading) {
      const slug = slugify(heading.title);
      const occurrence = (slugCounts.get(slug) ?? 0) + 1;
      slugCounts.set(slug, occurrence);
      const stableRef =
        occurrence === 1 ? `heading:${slug}` : `heading:${slug}:${occurrence}`;
      headingSlugs.add(slug);
      headings.push({
        source_path: source.relPath,
        stable_ref: stableRef,
        line: index + 1,
        depth: heading.depth,
        title: heading.title,
        slug,
      });
    }

    ontologyRefs.push(
      ...ontologyRefsFromLine(
        projectRoot,
        source.relPath,
        line,
        index + 1,
        catalog.ontology_reference_prefixes,
      ),
    );
  });

  const title =
    headings.find((heading) => heading.depth === 1)?.title ??
    headings[0]?.title ??
    path.basename(source.relPath);

  return {
    page: {
      source_path: source.relPath,
      title,
      canonical: catalog.canonical.includes(source.relPath),
      source_hash: hashString(source.content),
      heading_count: headings.length,
    },
    headings,
    headingSlugs,
    ontologyRefs,
  };
}

function markdownLinks(
  projectRoot: string,
  source: MarkdownSource,
  pagePaths: ReadonlySet<string>,
  headingSlugsByPath: ReadonlyMap<string, ReadonlySet<string>>,
): DocumentGraphLink[] {
  const links: DocumentGraphLink[] = [];
  const lines = source.content.split(/\r?\n/);
  let inFence = false;

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    for (const target of extractMarkdownTargets(line)) {
      links.push(
        resolveLink({
          projectRoot,
          sourcePath: source.relPath,
          line: index + 1,
          text: target.text,
          target: target.target,
          pagePaths,
          headingSlugsByPath,
        }),
      );
    }
  });

  return links;
}

function resolveLink(input: {
  projectRoot: string;
  sourcePath: string;
  line: number;
  text: string;
  target: string;
  pagePaths: ReadonlySet<string>;
  headingSlugsByPath: ReadonlyMap<string, ReadonlySet<string>>;
}): DocumentGraphLink {
  const target = stripMarkdownTarget(input.target);
  const stableRef = `line:${input.line}:link:${shortHash(target)}`;

  if (isExternalTarget(target)) {
    return {
      source_path: input.sourcePath,
      stable_ref: stableRef,
      line: input.line,
      text: cleanText(input.text, 96),
      target,
      kind: "external",
      status: "external",
    };
  }

  const [rawPath = "", rawAnchor = ""] = target.split("#", 2);
  const anchor = normalizeAnchor(rawAnchor);
  if (rawPath === "") {
    const status =
      anchor === "" || input.headingSlugsByPath.get(input.sourcePath)?.has(anchor)
        ? "ok"
        : "missing-anchor";
    return {
      source_path: input.sourcePath,
      stable_ref: stableRef,
      line: input.line,
      text: cleanText(input.text, 96),
      target,
      kind: "anchor",
      status,
      resolved_path: input.sourcePath,
      ...(anchor ? { resolved_ref: `heading:${anchor}` } : {}),
    };
  }

  const resolvedPath = resolveLocalPath(input.sourcePath, rawPath);
  const exists = safeProjectFileExists(input.projectRoot, resolvedPath);
  const resolvedMarkdownPath = resolveMarkdownPagePath(input.projectRoot, resolvedPath);
  const targetHeadings = resolvedMarkdownPath
    ? input.headingSlugsByPath.get(resolvedMarkdownPath)
    : undefined;
  const anchorMissing =
    exists &&
    anchor !== "" &&
    resolvedMarkdownPath !== undefined &&
    targetHeadings !== undefined &&
    !targetHeadings.has(anchor);
  const status: DocumentLinkStatus = !exists
    ? "missing"
    : anchorMissing
      ? "missing-anchor"
      : "ok";

  return {
    source_path: input.sourcePath,
    stable_ref: stableRef,
    line: input.line,
    text: cleanText(input.text, 96),
    target,
    kind: "internal",
    status,
    resolved_path: resolvedMarkdownPath ?? resolvedPath,
    ...(anchor ? { resolved_ref: `heading:${anchor}` } : {}),
  };
}

function backlinksForLinks(links: readonly DocumentGraphLink[]): DocumentGraphBacklink[] {
  const backlinks = new Map<string, DocumentGraphBacklink>();
  for (const link of links) {
    if (
      link.kind !== "internal" ||
      link.status !== "ok" ||
      link.resolved_path === undefined ||
      !link.resolved_path.endsWith(".md")
    ) {
      continue;
    }
    const key = `${link.resolved_path}:${link.source_path}:${link.line}:${link.stable_ref}`;
    backlinks.set(key, {
      target_path: link.resolved_path,
      source_path: link.source_path,
      source_ref: link.stable_ref,
      line: link.line,
    });
  }
  return [...backlinks.values()];
}

function ontologyRefsFromLine(
  projectRoot: string,
  sourcePath: string,
  line: string,
  lineNumber: number,
  allowedPrefixes: readonly string[],
): DocumentGraphOntologyRef[] {
  const refs = new Map<string, DocumentGraphOntologyRef>();
  if (isExampleOnlyOntologyLine(line)) return [];
  const regex = /(?:^|[`\s([<])((?:\.{0,2}\/)*[A-Za-z0-9._/-]+\.ya?ml)(?=$|[`)\]>\s.,;:])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const target = normalizeOntologyTarget(
      sourcePath,
      match[1]!,
      allowedPrefixes,
    );
    if (!target) continue;
    refs.set(target, {
      source_path: sourcePath,
      stable_ref: `line:${lineNumber}:ontology:${shortHash(target)}`,
      line: lineNumber,
      target,
      status: safeProjectFileExists(projectRoot, target) ? "ok" : "missing",
    });
  }
  return [...refs.values()];
}

function isExampleOnlyOntologyLine(line: string): boolean {
  const trimmed = line.trim();
  return /^`?(?:\.anamnesis\/ontology\/[A-Za-z0-9._/-]+\.ya?ml|system_graph\.yaml)`?:$/.test(
    trimmed,
  );
}

function ontologyRefsFromLink(
  projectRoot: string,
  link: DocumentGraphLink,
  allowedPrefixes: readonly string[],
): DocumentGraphOntologyRef[] {
  const target = link.resolved_path;
  if (!target || !ontologyTargetAllowed(target, allowedPrefixes)) {
    return [];
  }
  return [
    {
      source_path: link.source_path,
      stable_ref: `line:${link.line}:ontology:${shortHash(target)}`,
      line: link.line,
      target,
      status: safeProjectFileExists(projectRoot, target) ? "ok" : "missing",
    },
  ];
}

function summarize(input: {
  pages: readonly DocumentGraphPage[];
  headings: readonly DocumentGraphHeading[];
  links: readonly DocumentGraphLink[];
  backlinks: readonly DocumentGraphBacklink[];
  ontologyRefs: readonly DocumentGraphOntologyRef[];
  warnings: readonly string[];
}): ContextDocsSummary {
  return {
    pages: input.pages.length,
    canonicalPages: input.pages.filter((page) => page.canonical).length,
    headings: input.headings.length,
    links: input.links.length,
    internalLinks: input.links.filter((link) => link.kind !== "external").length,
    externalLinks: input.links.filter((link) => link.kind === "external").length,
    brokenLinks: input.links.filter(
      (link) => link.status === "missing" || link.status === "missing-anchor",
    ).length,
    backlinks: input.backlinks.length,
    ontologyRefs: input.ontologyRefs.length,
    missingOntologyRefs: input.ontologyRefs.filter((ref) => ref.status === "missing").length,
    warnings: input.warnings.length,
  };
}

function parseHeading(line: string): { depth: number; title: string } | undefined {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!match) return undefined;
  return {
    depth: match[1]!.length,
    title: match[2]!.trim(),
  };
}

function extractMarkdownTargets(line: string): { text: string; target: string }[] {
  const targets: { text: string; target: string }[] = [];
  const inline = /!?\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inline.exec(line)) !== null) {
    targets.push({
      text: inlineMatch[1] ?? "",
      target: inlineMatch[2] ?? "",
    });
  }

  const reference = /^\s*\[[^\]\n]+\]:\s+(\S+)/.exec(line);
  if (reference) {
    targets.push({
      text: "",
      target: reference[1]!,
    });
  }

  return targets;
}

function stripMarkdownTarget(raw: string): string {
  const trimmed = raw.trim();
  const withoutTitle = trimmed.split(/\s+(?=["'])/)[0] ?? trimmed;
  return withoutTitle.replace(/^<|>$/g, "");
}

function resolveLocalPath(sourcePath: string, target: string): string {
  const decoded = safeDecodeURIComponent(target);
  const withoutQuery = decoded.split("?")[0] ?? decoded;
  const raw = withoutQuery.replace(/^\/+/, "");
  return normalizeRelPath(path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), raw)));
}

function resolveMarkdownPagePath(
  projectRoot: string,
  relPath: string,
): string | undefined {
  const absPath = path.join(projectRoot, relPath);
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return relPath;
  const indexPath = path.posix.join(relPath, "README.md");
  const absIndexPath = path.join(projectRoot, indexPath);
  if (fs.existsSync(absIndexPath) && fs.statSync(absIndexPath).isFile()) {
    return indexPath;
  }
  return undefined;
}

function normalizeOntologyTarget(
  sourcePath: string,
  value: string,
  allowedPrefixes: readonly string[],
): string | undefined {
  const raw = normalizeRelPath(value.replace(/^\.\//, ""));
  const rootRelative = ontologyTargetAllowed(raw, allowedPrefixes)
    ? raw
    : resolveLocalPath(sourcePath, value);
  return ontologyTargetAllowed(rootRelative, allowedPrefixes)
    ? rootRelative
    : undefined;
}

function normalizeOntologyReferencePrefixes(
  values: readonly string[],
  catalogPath: string,
  warnings: string[],
): string[] {
  const prefixes: string[] = [];
  for (const value of values) {
    const raw = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const trailingSlash = raw.endsWith("/");
    const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
    if (
      normalized === "" ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      path.posix.isAbsolute(normalized)
    ) {
      warnings.push(
        `${catalogPath}: ignored unsafe ontology reference prefix '${value}'`,
      );
      continue;
    }
    prefixes.push(trailingSlash ? `${normalized.replace(/\/+$/, "")}/` : normalized);
  }
  return uniqueStrings(prefixes);
}

function ontologyTargetAllowed(
  target: string,
  allowedPrefixes: readonly string[],
): boolean {
  const normalized = normalizeRelPath(target);
  return allowedPrefixes.some((prefix) => {
    if (prefix.endsWith("/")) return normalized.startsWith(prefix);
    return normalized === prefix;
  });
}

function shouldExcludeDocumentPath(
  relPath: string,
  excludes: readonly string[],
): boolean {
  const parts = relPath.split("/");
  if (
    parts.includes("node_modules") ||
    parts.includes(".git") ||
    parts.includes("dist") ||
    parts.includes("build") ||
    parts.includes(".next") ||
    parts.includes(".venv") ||
    parts.includes("venv") ||
    parts.includes("__pycache__")
  ) {
    return true;
  }
  if (excludes.some((item) => relPath === item || relPath.startsWith(`${item}/`))) {
    return true;
  }
  const name = parts.at(-1) ?? relPath;
  return (
    name.startsWith(".env") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".tfstate") ||
    name.endsWith(".tfstate.backup") ||
    name.endsWith(".log")
  );
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
      if (shouldExcludeDocumentPath(relPath, DEFAULT_EXCLUDES)) continue;
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        result.push(relPath);
      }
    }
  }
  return result.sort();
}

function safeProjectFileExists(projectRoot: string, relPath: string): boolean {
  const resolved = path.resolve(projectRoot, relPath);
  const root = path.resolve(projectRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return false;
  }
  return fs.existsSync(resolved);
}

function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

function normalizeAnchor(value: string): string {
  return slugify(safeDecodeURIComponent(value.replace(/^#/, "")));
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~[\]().,!?'"’:]/g, "")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function hashString(content: string): string {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function shortHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stringArrayField(
  value: Record<string, unknown>,
  key: string,
): string[] {
  const field = value[key];
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is string => typeof item === "string");
}

function dedupeOntologyRefs(
  refs: readonly DocumentGraphOntologyRef[],
): DocumentGraphOntologyRef[] {
  const byKey = new Map<string, DocumentGraphOntologyRef>();
  for (const ref of refs) {
    byKey.set(`${ref.source_path}:${ref.line}:${ref.target}`, ref);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function comparePages(a: DocumentGraphPage, b: DocumentGraphPage): number {
  return compareRelPaths(a.source_path, b.source_path);
}

function compareHeadings(
  a: DocumentGraphHeading,
  b: DocumentGraphHeading,
): number {
  return compareRelPaths(a.source_path, b.source_path) || a.line - b.line;
}

function compareLinks(a: DocumentGraphLink, b: DocumentGraphLink): number {
  return (
    compareRelPaths(a.source_path, b.source_path) ||
    a.line - b.line ||
    a.target.localeCompare(b.target)
  );
}

function compareBacklinks(
  a: DocumentGraphBacklink,
  b: DocumentGraphBacklink,
): number {
  return (
    compareRelPaths(a.target_path, b.target_path) ||
    compareRelPaths(a.source_path, b.source_path) ||
    a.line - b.line
  );
}

function compareOntologyRefs(
  a: DocumentGraphOntologyRef,
  b: DocumentGraphOntologyRef,
): number {
  return (
    compareRelPaths(a.source_path, b.source_path) ||
    a.line - b.line ||
    a.target.localeCompare(b.target)
  );
}

function compareRelPaths(a: string, b: string): number {
  const depthA = a.split("/").length;
  const depthB = b.split("/").length;
  return depthA - depthB || a.localeCompare(b);
}
