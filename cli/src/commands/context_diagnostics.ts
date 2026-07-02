import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { analyzeHandoffLifecycle } from "../core/handoff_lifecycle.js";

export const CONTEXT_DIAGNOSTICS_SCHEMA_VERSION =
  "anamnesis.context_diagnostics.v1";

export type ContextDiagnosticSeverity = "warning" | "info";

export type ContextDiagnosticCode =
  | "docs-bootstrap-conflict"
  | "handoff-active-archive-inactive"
  | "handoff-active-completed-entry"
  | "handoff-active-file-missing"
  | "handoff-active-git-ref-stale"
  | "handoff-archive-missing"
  | "handoff-archive-stale"
  | "handoff-budget-exceeded"
  | "ontology-duplicate-id"
  | "ontology-relationship-conflict"
  | "ontology-superseded-entry-current"
  | "ontology-parse-error"
  | "evidence-artifact-missing"
  | "evidence-invalid-record";

export interface ContextDiagnosticIssue {
  severity: ContextDiagnosticSeverity;
  code: ContextDiagnosticCode;
  message: string;
  source_path: string;
  stable_ref: string;
  related?: string[];
  repair?: string;
}

export interface ContextDiagnosticsResult {
  schema_version: typeof CONTEXT_DIAGNOSTICS_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  ok: boolean;
  issues: ContextDiagnosticIssue[];
  summary: {
    issues: number;
    warnings: number;
    info: number;
    byCode: Record<ContextDiagnosticCode, number>;
  };
}

export interface ContextDiagnosticsOptions {
  projectRoot: string;
  now?: () => Date;
}

interface OntologyRecord {
  id: string;
  kind: "entity" | "relationship" | "rule";
  sourcePath: string;
  stableRef: string;
  endpointSignature?: string;
  supersedes?: string;
  status?: string;
}

interface BootstrapFact {
  sourcePath: string;
  stableRef: string;
  value: string;
}

interface DocFactClaim {
  sourcePath: string;
  lineNumber: number;
  key: string;
  value: string;
}

interface HandoffFrontmatter {
  gitRef?: string;
  handoffStatus?: string;
  retentionTier?: string;
  supersededBy?: string;
}

const CONTEXT_DIAGNOSTIC_CODES: readonly ContextDiagnosticCode[] = [
  "docs-bootstrap-conflict",
  "handoff-active-archive-inactive",
  "handoff-active-completed-entry",
  "handoff-active-file-missing",
  "handoff-active-git-ref-stale",
  "handoff-archive-missing",
  "handoff-archive-stale",
  "handoff-budget-exceeded",
  "ontology-duplicate-id",
  "ontology-relationship-conflict",
  "ontology-superseded-entry-current",
  "ontology-parse-error",
  "evidence-artifact-missing",
  "evidence-invalid-record",
];

const ACTIVE_GIT_REF_STALE_COMMIT_THRESHOLD = 3;

const DEFAULT_HANDOFF_LIFECYCLE_THRESHOLDS = {
  maxWarmArchives: 5,
  maxColdAgeDays: 90,
  maxTotalBytes: 512 * 1024,
};

export function contextDiagnostics(
  opts: ContextDiagnosticsOptions,
): ContextDiagnosticsResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const now = (opts.now ?? (() => new Date()))();
  const generatedAt = now.toISOString();
  const issues = [
    ...handoffIssues(projectRoot, now),
    ...ontologyIssues(projectRoot),
    ...docsBootstrapIssues(projectRoot),
    ...evidenceIssues(projectRoot),
  ].sort(compareIssues);

  const summary = summarizeIssues(issues);
  return {
    schema_version: CONTEXT_DIAGNOSTICS_SCHEMA_VERSION,
    projectRoot,
    generatedAt,
    ok: summary.warnings === 0,
    issues,
    summary,
  };
}

