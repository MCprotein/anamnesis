import * as fs from "node:fs";
import * as path from "node:path";

export function activeHandoffOpenTaskLines(text: string): string[] {
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
    if (inOpenSection && trimmed.startsWith("-")) {
      lines.push(trimmed);
    }
  }
  return lines;
}

export function isCompletedHandoffTaskLine(line: string): boolean {
  return (
    /\[(done|completed|closed|deprecated|superseded)\]/i.test(line) ||
    /\bcompleted in\b/i.test(line) ||
    /\bclosed (at|in)\b/i.test(line) ||
    /\bdeprecated (at|by|in)\b/i.test(line) ||
    /\bsuperseded by\b/i.test(line)
  );
}

export function extractArchiveRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/archive:\s*`([^`]+)`/g)) {
    refs.add(match[1]!.trim());
  }
  for (const match of text.matchAll(/archive:\s*([^\s]+)/g)) {
    refs.add(match[1]!.replace(/^`+|[`.,;)]+$/g, "").trim());
  }
  return [...refs].filter((ref) => ref.length > 0).sort();
}

export interface NewestHandoffArchive {
  rel: string;
  mtimeMs: number;
}

export function newestHandoffArchive(
  projectRoot: string,
  opts?: { exclude?: readonly string[] },
): NewestHandoffArchive | undefined {
  const exclude = new Set(opts?.exclude ?? ["active.md"]);
  const handoffDir = path.join(projectRoot, ".anamnesis", "handoff");
  if (!fs.existsSync(handoffDir)) return undefined;
  return fs
    .readdirSync(handoffDir)
    .filter((name) => name.endsWith(".md") && !exclude.has(name))
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
