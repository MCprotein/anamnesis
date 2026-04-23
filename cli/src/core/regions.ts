// Region anchor parser/renderer for auto-managed text blocks.
// Anchor format (docs/DESIGN.md §6.1):
//   <!-- anamnesis:region id=<id> fragment=<fragId>@<version> -->
//   ... content ...
//   <!-- /anamnesis:region -->
//
// Scope: v0.1 supports flat (non-nested) regions in markdown / plain text.
// YAML / JSON structural merge is handled elsewhere.

const OPEN_PATTERN =
  /<!--\s*anamnesis:region\s+id=([A-Za-z0-9_-]+)\s+fragment=([A-Za-z0-9_-]+)@(\d+)\s*-->/;
const CLOSE_PATTERN = /<!--\s*\/anamnesis:region\s*-->/;

// Used for listing — matches an open anchor globally.
const OPEN_GLOBAL = new RegExp(OPEN_PATTERN.source, "g");

export interface Region {
  id: string;
  fragmentId: string;
  fragmentVersion: number;
  content: string; // inner content, anchors excluded, leading/trailing newlines preserved
  openAnchor: string; // raw open anchor line (for stable rewrite)
  closeAnchor: string;
  startIndex: number; // char index of open anchor start
  endIndex: number; // char index just past close anchor
}

export interface RegionInput {
  id: string;
  fragmentId: string;
  fragmentVersion: number;
  content: string;
}

export class RegionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegionParseError";
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseRegions(text: string): Region[] {
  const regions: Region[] = [];
  const seenIds = new Set<string>();

  let cursor = 0;
  while (cursor < text.length) {
    OPEN_GLOBAL.lastIndex = cursor;
    const openMatch = OPEN_GLOBAL.exec(text);
    if (!openMatch) break;

    const [openAnchor, id, fragmentId, versionStr] = openMatch;
    const openStart = openMatch.index;
    const openEnd = openStart + openAnchor.length;

    // Search for close anchor after open.
    const afterOpen = text.slice(openEnd);
    const closeMatch = afterOpen.match(CLOSE_PATTERN);
    if (!closeMatch || closeMatch.index === undefined) {
      throw new RegionParseError(
        `region id='${id}' opened at index ${openStart} has no matching close anchor`,
      );
    }

    // Reject nesting: another open before this close.
    OPEN_GLOBAL.lastIndex = openEnd;
    const nextOpen = OPEN_GLOBAL.exec(text);
    if (
      nextOpen &&
      nextOpen.index < openEnd + closeMatch.index
    ) {
      throw new RegionParseError(
        `nested regions are not supported (id='${id}' contains id='${nextOpen[1]}')`,
      );
    }

    if (seenIds.has(id!)) {
      throw new RegionParseError(`duplicate region id='${id}'`);
    }
    seenIds.add(id!);

    const closeAbsIndex = openEnd + closeMatch.index;
    const closeEnd = closeAbsIndex + closeMatch[0].length;

    regions.push({
      id: id!,
      fragmentId: fragmentId!,
      fragmentVersion: parseInt(versionStr!, 10),
      content: text.slice(openEnd, closeAbsIndex),
      openAnchor: openAnchor!,
      closeAnchor: closeMatch[0],
      startIndex: openStart,
      endIndex: closeEnd,
    });

    cursor = closeEnd;
  }

  return regions;
}

export function findRegion(text: string, id: string): Region | undefined {
  return parseRegions(text).find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function makeOpenAnchor(input: RegionInput): string {
  return `<!-- anamnesis:region id=${input.id} fragment=${input.fragmentId}@${input.fragmentVersion} -->`;
}

export function makeCloseAnchor(): string {
  return `<!-- /anamnesis:region -->`;
}

export function renderRegion(input: RegionInput): string {
  // Ensure inner content has leading/trailing newlines so anchors sit on their own lines.
  const body = input.content.startsWith("\n") ? input.content : "\n" + input.content;
  const withTrailing = body.endsWith("\n") ? body : body + "\n";
  return `${makeOpenAnchor(input)}${withTrailing}${makeCloseAnchor()}`;
}

// ---------------------------------------------------------------------------
// Mutations — all return new strings.
// ---------------------------------------------------------------------------

/**
 * Upsert a region. If a region with `input.id` exists, replace its block
 * (open anchor through close anchor) in place. Otherwise append to the end
 * of `text` with a blank line separator.
 *
 * The caller is responsible for any file-level trailing newline policy.
 */
export function upsertRegion(text: string, input: RegionInput): string {
  const existing = findRegion(text, input.id);
  const rendered = renderRegion(input);
  if (existing) {
    return (
      text.slice(0, existing.startIndex) +
      rendered +
      text.slice(existing.endIndex)
    );
  }
  // Append, ensuring single blank-line separation if base has trailing content.
  if (text.length === 0) return rendered + "\n";
  const separator = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return text + separator + rendered + "\n";
}

export function removeRegion(text: string, id: string): string {
  const region = findRegion(text, id);
  if (!region) return text;

  // Drop the region block. Also absorb a single trailing newline that belonged
  // to the region's own line separator so we don't leave an orphan blank line.
  let end = region.endIndex;
  if (text[end] === "\n") end++;
  return text.slice(0, region.startIndex) + text.slice(end);
}