function handoffIssues(
  projectRoot: string,
  now: Date,
): ContextDiagnosticIssue[] {
  const activeRel = ".anamnesis/handoff/active.md";
  const activeAbs = path.join(projectRoot, activeRel);
  const issues: ContextDiagnosticIssue[] = [];

  if (fs.existsSync(activeAbs)) {
    const activeText = fs.readFileSync(activeAbs, "utf8");
    const openTaskLines = activeHandoffOpenTaskLines(activeText);
    const refs = extractArchiveRefs(openTaskLines.join("\n"));
    const missingRefs = refs.filter(
      (ref) => !safeProjectFileExists(projectRoot, ref),
    );
    for (const ref of missingRefs) {
      issues.push({
        severity: "warning",
        code: "handoff-archive-missing",
        message: `active handoff references missing archive ${ref}`,
        source_path: activeRel,
        stable_ref: `archive:${ref}`,
        related: [ref],
        repair:
          "Update active.md to point at an existing archive, or run /handoff-prepare to refresh handoff state.",
      });
    }

    for (const line of openTaskLines.filter(isCompletedHandoffTaskLine)) {
      issues.push({
        severity: "warning",
        code: "handoff-active-completed-entry",
        message: `active handoff keeps a completed or superseded task open: ${line}`,
        source_path: activeRel,
        stable_ref: `line:${stableLineRef(line)}`,
        repair:
          "Move completed or superseded entries out of Current focus / Active tasks, or run `anamnesis handoff close --apply`.",
      });
    }

    for (const target of missingActiveFilePointers(projectRoot, openTaskLines)) {
      issues.push({
        severity: "warning",
        code: "handoff-active-file-missing",
        message: `active handoff mentions missing project file ${target}`,
        source_path: activeRel,
        stable_ref: `file:${target}`,
        related: [target],
        repair:
          "Refresh the handoff entry so open tasks point at existing files, or remove stale file references.",
      });
    }

    for (const ref of refs.filter((ref) => safeProjectFileExists(projectRoot, ref))) {
      const archive = readHandoffFrontmatter(projectRoot, ref);
      if (!isInactiveHandoffArchive(archive)) continue;
      const status = archive.handoffStatus ?? archive.retentionTier ?? "inactive";
      issues.push({
        severity: "warning",
        code: "handoff-active-archive-inactive",
        message: `active handoff references ${status} archive ${ref}`,
        source_path: activeRel,
        stable_ref: `archive:${ref}`,
        related: archive.supersededBy ? [ref, archive.supersededBy] : [ref],
        repair:
          "Remove the closed/deprecated archive from active.md or point the task at the current replacement archive.",
      });
    }

    if (openTaskLines.length > 0) {
      const gitRefIssue = staleActiveGitRefIssue(projectRoot, activeText, activeRel);
      if (gitRefIssue) issues.push(gitRefIssue);
    }

    const newest = newestHandoffArchive(projectRoot);
    if (newest && refs.length > 0 && !refs.includes(newest.rel)) {
      issues.push({
        severity: "warning",
        code: "handoff-archive-stale",
        message: `active handoff does not reference newest archive ${newest.rel}`,
        source_path: activeRel,
        stable_ref: "archive:newest",
        related: [newest.rel, ...refs],
        repair:
          "Review active.md and update open tasks to the latest relevant archive if current work is still in flight.",
      });
    }
  }

  const lifecycle = analyzeHandoffLifecycle({
    projectRoot,
    now,
    thresholds: DEFAULT_HANDOFF_LIFECYCLE_THRESHOLDS,
  });
  if (lifecycle.summary.diskBudgetExceeded) {
    issues.push({
      severity: "warning",
      code: "handoff-budget-exceeded",
      message:
        `handoff archives use ${lifecycle.summary.totalBytes} bytes, ` +
        `exceeding budget ${lifecycle.thresholds.maxTotalBytes} bytes`,
      source_path: ".anamnesis/handoff",
      stable_ref: "budget:archives",
      related: lifecycle.candidates.map((candidate) => candidate.path),
      repair:
        "Run `anamnesis gc --dry-run` and review cold/deprecated handoff archive candidates.",
    });
  }

  return issues;
}

