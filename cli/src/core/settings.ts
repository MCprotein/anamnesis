// Claude Code `.claude/settings.json` hook registration.
//
// Approach:
//   * Treat settings.json as a user-owned JSON document where anamnesis
//     contributes only specific entries under `hooks.<event>[].hooks[]`.
//   * All operations are idempotent: if our entry already exists for the
//     given (event, matcher, command), do nothing.
//   * Commands are written as `"$CLAUDE_PROJECT_DIR"/<path>` so hooks resolve
//     when Claude's working directory is a subdirectory, and so polyglot
//     scripts see an absolute `$0`. Legacy bare project-relative commands are
//     pruned when the current form is ensured.
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
//         { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/x.sh" }] }
//       ],
//       "SessionStart": [
//         { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/y.sh" }] }
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
  /** Matchers that earlier releases registered for this hook. */
  legacyMatchers?: string[];
  /**
   * For hook files the user modified: rewrite the bare relative command to
   * the current form in place and keep the user's matcher. Never add a
   * missing registration.
   */
  migrateOnly?: boolean;
}

export type HookSyncStatus = "create" | "migrate" | "noop";

export interface HookSyncResult {
  registration: HookRegistration;
  status: HookSyncStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SETTINGS_PATH = ".claude/settings.json";

/**
 * Settings command for a project-relative hook path. Claude Code exports
 * `CLAUDE_PROJECT_DIR` to hook processes; the quotes keep paths with spaces
 * intact.
 */
export function claudeHookCommand(projectRelativePath: string): string {
  return `"$CLAUDE_PROJECT_DIR"/${projectRelativePath}`;
}

/** Where a settings file lives, for spelling checks that depend on it. */
export interface HookCommandOptions {
  /** Project root; an unquoted CLAUDE_PROJECT_DIR breaks when it has spaces. */
  projectRoot?: string;
}

/**
 * True when a settings command runs this hook through CLAUDE_PROJECT_DIR in
 * a common spelling a user may write by hand. Unquoted spellings count only
 * when the project root has no whitespace, because the shell splits them
 * otherwise.
 */
function isClaudeHookCommand(
  command: string | undefined,
  projectRelativePath: string,
  options: HookCommandOptions = {},
): boolean {
  if (command === undefined) return false;
  const p = projectRelativePath;
  const quoted = [
    claudeHookCommand(p),
    `"$CLAUDE_PROJECT_DIR/${p}"`,
    `"\${CLAUDE_PROJECT_DIR}"/${p}`,
    `"\${CLAUDE_PROJECT_DIR}/${p}"`,
  ];
  const unquoted = [`$CLAUDE_PROJECT_DIR/${p}`, `\${CLAUDE_PROJECT_DIR}/${p}`];
  const unquotedSafe =
    options.projectRoot === undefined || !/\s/.test(options.projectRoot);
  return [...quoted, ...(unquotedSafe ? unquoted : [])].includes(
    command.trim(),
  );
}

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
  options: HookCommandOptions = {},
): boolean {
  const entries = getEventEntries(settings, reg.event);
  if (!entries) return false;
  for (const entry of entries) {
    if ((entry.matcher ?? undefined) !== (reg.matcher ?? undefined)) continue;
    if (!Array.isArray(entry.hooks)) continue;
    for (const h of entry.hooks) {
      if (isClaudeHookCommand(h.command, reg.command, options)) return true;
    }
  }
  return false;
}

/**
 * True when an event entry carries this registration in a form an earlier
 * anamnesis release wrote: the bare relative command under the current or a
 * legacy matcher, or the current command under a legacy matcher. Entries under
 * any other matcher are user-owned and stay untouched.
 */
function isSupersededHook(
  entry: MatcherEntry,
  hook: { command?: string },
  reg: HookRegistration,
): boolean {
  const matcher = entry.matcher ?? undefined;
  const legacy = (reg.legacyMatchers ?? []).includes(matcher ?? "");
  if (hook.command === reg.command) {
    return matcher === (reg.matcher ?? undefined) || legacy;
  }
  return isClaudeHookCommand(hook.command, reg.command) && legacy;
}

/** True when the current command for `reg` is registered under any matcher. */
export function hookCommandRegistered(
  settings: Record<string, unknown>,
  reg: HookRegistration,
  options: HookCommandOptions = {},
): boolean {
  return hookCommandEvents(settings, reg, options).includes(reg.event);
}

/** Events under which this hook's CLAUDE_PROJECT_DIR command is registered. */
export function hookCommandEvents(
  settings: Record<string, unknown>,
  reg: HookRegistration,
  options: HookCommandOptions = {},
): string[] {
  const hooks = settings["hooks"];
  if (!hooks || typeof hooks !== "object") return [];
  return Object.keys(hooks as Record<string, unknown>).filter((event) =>
    (getEventEntries(settings, event) ?? []).some(
      (entry) =>
        Array.isArray(entry.hooks) &&
        entry.hooks.some((h) =>
          isClaudeHookCommand(h.command, reg.command, options),
        ),
    ),
  );
}

