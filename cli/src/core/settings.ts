// Claude Code `.claude/settings.json` hook registration.
//
// Approach:
//   * Treat settings.json as a user-owned JSON document where anamnesis
//     contributes only specific entries under `hooks.<event>[].hooks[]`.
//   * All operations are idempotent: if our entry already exists for the
//     given (event, matcher, command), do nothing.
//   * No manifest tracking. Re-running update keeps registrations alive
//     without wiping anything else in settings.json. If a user explicitly
//     removes our entry but keeps the fragment installed, anamnesis will
//     re-add on next update — they should add the fragment to
//     `Agentfile.declined` instead to opt out permanently.
//
// JSON structure expected:
//   {
//     "hooks": {
//       "PostToolUse": [
//         { "matcher": "Edit", "hooks": [{ "type": "command", "command": ".claude/hooks/x.sh" }] }
//       ],
//       "SessionStart": [
//         { "hooks": [{ "type": "command", "command": ".claude/hooks/y.sh" }] }
//       ]
//     }
//   }

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HookRegistration {
  event: string; // "PostToolUse" / "SessionStart" / "PreToolUse" ...
  matcher?: string; // "Edit" / "Bash" / undefined for events without matchers
  command: string; // project-relative path, e.g. ".claude/hooks/x.sh"
}

export type HookSyncStatus = "create" | "noop";

export interface HookSyncResult {
  registration: HookRegistration;
  status: HookSyncStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SETTINGS_PATH = ".claude/settings.json";

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export function settingsPath(projectRoot: string): string {
  return path.join(projectRoot, SETTINGS_PATH);
}

/**
 * Load `.claude/settings.json`. Returns an empty object if absent or
 * unreadable JSON — settings.json is user-owned, and we never try to
 * recover from corruption (raise to caller via JSON.parse).
 */
export function readSettings(projectRoot: string): Record<string, unknown> {
  const fp = settingsPath(projectRoot);
  if (!fs.existsSync(fp)) return {};
  return JSON.parse(fs.readFileSync(fp, "utf8")) as Record<string, unknown>;
}

/**
 * Detect indent style of an existing JSON document.
 *
 * Returns:
 *   * `'\t'` if the first indented line starts with a tab.
 *   * a positive integer (count of leading spaces) for space-indented files.
 *   * `fallback` if no indented line is found (e.g. `{}` on one line).
 *
 * Mixed-indent files report whatever the first indented line uses; we don't
 * try to second-guess inconsistent input.
 */
export function detectIndent(
  text: string,
  fallback: number | string = 2,
): number | string {
  const match = text.match(/^([ \t]+)/m);
  if (!match) return fallback;
  const lead = match[1]!;
  if (lead.startsWith("\t")) return "\t";
  return lead.length;
}

export function writeSettings(
  projectRoot: string,
  settings: Record<string, unknown>,
): void {
  const fp = settingsPath(projectRoot);
  // Preserve the user's existing indent style if present; default to 2 for
  // brand-new files. Avoids the v0.1 bug where `JSON.stringify(.., null, 2)`
  // silently rewrote 4-space user files to 2-space.
  let indent: number | string = 2;
  if (fs.existsSync(fp)) {
    indent = detectIndent(fs.readFileSync(fp, "utf8"));
  }
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(
    fp,
    JSON.stringify(settings, null, indent) + "\n",
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

interface MatcherEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

function getEventEntries(
  settings: Record<string, unknown>,
  event: string,
): MatcherEntry[] | null {
  const hooks = settings["hooks"];
  if (!hooks || typeof hooks !== "object") return null;
  const eventEntries = (hooks as Record<string, unknown>)[event];
  if (!Array.isArray(eventEntries)) return null;
  return eventEntries as MatcherEntry[];
}

export function hookRegistrationPresent(
  settings: Record<string, unknown>,
  reg: HookRegistration,
): boolean {
  const entries = getEventEntries(settings, reg.event);
  if (!entries) return false;
  for (const entry of entries) {
    if ((entry.matcher ?? undefined) !== (reg.matcher ?? undefined)) continue;
    if (!Array.isArray(entry.hooks)) continue;
    for (const h of entry.hooks) {
      if (h.command === reg.command) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mutation (pure — returns new settings object)
// ---------------------------------------------------------------------------

/**
 * Idempotently ensure `reg` is present in `settings`. Returns a new settings
 * object plus a status flag (`create` if added, `noop` if already present).
 */
export function ensureHookRegistration(
  settings: Record<string, unknown>,
  reg: HookRegistration,
): { settings: Record<string, unknown>; status: HookSyncStatus } {
  if (hookRegistrationPresent(settings, reg)) {
    return { settings, status: "noop" };
  }

  // Deep-clone the relevant slice; preserve everything else by reference.
  const next: Record<string, unknown> = { ...settings };
  const hooksRoot: Record<string, unknown> = { ...((next["hooks"] as Record<string, unknown>) ?? {}) };
  next["hooks"] = hooksRoot;

  const eventList: MatcherEntry[] = Array.isArray(hooksRoot[reg.event])
    ? [...(hooksRoot[reg.event] as MatcherEntry[])]
    : [];
  hooksRoot[reg.event] = eventList;

  // Find an existing matcher group with the same matcher value.
  const targetMatcherIndex = eventList.findIndex(
    (e) => (e.matcher ?? undefined) === (reg.matcher ?? undefined),
  );

  const hookEntry = { type: "command", command: reg.command };

  if (targetMatcherIndex >= 0) {
    const existing = eventList[targetMatcherIndex]!;
    const newEntry: MatcherEntry = {
      ...existing,
      hooks: [...(existing.hooks ?? []), hookEntry],
    };
    eventList[targetMatcherIndex] = newEntry;
  } else {
    const entry: MatcherEntry =
      reg.matcher !== undefined
        ? { matcher: reg.matcher, hooks: [hookEntry] }
        : { hooks: [hookEntry] };
    eventList.push(entry);
  }

  return { settings: next, status: "create" };
}

// ---------------------------------------------------------------------------
// Higher-level sync — used by `init` and `update` after applyChanges.
// ---------------------------------------------------------------------------

/**
 * Ensure registrations for every input. Returns per-registration status and
 * whether the file was changed (and thus needs writing).
 */
export function syncHookRegistrations(
  projectRoot: string,
  registrations: HookRegistration[],
): { results: HookSyncResult[]; changed: boolean } {
  let settings = readSettings(projectRoot);
  const results: HookSyncResult[] = [];
  let changed = false;
  for (const reg of registrations) {
    const next = ensureHookRegistration(settings, reg);
    settings = next.settings;
    if (next.status === "create") changed = true;
    results.push({ registration: reg, status: next.status });
  }
  if (changed) writeSettings(projectRoot, settings);
  return { results, changed };
}