function ontologyIssues(projectRoot: string): ContextDiagnosticIssue[] {
  const records: OntologyRecord[] = [];
  const issues: ContextDiagnosticIssue[] = [];
  for (const relPath of ontologySourcePaths(projectRoot)) {
    const absPath = path.join(projectRoot, relPath);
    try {
      const parsed = YAML.parse(fs.readFileSync(absPath, "utf8")) as unknown;
      collectOntologyRecords(parsed, [], relPath, records);
    } catch (e) {
      issues.push({
        severity: "warning",
        code: "ontology-parse-error",
        message: `${relPath} could not be parsed: ${(e as Error).message}`,
        source_path: relPath,
        stable_ref: "file",
        repair: "Fix the YAML syntax before relying on ontology diagnostics.",
      });
    }
  }

  issues.push(...duplicateEntityIssues(records));
  issues.push(...relationshipConflictIssues(records));
  issues.push(...supersededCurrentIssues(records));
  return issues;
}

function evidenceIssues(projectRoot: string): ContextDiagnosticIssue[] {
  const relPath = ".anamnesis/evidence/events.jsonl";
  const absPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(absPath)) return [];

  const issues: ContextDiagnosticIssue[] = [];
  const lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      issues.push({
        severity: "warning",
        code: "evidence-invalid-record",
        message: `runtime evidence line ${index + 1} is not valid JSON`,
        source_path: relPath,
        stable_ref: `line:${index + 1}`,
        repair: "Remove or repair the malformed JSONL line.",
      });
      return;
    }
    if (!isObject(parsed)) return;
    const artifacts = objectField(parsed, "artifacts");
    if (!artifacts) return;
    for (const [name, target] of Object.entries(artifacts)) {
      if (typeof target !== "string" || !isLocalArtifactPath(target)) continue;
      if (!safeProjectFileExists(projectRoot, target)) {
        issues.push({
          severity: "warning",
          code: "evidence-artifact-missing",
          message: `runtime evidence artifact '${name}' points to missing ${target}`,
          source_path: relPath,
          stable_ref: `line:${index + 1}:artifacts.${name}`,
          related: [target],
          repair:
            "Regenerate the evidence artifact or remove stale artifact pointers from runtime evidence.",
        });
      }
    }
  });
  return issues;
}

function docsBootstrapIssues(projectRoot: string): ContextDiagnosticIssue[] {
  const factsByKey = bootstrapFactsByKey(projectRoot);
  if (factsByKey.size === 0) return [];

  const issues: ContextDiagnosticIssue[] = [];
  for (const claim of docFactClaims(projectRoot)) {
    const facts = factsByKey.get(claim.key);
    if (!facts || facts.length === 0) continue;
    if (facts.some((fact) => fact.value === claim.value)) continue;

    const actualValues = uniqueStrings(facts.map((fact) => fact.value));
    issues.push({
      severity: "warning",
      code: "docs-bootstrap-conflict",
      message:
        `documented fact '${claim.key}' is '${claim.value}', ` +
        `but bootstrap has ${actualValues.map(quoteValue).join(", ")}`,
      source_path: claim.sourcePath,
      stable_ref: `line:${claim.lineNumber}:${claim.key}`,
      related: facts.map((fact) =>
        `${fact.sourcePath} ${fact.stableRef}=${quoteValue(fact.value)}`,
      ),
      repair:
        "Update the document claim or re-run `anamnesis ontology bootstrap` if the project files changed.",
    });
  }
  return issues;
}

