// Codex native hook registration helpers.
//
// Codex native hooks are configured through two project/user-owned files:
//   * .codex/config.toml  -> enables [features].hooks
//   * .codex/hooks.json   -> registers command hooks
//
// anamnesis owns only the command entries that point at its generated wrapper
// scripts. User hooks in the same JSON file are preserved.

import * as fs from "node:fs";
import * as path from "node:path";

export const CODEX_CONFIG_PATH = ".codex/config.toml";
export const CODEX_HOOKS_PATH = ".codex/hooks.json";
export const CODEX_HOOKS_FEATURE_TARGET =
  `${CODEX_CONFIG_PATH} [features.hooks=true]`;

export interface CodexHookRegistration {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
  statusMessage?: string;
}

export type CodexHookSyncStatus = "create" | "noop";

export interface CodexHookSyncResult {
  registration: CodexHookRegistration;
  status: CodexHookSyncStatus;
}

export type CodexHookOwner = "anamnesis" | "omx" | "plugin" | "user" | "invalid";

export interface CodexHookOwnershipEntry {
  event: string;
  matcher?: string;
  entryIndex: number;
  hookIndex: number;
  type?: string;
  command?: string;
  owner: CodexHookOwner;
}

export type CodexHookOwnershipWarningKind =
  | "duplicate-command"
  | "relative-managed-command"
  | "stale-managed-command"
  | "malformed-entry";

export interface CodexHookOwnershipWarning {
  kind: CodexHookOwnershipWarningKind;
  event?: string;
  matcher?: string;
  command?: string;
  detail: string;
}

export interface CodexHookOwnershipReport {
  readable: boolean;
  parseError?: string;
  entries: CodexHookOwnershipEntry[];
  warnings: CodexHookOwnershipWarning[];
  summary: Record<CodexHookOwner, number> & {
    total: number;
    duplicates: number;
    warnings: number;
  };
}

export interface CodexHookOwnershipOptions {
  projectRoot?: string;
}

type JsonObject = Record<string, unknown>;

