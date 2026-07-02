import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";

export const HANDOFF_ACTION_SCHEMA_VERSION = "anamnesis.handoff_action.v1";

export type HandoffActionMode = "close" | "deprecate";

export interface HandoffActionResult {
  schema_version: typeof HANDOFF_ACTION_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  mode: HandoffActionMode;
  applied: boolean;
  archive: string;
  activeHandoff?: string;
  handoffStatus: "closed" | "deprecated" | "superseded";
  retentionTier: "cold" | "deprecated";
  supersededBy?: string;
  summary: string;
  removedActiveEntries: string[];
  changed: {
    archiveFrontmatter: boolean;
    activeHandoff: boolean;
  };
  writtenPaths: string[];
  preview: string;
}

export interface HandoffActionOptions {
  projectRoot: string;
  mode: HandoffActionMode;
  archive?: string;
  apply?: boolean;
  summary?: string;
  reason?: string;
  supersededBy?: string;
  now?: () => Date;
}

export class HandoffActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffActionError";
  }
}

interface ActiveUpdate {
  activeHandoff?: string;
  text?: string;
  changed: boolean;
  removedEntries: string[];
  summary: string;
}

export function handoffAction(opts: HandoffActionOptions): HandoffActionResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const archive = normalizeArchivePath(opts.archive);
  const archiveAbs = path.join(projectRoot, archive);
  if (!fs.existsSync(archiveAbs)) {
    throw new HandoffActionError(`handoff archive does not exist: ${archive}`);
  }

  const supersededBy =
    opts.supersededBy === undefined
      ? undefined
      : normalizeArchivePath(opts.supersededBy, "--superseded-by");
  const handoffStatus =
    opts.mode === "close" ? "closed" : supersededBy ? "superseded" : "deprecated";
  const retentionTier = opts.mode === "close" ? "cold" : "deprecated";
  const archiveText = fs.readFileSync(archiveAbs, "utf8");
  const nextArchiveText = updateArchiveFrontmatter({
    text: archiveText,
    mode: opts.mode,
    generatedAt,
    handoffStatus,
    retentionTier,
    supersededBy,
    reason: cleanOptional(opts.reason),
  });
  const activeUpdate = updateActiveHandoff({
    projectRoot,
    archive,
    generatedAt,
    mode: opts.mode,
    handoffStatus,
    supersededBy,
    explicitSummary: cleanOptional(opts.summary),
  });

  const writtenPaths: string[] = [];
  if (opts.apply === true) {
    if (nextArchiveText !== archiveText) {
      fs.writeFileSync(archiveAbs, nextArchiveText, "utf8");
      writtenPaths.push(archive);
    }
    if (activeUpdate.activeHandoff && activeUpdate.text && activeUpdate.changed) {
      fs.writeFileSync(
        path.join(projectRoot, activeUpdate.activeHandoff),
        activeUpdate.text,
        "utf8",
      );
      writtenPaths.push(activeUpdate.activeHandoff);
    }
  }

  const result = {
    schema_version: HANDOFF_ACTION_SCHEMA_VERSION,
    projectRoot: ".",
    generatedAt,
    mode: opts.mode,
    applied: opts.apply === true,
    archive,
    activeHandoff: activeUpdate.activeHandoff,
    handoffStatus,
    retentionTier,
    supersededBy,
    summary: activeUpdate.summary,
    removedActiveEntries: activeUpdate.removedEntries,
    changed: {
      archiveFrontmatter: nextArchiveText !== archiveText,
      activeHandoff: activeUpdate.changed,
    },
    writtenPaths,
  } satisfies Omit<HandoffActionResult, "preview">;

  return {
    ...result,
    preview: renderPreview(result),
  };
}

function normalizeArchivePath(
  value: string | undefined,
  flagName = "--archive",
): string {
  if (!value || value.trim() === "") {
    throw new HandoffActionError(`${flagName} is required`);
  }
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    normalized.includes("..") ||
    !normalized.startsWith(".anamnesis/handoff/") ||
    !normalized.endsWith(".md") ||
    normalized === ".anamnesis/handoff/active.md" ||
    normalized === ".anamnesis/handoff/draft.md" ||
    normalized.startsWith(".anamnesis/handoff/drafts/")
  ) {
    throw new HandoffActionError(
      `${flagName} must point to a finalized .anamnesis/handoff/*.md archive`,
    );
  }
  return normalized;
}

function updateArchiveFrontmatter(input: {
  text: string;
  mode: HandoffActionMode;
  generatedAt: string;
  handoffStatus: "closed" | "deprecated" | "superseded";
  retentionTier: "cold" | "deprecated";
  supersededBy?: string;
  reason?: string;
}): string {
  const parsed = splitFrontmatter(input.text);
  const frontmatter = parsed.frontmatter;
  frontmatter.handoff_status = input.handoffStatus;
  frontmatter.retention_tier = input.retentionTier;
  if (input.mode === "close") {
    frontmatter.closed_at = input.generatedAt;
  } else {
    frontmatter.deprecated_at = input.generatedAt;
  }
  if (input.supersededBy) {
    frontmatter.superseded_by = input.supersededBy;
  }
  if (input.reason) {
    frontmatter.lifecycle_note = input.reason;
  }
  return `---\n${YAML.stringify(frontmatter)}---\n\n${parsed.body.replace(/^\s*\n/, "")}`;
}

function splitFrontmatter(text: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { frontmatter: {}, body: text };
  const parsed = YAML.parse(match[1] ?? "") as unknown;
  return {
    frontmatter:
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {},
    body: text.slice(match[0].length),
  };
}