function duplicateEntityIssues(
  records: readonly OntologyRecord[],
): ContextDiagnosticIssue[] {
  const byId = groupBy(
    records.filter((record) => record.kind === "entity"),
    (record) => record.id,
  );
  const issues: ContextDiagnosticIssue[] = [];
  for (const [id, matches] of byId) {
    const uniqueRefs = uniqueStrings(
      matches.map((record) => `${record.sourcePath} ${record.stableRef}`),
    );
    if (uniqueRefs.length <= 1) continue;
    issues.push({
      severity: "warning",
      code: "ontology-duplicate-id",
      message: `ontology entity id '${id}' appears in ${uniqueRefs.length} places`,
      source_path: matches[0]!.sourcePath,
      stable_ref: matches[0]!.stableRef,
      related: uniqueRefs,
      repair:
        "Give distinct entities stable IDs, or merge duplicate semantic entries if they describe the same entity.",
    });
  }
  return issues;
}

function relationshipConflictIssues(
  records: readonly OntologyRecord[],
): ContextDiagnosticIssue[] {
  const byId = groupBy(
    records.filter((record) => record.kind === "relationship"),
    (record) => record.id,
  );
  const issues: ContextDiagnosticIssue[] = [];
  for (const [id, matches] of byId) {
    const signatures = uniqueStrings(
      matches.map((record) => record.endpointSignature ?? ""),
    ).filter((signature) => signature.length > 0);
    if (signatures.length <= 1) continue;
    issues.push({
      severity: "warning",
      code: "ontology-relationship-conflict",
      message: `relationship id '${id}' has conflicting endpoints`,
      source_path: matches[0]!.sourcePath,
      stable_ref: matches[0]!.stableRef,
      related: matches.map(
        (record) =>
          `${record.sourcePath} ${record.stableRef} ${record.endpointSignature ?? ""}`,
      ),
      repair:
        "Keep one relationship id per semantic edge, or supersede the older relationship entry explicitly.",
    });
  }
  return issues;
}

function supersededCurrentIssues(
  records: readonly OntologyRecord[],
): ContextDiagnosticIssue[] {
  const byId = groupBy(records, (record) => record.id);
  const issues: ContextDiagnosticIssue[] = [];
  for (const replacement of records.filter((record) => record.supersedes)) {
    const superseded = byId.get(replacement.supersedes!) ?? [];
    for (const oldRecord of superseded) {
      if (isMarkedSuperseded(oldRecord)) continue;
      issues.push({
        severity: "info",
        code: "ontology-superseded-entry-current",
        message: `ontology entry '${oldRecord.id}' is superseded by '${replacement.id}' but still looks current`,
        source_path: oldRecord.sourcePath,
        stable_ref: oldRecord.stableRef,
        related: [
          `${replacement.sourcePath} ${replacement.stableRef}`,
          `${oldRecord.sourcePath} ${oldRecord.stableRef}`,
        ],
        repair:
          "Mark the older entry as superseded or add a note so future agents do not treat both entries as current.",
      });
    }
  }
  return issues;
}

function collectOntologyRecords(
  value: unknown,
  pointer: string[],
  sourcePath: string,
  out: OntologyRecord[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isObject(item)) {
        const id = stringField(item, "id") ?? stringField(item, "name");
        if (id) {
          const kind = ontologyKind(pointer, item);
          out.push({
            id,
            kind,
            sourcePath,
            stableRef: `${pointer.join(".") || "items"}[${id}]`,
            endpointSignature:
              kind === "relationship" ? relationshipSignature(item) : undefined,
            supersedes: stringField(item, "supersedes"),
            status: stringField(item, "status"),
          });
        }
      }
      collectOntologyRecords(item, [...pointer, String(index)], sourcePath, out);
    });
    return;
  }
  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (isObject(child)) {
      const id = stringField(child, "id") ?? stringField(child, "name");
      if (id || pointer.length === 0) {
        const stableId = id ?? key;
        const kind = ontologyKind([...pointer, key], child);
        out.push({
          id: stableId,
          kind,
          sourcePath,
          stableRef: [...pointer, key].join("."),
          endpointSignature:
            kind === "relationship" ? relationshipSignature(child) : undefined,
          supersedes: stringField(child, "supersedes"),
          status: stringField(child, "status"),
        });
      }
    }
    collectOntologyRecords(child, [...pointer, key], sourcePath, out);
  }
}

