// Codex native hook registration helpers.
//
// Codex native hooks are configured through two project/user-owned files:
//   * .codex/config.toml  -> enables [features].codex_hooks
//   * .codex/hooks.json   -> registers command hooks
//
// anamnesis owns only the command entries that point at its generated wrapper
// scripts. User hooks in the same JSON file are preserved.

import * as fs from "node:fs";
import * as path from "node:path";

export const CODEX_CONFIG_PATH = ".codex/config.toml";
export const CODEX_HOOKS_PATH = ".codex/hooks.json";

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

export function codexHooksFeatureEnabled(content: string): boolean {
  return /^\s*codex_hooks\s*=\s*true\s*(?:#.*)?$/m.test(
    featureSection(content),
  );
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
    return [...prefix, "[features]", "codex_hooks = true", ""].join("\n");
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\s*\[.+\]\s*(?:#.*)?$/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }

  const existingFlagIndex = lines
    .slice(sectionStart + 1, sectionEnd)
    .findIndex((line) => /^\s*codex_hooks\s*=/.test(line));

  if (existingFlagIndex >= 0) {
    lines[sectionStart + 1 + existingFlagIndex] = "codex_hooks = true";
  } else {
    let insertAt = sectionEnd;
    while (insertAt > sectionStart + 1 && lines[insertAt - 1]?.trim() === "") {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, "codex_hooks = true");
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
  const basename = path.posix.basename(reg.command.replace(/\\/g, "/"));
  return new RegExp(`(?:^|[\\\\/])${escapeRegExp(basename)}(?:["'\\s]|$)`);
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