/**
 * True when `reg` has any registration in a form an earlier release wrote.
 * With `bareOnly`, only the bare relative command counts: the one form that
 * `apply` can still rewrite for every hook, including user-modified ones.
 */
export function hookRegistrationLegacy(
  settings: Record<string, unknown>,
  reg: HookRegistration,
  options: { bareOnly?: boolean } = {},
): boolean {
  const entries = getEventEntries(settings, reg.event) ?? [];
  return entries.some(
    (entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) =>
        options.bareOnly
          ? h.command === reg.command
          : isSupersededHook(entry, h, reg),
      ),
  );
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
  options: HookCommandOptions = {},
): { settings: Record<string, unknown>; status: HookSyncStatus } {
  if (reg.migrateOnly) return migrateCommandInPlace(settings, reg, options);
  const existingEntries = getEventEntries(settings, reg.event) ?? [];
  // A bare relative command under any other matcher is rewritten in place
  // below: it breaks when Claude's working directory is a subdirectory.
  const hasSuperseded =
    hookRegistrationLegacy(settings, reg) ||
    hookRegistrationLegacy(settings, reg, { bareOnly: true });
  if (!hasSuperseded && hookRegistrationPresent(settings, reg, options)) {
    return { settings, status: "noop" };
  }

  // Deep-clone the relevant slice; preserve everything else by reference.
  const next: Record<string, unknown> = { ...settings };
  const hooksRoot: Record<string, unknown> = { ...((next["hooks"] as Record<string, unknown>) ?? {}) };
  next["hooks"] = hooksRoot;

  // Drop superseded forms of this registration, rewrite a bare command left
  // under a user-chosen matcher in place, then drop any group left empty.
  const eventList: MatcherEntry[] = existingEntries
    .map((entry) => {
      if (!Array.isArray(entry.hooks)) return entry;
      const hooks = entry.hooks
        .filter((h) => !isSupersededHook(entry, h, reg))
        .map((h) =>
          h.command === reg.command
            ? { ...h, command: claudeHookCommand(reg.command) }
            : h,
        );
      const unchanged =
        hooks.length === entry.hooks.length &&
        hooks.every((h, i) => h === entry.hooks![i]);
      return unchanged ? entry : { ...entry, hooks };
    })
    .filter((entry) => !Array.isArray(entry.hooks) || entry.hooks.length > 0);
  hooksRoot[reg.event] = eventList;
  if (hookRegistrationPresent(next, reg, options)) {
    return { settings: next, status: "migrate" };
  }

  // Find an existing matcher group with the same matcher value.
  const targetMatcherIndex = eventList.findIndex(
    (e) => (e.matcher ?? undefined) === (reg.matcher ?? undefined),
  );

  const hookEntry = { type: "command", command: claudeHookCommand(reg.command) };

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

  return { settings: next, status: hasSuperseded ? "migrate" : "create" };
}

function migrateCommandInPlace(
  settings: Record<string, unknown>,
  reg: HookRegistration,
  options: HookCommandOptions = {},
): { settings: Record<string, unknown>; status: HookSyncStatus } {
  const entries = getEventEntries(settings, reg.event) ?? [];
  // When the current form is already registered, a rewrite would run the
  // hook twice; the bare entry is removed instead.
  const alreadyCurrent = hookCommandRegistered(settings, reg, options);
  let changed = false;
  const eventList = entries
    .map((entry) => {
      if (!Array.isArray(entry.hooks)) return entry;
      if (!entry.hooks.some((h) => h.command === reg.command)) return entry;
      changed = true;
      const hooks = alreadyCurrent
        ? entry.hooks.filter((h) => h.command !== reg.command)
        : entry.hooks.map((h) =>
            h.command === reg.command
              ? { ...h, command: claudeHookCommand(reg.command) }
              : h,
          );
      return { ...entry, hooks };
    })
    .filter((entry) => !Array.isArray(entry.hooks) || entry.hooks.length > 0);
  if (!changed) return { settings, status: "noop" };
  const hooksRoot = { ...((settings["hooks"] as Record<string, unknown>) ?? {}) };
  hooksRoot[reg.event] = eventList;
  return { settings: { ...settings, hooks: hooksRoot }, status: "migrate" };
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
    const next = ensureHookRegistration(settings, reg, { projectRoot });
    settings = next.settings;
    if (next.status !== "noop") changed = true;
    // A user-modified hook that needed no migration is not an anamnesis
    // registration, so it stays out of the reported results.
    if (reg.migrateOnly && next.status === "noop") continue;
    results.push({ registration: reg, status: next.status });
  }
  if (changed) writeSettings(projectRoot, settings);
  return { results, changed };
}