function ontologyKind(
  pointer: readonly string[],
  value: Record<string, unknown>,
): OntologyRecord["kind"] {
  const joined = pointer.join(".").toLowerCase();
  if (
    joined.includes("relationship") ||
    joined.includes("flow") ||
    value.from !== undefined ||
    value.to !== undefined
  ) {
    return "relationship";
  }
  if (
    joined.includes("rule") ||
    joined.includes("note") ||
    joined.includes("invariant") ||
    value.rule !== undefined ||
    value.question !== undefined
  ) {
    return "rule";
  }
  return "entity";
}

function relationshipSignature(value: Record<string, unknown>): string {
  return stableStringify({
    from: value.from,
    to: value.to,
    path: value.path,
    source: value.source,
    target: value.target,
  });
}

function isMarkedSuperseded(record: OntologyRecord): boolean {
  return record.status?.toLowerCase().includes("superseded") === true;
}

function ontologySourcePaths(projectRoot: string): string[] {
  const paths = new Set<string>();
  const systemGraph = path.join(projectRoot, "system_graph.yaml");
  if (fs.existsSync(systemGraph)) paths.add("system_graph.yaml");
  for (const relPath of walkFiles(projectRoot, ".anamnesis/ontology")) {
    if (relPath.endsWith(".yaml") || relPath.endsWith(".yml")) {
      paths.add(relPath);
    }
  }
  return [...paths].sort();
}

function bootstrapFactsByKey(projectRoot: string): Map<string, BootstrapFact[]> {
  const byKey = new Map<string, BootstrapFact[]>();
  for (const relPath of ontologySourcePaths(projectRoot).filter((sourcePath) =>
    /\.bootstrap\.ya?ml$/.test(sourcePath),
  )) {
    let parsed: unknown;
    try {
      parsed = YAML.parse(
        fs.readFileSync(path.join(projectRoot, relPath), "utf8"),
      );
    } catch {
      continue;
    }
    if (!isObject(parsed) || !isObject(parsed.facts)) continue;
    const facts = flattenBootstrapFacts(parsed.facts, "facts", relPath);
    for (const fact of facts) {
      const list = byKey.get(fact.stableRef) ?? [];
      list.push(fact);
      byKey.set(fact.stableRef, list);
    }
  }
  return byKey;
}

function flattenBootstrapFacts(
  value: unknown,
  stableRef: string,
  sourcePath: string,
): BootstrapFact[] {
  if (isScalarFact(value)) {
    return [{ sourcePath, stableRef, value: normalizeFactValue(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenBootstrapFacts(item, `${stableRef}[${index}]`, sourcePath),
    );
  }
  if (!isObject(value)) return [];

  return Object.entries(value).flatMap(([key, child]) =>
    flattenBootstrapFacts(child, `${stableRef}.${key}`, sourcePath),
  );
}

function docFactClaims(projectRoot: string): DocFactClaim[] {
  const claims: DocFactClaim[] = [];
  for (const relPath of diagnosticDocPaths(projectRoot)) {
    const lines = fs
      .readFileSync(path.join(projectRoot, relPath), "utf8")
      .split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(
        /\banamnesis-fact:\s*([^=]+?)\s*=\s*(.+)\s*$/i,
      );
      if (!match) return;
      const key = stripFactMarker(match[1]!);
      if (!key.startsWith("facts.")) return;
      claims.push({
        sourcePath: relPath,
        lineNumber: index + 1,
        key,
        value: normalizeDocFactValue(match[2]!),
      });
    });
  }
  return claims;
}

function diagnosticDocPaths(projectRoot: string): string[] {
  const docs = new Set<string>();
  if (fs.existsSync(path.join(projectRoot, "README.md"))) {
    docs.add("README.md");
  }
  for (const relPath of walkFiles(projectRoot, "docs")) {
    if (!relPath.endsWith(".md")) continue;
    if (relPath.startsWith("docs/benchmark-evidence/")) continue;
    docs.add(relPath);
  }
  return [...docs].sort();
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
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        result.push(displayPathFromProject(projectRoot, absPath));
      }
    }
  }
  return result.sort();
}