interface MatcherEntry {
  matcher?: string;
  hooks?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

export function codexConfigPath(projectRoot: string): string {
  return path.join(projectRoot, CODEX_CONFIG_PATH);
}

export function codexHooksPath(projectRoot: string): string {
  return path.join(projectRoot, CODEX_HOOKS_PATH);
}

export function codexNativeNodeCommand(scriptPath: string): string {
  const normalized = scriptPath.replace(/\\/g, "/");
  return `sh -lc 'root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; exec node "$root/${normalized}"'`;
}

export function codexHooksFeatureEnabled(content: string): boolean {
  return /^\s*hooks\s*=\s*true\s*(?:#.*)?$/m.test(
    featureSection(content),
  );
}

export function analyzeCodexHookOwnership(
  content: string | null | undefined,
  opts: CodexHookOwnershipOptions = {},
): CodexHookOwnershipReport {
  const entries: CodexHookOwnershipEntry[] = [];
  const warnings: CodexHookOwnershipWarning[] = [];
  const emptySummary = (): CodexHookOwnershipReport["summary"] => ({
    total: 0,
    anamnesis: 0,
    omx: 0,
    plugin: 0,
    user: 0,
    invalid: 0,
    duplicates: 0,
    warnings: 0,
  });

  if (typeof content !== "string") {
    return {
      readable: false,
      parseError: `${CODEX_HOOKS_PATH} is missing`,
      entries,
      warnings,
      summary: emptySummary(),
    };
  }

  const parsed = readJsonObject(content);
  if (!parsed) {
    return {
      readable: false,
      parseError: `${CODEX_HOOKS_PATH} is not valid JSON object content`,
      entries,
      warnings,
      summary: emptySummary(),
    };
  }

  if (!isPlainObject(parsed.hooks)) {
    return {
      readable: true,
      entries,
      warnings,
      summary: emptySummary(),
    };
  }

  for (const [event, eventEntries] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(eventEntries)) {
      warnings.push({
        kind: "malformed-entry",
        event,
        detail: `hooks.${event} is not an array`,
      });
      entries.push({
        event,
        entryIndex: 0,
        hookIndex: 0,
        owner: "invalid",
      });
      continue;
    }

    eventEntries.forEach((entry, entryIndex) => {
      if (!isPlainObject(entry)) {
        warnings.push({
          kind: "malformed-entry",
          event,
          detail: `hooks.${event}[${entryIndex}] is not an object`,
        });
        entries.push({
          event,
          entryIndex,
          hookIndex: 0,
          owner: "invalid",
        });
        return;
      }

      const matcher =
        typeof entry.matcher === "string" ? entry.matcher : undefined;
      if (!Array.isArray(entry.hooks)) {
        warnings.push({
          kind: "malformed-entry",
          event,
          matcher,
          detail: `hooks.${event}[${entryIndex}].hooks is not an array`,
        });
        entries.push({
          event,
          matcher,
          entryIndex,
          hookIndex: 0,
          owner: "invalid",
        });
        return;
      }

      entry.hooks.forEach((hook, hookIndex) => {
        if (!isPlainObject(hook)) {
          warnings.push({
            kind: "malformed-entry",
            event,
            matcher,
            detail: `hooks.${event}[${entryIndex}].hooks[${hookIndex}] is not an object`,
          });
          entries.push({
            event,
            matcher,
            entryIndex,
            hookIndex,
            owner: "invalid",
          });
          return;
        }

        const type = typeof hook.type === "string" ? hook.type : undefined;
        const command =
          typeof hook.command === "string" ? hook.command : undefined;
        const owner = classifyCodexHookOwner(command, type);
        entries.push({
          event,
          matcher,
          entryIndex,
          hookIndex,
          type,
          command,
          owner,
        });

        if (
          owner === "anamnesis" &&
          command !== undefined &&
          codexManagedCommandIsRelative(command)
        ) {
          warnings.push({
            kind: "relative-managed-command",
            event,
            matcher,
            command,
            detail:
              "anamnesis-managed Codex hook command uses a relative project path; refresh it so it resolves from the Git root.",
          });
        }
        if (
          owner === "anamnesis" &&
          command !== undefined &&
          opts.projectRoot !== undefined
        ) {
          const relPath = managedAnamnesisHookRelPath(command);
          if (
            relPath !== null &&
            !fs.existsSync(path.join(opts.projectRoot, relPath))
          ) {
            warnings.push({
              kind: "stale-managed-command",
              event,
              matcher,
              command,
              detail: `anamnesis-managed Codex hook command points to missing ${relPath}`,
            });
          }
        }
      });
    });
  }

  const seen = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.command) continue;
    const key = [
      entry.event,
      entry.matcher ?? "",
      entry.command,
    ].join("\u0000");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count < 2) continue;
    const [event, matcher, command] = key.split("\u0000");
    warnings.push({
      kind: "duplicate-command",
      event,
      matcher: matcher || undefined,
      command,
      detail: `Codex hook command is registered ${count} times for ${event}${matcher ? `:${matcher}` : ""}`,
    });
  }

  const summary = emptySummary();
  for (const entry of entries) {
    summary.total += 1;
    summary[entry.owner] += 1;
  }
  summary.duplicates = warnings.filter((w) => w.kind === "duplicate-command")
    .length;
  summary.warnings = warnings.length;

  return {
    readable: true,
    entries,
    warnings,
    summary,
  };
}