function updateActiveHandoff(input: {
  projectRoot: string;
  archive: string;
  generatedAt: string;
  mode: HandoffActionMode;
  handoffStatus: "closed" | "deprecated" | "superseded";
  supersededBy?: string;
  explicitSummary?: string;
}): ActiveUpdate {
  const activeHandoff = ".anamnesis/handoff/active.md";
  const activeAbs = path.join(input.projectRoot, activeHandoff);
  if (!fs.existsSync(activeAbs)) {
    return {
      activeHandoff: undefined,
      changed: false,
      removedEntries: [],
      summary: input.explicitSummary ?? path.basename(input.archive),
    };
  }

  const original = fs.readFileSync(activeAbs, "utf8");
  const lines = original.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  const removedEntries: string[] = [];
  let section: "open" | "recent" | "other" = "other";

  for (const line of lines) {
    if (/^##\s+(Current focus|Active tasks)\s*$/.test(line)) {
      section = "open";
      kept.push(line);
      continue;
    }
    if (/^##\s+Recently completed\s*$/.test(line)) {
      section = "recent";
      kept.push(line);
      continue;
    }
    if (/^##\s+/.test(line)) {
      section = "other";
      kept.push(line);
      continue;
    }
    if (section === "open" && isArchiveBullet(line, input.archive)) {
      removedEntries.push(cleanBullet(line));
      continue;
    }
    kept.push(line);
  }

  const summary =
    input.explicitSummary ??
    removedEntries.map(summaryFromActiveEntry).find(Boolean) ??
    path.basename(input.archive);
  if (removedEntries.length === 0) {
    return {
      activeHandoff,
      text: original,
      changed: false,
      removedEntries,
      summary,
    };
  }
  const completionBullet = renderCompletionBullet({
    summary,
    generatedAt: input.generatedAt,
    archive: input.archive,
    handoffStatus: input.handoffStatus,
    supersededBy: input.supersededBy,
  });
  const withoutDuplicate = removeRecentEntryForArchive(kept, input.archive);
  const nextLines = insertRecentlyCompleted(withoutDuplicate, completionBullet);
  const nextText = `${trimTrailingBlankLines(nextLines).join("\n")}\n`;

  return {
    activeHandoff,
    text: nextText,
    changed: nextText !== original,
    removedEntries,
    summary,
  };
}

function isArchiveBullet(line: string, archive: string): boolean {
  return line.trim().startsWith("- ") && line.includes(archive);
}

function cleanBullet(line: string): string {
  return line.replace(/^\s*-\s*/, "").replace(/\s+/g, " ").trim();
}

function summaryFromActiveEntry(entry: string): string | undefined {
  const withoutArchive = entry
    .replace(/\s+—\s+archive:\s+`?\.anamnesis\/handoff\/[^`\s]+\.md`?/g, "")
    .replace(/\s+—\s+next:\s+.*$/g, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .trim();
  return withoutArchive || undefined;
}

function renderCompletionBullet(input: {
  summary: string;
  generatedAt: string;
  archive: string;
  handoffStatus: "closed" | "deprecated" | "superseded";
  supersededBy?: string;
}): string {
  const status =
    input.handoffStatus === "closed"
      ? "closed"
      : input.handoffStatus === "superseded"
        ? "superseded"
        : "deprecated";
  const superseded =
    input.supersededBy === undefined
      ? ""
      : ` — superseded_by: \`${input.supersededBy}\``;
  return `- ${input.summary} — ${status} at ${input.generatedAt}${superseded} — archive: \`${input.archive}\``;
}

function removeRecentEntryForArchive(lines: string[], archive: string): string[] {
  const result: string[] = [];
  let section: "recent" | "other" = "other";
  for (const line of lines) {
    if (/^##\s+Recently completed\s*$/.test(line)) {
      section = "recent";
      result.push(line);
      continue;
    }
    if (/^##\s+/.test(line)) {
      section = "other";
      result.push(line);
      continue;
    }
    if (section === "recent" && isArchiveBullet(line, archive)) continue;
    result.push(line);
  }
  return result;
}

function insertRecentlyCompleted(lines: string[], bullet: string): string[] {
  const headingIndex = lines.findIndex((line) =>
    /^##\s+Recently completed\s*$/.test(line),
  );
  if (headingIndex < 0) {
    return [...trimTrailingBlankLines(lines), "", "## Recently completed", bullet, ""];
  }
  const next = [...lines];
  let insertAt = headingIndex + 1;
  while (next[insertAt] !== undefined && next[insertAt]!.trim() === "") {
    insertAt++;
  }
  next.splice(insertAt, 0, bullet);
  return next;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1]!.trim() === "") {
    next.pop();
  }
  return next;
}

function renderPreview(input: Omit<HandoffActionResult, "preview">): string {
  const lines = [
    `anamnesis handoff ${input.mode} — ${input.applied ? "applied" : "dry-run"}`,
    `archive: ${input.archive}`,
    `handoff_status: ${input.handoffStatus}`,
    `retention_tier: ${input.retentionTier}`,
    ...(input.supersededBy ? [`superseded_by: ${input.supersededBy}`] : []),
    `active_handoff: ${input.activeHandoff ?? "(none)"}`,
    `removed_active_entries: ${input.removedActiveEntries.length}`,
    `archive_frontmatter: ${input.changed.archiveFrontmatter ? "update" : "unchanged"}`,
    `active_handoff_update: ${input.changed.activeHandoff ? "update" : "unchanged"}`,
    ...(input.writtenPaths.length > 0
      ? ["written:", ...input.writtenPaths.map((writtenPath) => `- ${writtenPath}`)]
      : ["written: (none; dry-run)"]),
  ];
  return lines.join("\n");
}

function cleanOptional(value: string | undefined): string | undefined {
  const clean = value?.replace(/\s+/g, " ").trim();
  return clean ? clean : undefined;
}