function isScalarFact(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function normalizeFactValue(value: unknown): string {
  return value === null ? "null" : String(value).trim();
}

function normalizeDocFactValue(value: string): string {
  return stripFactMarker(value).replace(/\s+/g, " ");
}

function stripFactMarker(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^([`'"])(.*)\1$/);
  return (quoted ? quoted[2]! : trimmed).trim();
}

function quoteValue(value: string): string {
  return `'${value}'`;
}

function activeHandoffOpenTaskLines(text: string): string[] {
  const lines: string[] = [];
  let inOpenSection = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^##\s+(Current focus|Active tasks)\s*$/i.test(trimmed)) {
      inOpenSection = true;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      inOpenSection = false;
      continue;
    }
    if (inOpenSection && trimmed.startsWith("-")) lines.push(trimmed);
  }
  return lines;
}

function isCompletedHandoffTaskLine(line: string): boolean {
  return (
    /\[(done|completed|closed|deprecated|superseded)\]/i.test(line) ||
    /\bcompleted in\b/i.test(line) ||
    /\bclosed (at|in)\b/i.test(line) ||
    /\bdeprecated (at|by|in)\b/i.test(line) ||
    /\bsuperseded by\b/i.test(line)
  );
}

function missingActiveFilePointers(
  projectRoot: string,
  openTaskLines: readonly string[],
): string[] {
  const targets = new Set<string>();
  for (const line of openTaskLines) {
    for (const target of extractBacktickLocalPaths(line)) {
      if (isHandoffArchivePath(target)) continue;
      if (!looksLikeLocalFilePointer(target)) continue;
      if (!safeProjectFileExists(projectRoot, target)) targets.add(target);
    }
  }
  return [...targets].sort();
}

function extractBacktickLocalPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const candidate = normalizeInlinePath(match[1]!);
    if (candidate) paths.add(candidate);
  }
  return [...paths].sort();
}

function normalizeInlinePath(value: string): string | undefined {
  const trimmed = value.trim().replace(/^\.\/+/, "");
  if (trimmed.length === 0) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined;
  if (path.isAbsolute(trimmed)) return undefined;
  if (trimmed.startsWith("~")) return undefined;
  if (/[\s*?[\]{}<>|]/.test(trimmed)) return undefined;
  if (trimmed.startsWith("-")) return undefined;
  return trimmed.replace(/[.,;)]+$/g, "");
}

function looksLikeLocalFilePointer(value: string): boolean {
  if (value.includes("/")) return true;
  return /\.[A-Za-z0-9]+$/.test(value);
}

function isHandoffArchivePath(value: string): boolean {
  return /^\.anamnesis\/handoff\/(?!active\.md)(?!draft\.md).+\.md$/.test(value);
}

function readHandoffFrontmatter(
  projectRoot: string,
  relPath: string,
): HandoffFrontmatter {
  const absPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(absPath)) return {};
  return parseHandoffFrontmatter(fs.readFileSync(absPath, "utf8"));
}

function parseHandoffFrontmatter(text: string): HandoffFrontmatter {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1] ?? "") as unknown;
  } catch {
    return {};
  }
  if (!isObject(parsed)) return {};
  return {
    gitRef: stringField(parsed, "git_ref"),
    handoffStatus: stringField(parsed, "handoff_status"),
    retentionTier: stringField(parsed, "retention_tier"),
    supersededBy: stringField(parsed, "superseded_by"),
  };
}

function isInactiveHandoffArchive(frontmatter: HandoffFrontmatter): boolean {
  const status = frontmatter.handoffStatus?.toLowerCase();
  const tier = frontmatter.retentionTier?.toLowerCase();
  return (
    status === "closed" ||
    status === "deprecated" ||
    status === "superseded" ||
    tier === "cold" ||
    tier === "deprecated" ||
    frontmatter.supersededBy !== undefined
  );
}

function staleActiveGitRefIssue(
  projectRoot: string,
  activeText: string,
  activeRel: string,
): ContextDiagnosticIssue | undefined {
  const gitRef = parseHandoffFrontmatter(activeText).gitRef;
  if (!gitRef || !/^[0-9a-f]{7,40}$/i.test(gitRef)) return undefined;
  if (!gitWorktreeClean(projectRoot)) return undefined;

  const head = runGit(projectRoot, ["rev-parse", "HEAD"]);
  if (!head || head === gitRef) return undefined;

  const behindRaw = runGit(projectRoot, ["rev-list", "--count", `${gitRef}..HEAD`]);
  if (!behindRaw) return undefined;
  const behind = Number.parseInt(behindRaw, 10);
  if (!Number.isFinite(behind) || behind < ACTIVE_GIT_REF_STALE_COMMIT_THRESHOLD) {
    return undefined;
  }

  return {
    severity: "warning",
    code: "handoff-active-git-ref-stale",
    message:
      `active handoff git_ref is ${behind} commit(s) behind HEAD while worktree is clean`,
    source_path: activeRel,
    stable_ref: "frontmatter:git_ref",
    related: [gitRef, head],
    repair:
      "Refresh active.md after confirming whether the referenced task is still in flight.",
  };
}

function gitWorktreeClean(projectRoot: string): boolean {
  const status = runGit(projectRoot, ["status", "--porcelain"]);
  return status !== undefined && status.trim() === "";
}

function runGit(projectRoot: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

function stableLineRef(line: string): string {
  return line
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function extractArchiveRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/archive:\s*`([^`]+)`/g)) {
    refs.add(match[1]!.trim());
  }
  for (const match of text.matchAll(/archive:\s*([^\s]+)/g)) {
    refs.add(match[1]!.replace(/^`+|[`.,;)]+$/g, "").trim());
  }
  return [...refs].filter((ref) => ref.length > 0).sort();
}

function newestHandoffArchive(
  projectRoot: string,
): { rel: string; mtimeMs: number } | undefined {
  const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
  if (!fs.existsSync(handoffDir)) return undefined;
  return fs
    .readdirSync(handoffDir)
    .filter((name) => name.endsWith(".md") && name !== "active.md")
    .map((name) => {
      const rel = path.join(".anamnesis", "handoff", name);
      const abs = path.join(projectRoot, rel);
      return {
        rel: rel.split(path.sep).join("/"),
        mtimeMs: fs.statSync(abs).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel))[0];
}

function safeProjectFileExists(projectRoot: string, relPath: string): boolean {
  const resolved = path.resolve(projectRoot, relPath);
  const root = path.resolve(projectRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return false;
  }
  return fs.existsSync(resolved);
}

function isLocalArtifactPath(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (path.isAbsolute(value)) return false;
  return value.includes("/") || /\.[A-Za-z0-9]+$/.test(value);
}

function summarizeIssues(
  issues: readonly ContextDiagnosticIssue[],
): ContextDiagnosticsResult["summary"] {
  const byCode = Object.fromEntries(
    CONTEXT_DIAGNOSTIC_CODES.map((code) => [code, 0]),
  ) as Record<ContextDiagnosticCode, number>;
  for (const issue of issues) byCode[issue.code]++;
  return {
    issues: issues.length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length,
    byCode,
  };
}

function compareIssues(
  a: ContextDiagnosticIssue,
  b: ContextDiagnosticIssue,
): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    a.code.localeCompare(b.code) ||
    a.source_path.localeCompare(b.source_path) ||
    a.stable_ref.localeCompare(b.stable_ref)
  );
}

function severityRank(severity: ContextDiagnosticSeverity): number {
  return severity === "warning" ? 0 : 1;
}

function groupBy<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const list = grouped.get(key) ?? [];
    list.push(value);
    grouped.set(key, list);
  }
  return grouped;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}