function classifyCodexHookOwner(
  command: string | undefined,
  type: string | undefined,
): CodexHookOwner {
  if (type !== undefined && type !== "command") return "user";
  if (!command) return "user";
  const normalized = command.replace(/\\/g, "/");
  if (
    normalized.includes(".anamnesis/codex-native-hooks/") ||
    normalized.includes(".anamnesis/codex-hooks/")
  ) {
    return "anamnesis";
  }
  if (
    normalized.includes("oh-my-codex") ||
    normalized.includes("codex-native-hook.js") ||
    normalized.includes("/.omx/") ||
    /\bomx(\s|$)/.test(normalized)
  ) {
    return "omx";
  }
  if (
    normalized.includes(".codex-plugin/") ||
    normalized.includes(".codex/plugins/") ||
    normalized.includes("plugin://")
  ) {
    return "plugin";
  }
  return "user";
}

function codexManagedCommandIsRelative(command: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  return (
    normalized.includes(".anamnesis/codex-native-hooks/") &&
    !normalized.includes("git rev-parse --show-toplevel") &&
    !normalized.includes("$root/.anamnesis/")
  );
}

function managedAnamnesisHookRelPath(command: string): string | null {
  const normalized = command.replace(/\\/g, "/");
  const match = normalized.match(
    /(\.anamnesis\/(?:codex-native-hooks|codex-hooks)\/[^"'\s;]+)/,
  );
  return match?.[1] ?? null;
}

export function upsertCodexHooksFeatureFlag(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const sectionStart = lines.findIndex((line) =>
    /^\s*\[features\]\s*(?:#.*)?$/.test(line),
  );

  if (sectionStart < 0) {
    const prefix = lines.length > 0 ? [...lines, ""] : [];
    return [...prefix, "[features]", "hooks = true", ""].join("\n");
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\s*\[.+\]\s*(?:#.*)?$/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }

  for (let i = sectionEnd - 1; i > sectionStart; i -= 1) {
    if (/^\s*codex_hooks\s*=/.test(lines[i]!)) {
      lines.splice(i, 1);
      sectionEnd -= 1;
    }
  }

  const existingFlagIndex = lines
    .slice(sectionStart + 1, sectionEnd)
    .findIndex((line) => /^\s*hooks\s*=/.test(line));

  if (existingFlagIndex >= 0) {
    lines[sectionStart + 1 + existingFlagIndex] = "hooks = true";
  } else {
    let insertAt = sectionEnd;
    while (insertAt > sectionStart + 1 && lines[insertAt - 1]?.trim() === "") {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, "hooks = true");
  }

  return `${lines.join("\n")}\n`;
}

function featureSection(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) =>
    /^\s*\[features\]\s*(?:#.*)?$/.test(line),
  );
  if (start < 0) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s*\[.+\]\s*(?:#.*)?$/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

function readJsonObject(content: string): JsonObject | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function managedCommandPattern(reg: CodexHookRegistration): RegExp {
  const basename =
    managedAnamnesisHookBasename(reg.command) ??
    path.posix.basename(reg.command.replace(/\\/g, "/"));
  return new RegExp(`(?:^|[\\\\/])${escapeRegExp(basename)}(?:["'\\s]|$)`);
}

function managedAnamnesisHookBasename(command: string): string | null {
  const normalized = command.replace(/\\/g, "/");
  const match = normalized.match(
    /\.anamnesis\/(?:codex-native-hooks|codex-hooks)\/([^"'\s;]+)/,
  );
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hookCommand(reg: CodexHookRegistration): Record<string, unknown> {
  return {
    type: "command",
    command: reg.command,
    ...(reg.statusMessage ? { statusMessage: reg.statusMessage } : {}),
    ...(typeof reg.timeout === "number" ? { timeout: reg.timeout } : {}),
  };
}

function hookEntry(reg: CodexHookRegistration): MatcherEntry {
  return {
    ...(reg.matcher ? { matcher: reg.matcher } : {}),
    hooks: [hookCommand(reg)],
  };
}

function stripManagedHooksFromEntry(
  entry: unknown,
  reg: CodexHookRegistration,
): { entry: unknown | null; removedCount: number } {
  if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) {
    return { entry: cloneJson(entry), removedCount: 0 };
  }

  const pattern = managedCommandPattern(reg);
  const nextHooks = entry.hooks.filter((hook) => {
    if (!isPlainObject(hook)) return true;
    return !(
      hook.type === "command" &&
      typeof hook.command === "string" &&
      pattern.test(hook.command)
    );
  });
  const removedCount = entry.hooks.length - nextHooks.length;
  if (removedCount === 0) {
    return { entry: cloneJson(entry), removedCount: 0 };
  }
  if (nextHooks.length === 0) {
    return { entry: null, removedCount };
  }
  return {
    entry: {
      ...cloneJson(entry),
      hooks: nextHooks,
    },
    removedCount,
  };
}

export function mergeCodexHookRegistration(
  existingContent: string | null | undefined,
  reg: CodexHookRegistration,
): { content: string; status: CodexHookSyncStatus } {
  const parsed =
    typeof existingContent === "string" ? readJsonObject(existingContent) : null;
  const root = parsed ? cloneJson(parsed) : {};
  const hooksRoot = isPlainObject(root.hooks) ? cloneJson(root.hooks) : {};
  const rawEntries = hooksRoot[reg.event];
  const existingEntries: unknown[] = Array.isArray(rawEntries)
    ? rawEntries
    : [];

  let removedCount = 0;
  const preservedEntries: unknown[] = [];
  for (const entry of existingEntries) {
    const stripped = stripManagedHooksFromEntry(entry, reg);
    removedCount += stripped.removedCount;
    if (stripped.entry !== null) preservedEntries.push(stripped.entry);
  }

  hooksRoot[reg.event] = [...preservedEntries, hookEntry(reg)];
  root.hooks = hooksRoot;

  const content = JSON.stringify(root, null, 2) + "\n";
  const existingMatches =
    typeof existingContent === "string" &&
    codexHookRegistrationPresent(existingContent, reg);
  return {
    content,
    status: existingMatches && removedCount === 1 ? "noop" : "create",
  };
}

export function codexHookRegistrationPresent(
  content: string,
  reg: CodexHookRegistration,
): boolean {
  const parsed = readJsonObject(content);
  if (!parsed || !isPlainObject(parsed.hooks)) return false;
  const entries = parsed.hooks[reg.event];
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    if ((entry.matcher ?? undefined) !== (reg.matcher ?? undefined)) continue;
    if (!Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (!isPlainObject(hook)) continue;
      if (hook.type === "command" && hook.command === reg.command) return true;
    }
  }
  return false;
}

export function syncCodexNativeHookRegistrations(
  projectRoot: string,
  registrations: CodexHookRegistration[],
): { results: CodexHookSyncResult[]; changed: boolean } {
  if (registrations.length === 0) return { results: [], changed: false };

  const configFile = codexConfigPath(projectRoot);
  const existingConfig = fs.existsSync(configFile)
    ? fs.readFileSync(configFile, "utf8")
    : "";
  const nextConfig = upsertCodexHooksFeatureFlag(existingConfig);
  let changed = nextConfig !== existingConfig;
  if (nextConfig !== existingConfig) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, nextConfig, "utf8");
  }

  const hooksFile = codexHooksPath(projectRoot);
  let hooksContent: string | null = null;
  if (fs.existsSync(hooksFile)) {
    hooksContent = fs.readFileSync(hooksFile, "utf8");
    JSON.parse(hooksContent);
  }
  const results: CodexHookSyncResult[] = [];

  for (const reg of registrations) {
    const merged = mergeCodexHookRegistration(hooksContent, reg);
    results.push({ registration: reg, status: merged.status });
    if (merged.content !== hooksContent) {
      changed = true;
      hooksContent = merged.content;
    }
  }

  if (hooksContent !== null) {
    fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
    fs.writeFileSync(hooksFile, hooksContent, "utf8");
  }

  return { results, changed };
}
