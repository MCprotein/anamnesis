import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  analyzeCodexHookOwnership,
  codexNativeNodeCommand,
  codexHooksPath,
  type CodexHookOwnershipEntry,
  type CodexHookOwnershipReport,
} from "./codex_native.js";
import { readManifest } from "./manifest.js";
import { sha256 } from "../util/hash.js";

export type CodexRuntimeHookTrustStatus =
  | "managed"
  | "untrusted"
  | "trusted"
  | "modified";

export type CodexHookTrustStatus = CodexRuntimeHookTrustStatus | "unknown";

export type CodexHookSource =
  | "system"
  | "user"
  | "project"
  | "mdm"
  | "sessionFlags"
  | "plugin"
  | "cloudRequirements"
  | "cloudManagedConfig"
  | "legacyManagedConfigFile"
  | "legacyManagedConfigMdm"
  | "unknown";

export interface CodexCommandHookMetadata {
  key: string;
  eventName: string;
  matcher: string | null;
  sourcePath: string;
  source: CodexHookSource;
  pluginId: string | null;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: CodexRuntimeHookTrustStatus;
  handlerType: "command";
  command: string;
  [key: string]: unknown;
}

export interface CodexNonCommandHookMetadata {
  key: string;
  eventName: string;
  matcher: string | null;
  sourcePath: string;
  source: CodexHookSource;
  pluginId: string | null;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: CodexRuntimeHookTrustStatus;
  handlerType: "mcpTool" | "prompt" | "agent";
  [key: string]: unknown;
}

export type CodexRuntimeHookMetadata =
  | CodexCommandHookMetadata
  | CodexNonCommandHookMetadata;

export interface CodexHooksListEntry {
  cwd: string;
  hooks: CodexRuntimeHookMetadata[];
  warnings: string[];
  errors: unknown[];
}

export interface CodexHooksListResponse {
  data: CodexHooksListEntry[];
}

export interface CodexConfigBatchWriteParams {
  edits: Array<{
    keyPath: string;
    value: Record<string, { trusted_hash: string }>;
    mergeStrategy: "upsert";
  }>;
  expectedVersion: string;
  reloadUserConfig: true;
}

export interface CodexConfigReadResponse {
  layers: Array<{
    name: { type: string; profile?: string | null; [key: string]: unknown };
    version: string;
    config: unknown;
    disabledReason: string | null;
  }> | null;
  [key: string]: unknown;
}

export interface CodexAppServerTransport {
  listHooks(cwds: string[]): Promise<CodexHooksListResponse>;
  readConfig(cwd: string): Promise<CodexConfigReadResponse>;
  batchWrite(params: CodexConfigBatchWriteParams): Promise<unknown>;
  close?(): Promise<void>;
}

export interface CodexHookTrustDiagnostic {
  event: string;
  matcher?: string;
  command: string;
  registered: true;
  runtimeDiscovered: boolean;
  status: CodexHookTrustStatus;
  key?: string;
  currentHash?: string;
  sourcePath?: string;
  source?: CodexHookSource;
  enabled?: boolean;
  isManaged?: boolean;
  authorizedForTrust: boolean;
}

export interface CodexAlternateProjectSource {
  sourcePath: string;
  hooks: Array<{
    key: string;
    eventName: string;
    command: string;
    trustStatus: CodexRuntimeHookTrustStatus;
  }>;
}

export interface CodexHookTrustSummary {
  registered: number;
  discovered: number;
  trusted: number;
  untrusted: number;
  modified: number;
  managed: number;
  unknown: number;
}

export interface CodexHookTrustInspection {
  available: boolean;
  localHooksPath: string;
  ownership: CodexHookOwnershipReport;
  hooks: CodexHookTrustDiagnostic[];
  summary: CodexHookTrustSummary;
  alternateProjectSources: CodexAlternateProjectSource[];
  warnings: string[];
  error?: string;
}

export interface InspectCodexHookTrustOptions {
  transport?: CodexAppServerTransport;
  timeoutMs?: number;
}

export interface TrustCodexHooksOptions extends InspectCodexHookTrustOptions {
  apply: boolean;
}

export interface CodexHookTrustTarget {
  key: string;
  event: string;
  matcher?: string;
  command: string;
  currentHash: string;
  sourcePath: string;
  source: CodexHookSource;
  status: "untrusted" | "modified";
}

export interface TrustCodexHooksResult {
  mode: "dry-run" | "apply";
  inspection: CodexHookTrustInspection;
  targets: CodexHookTrustTarget[];
  written: CodexHookTrustTarget[];
  skipped: CodexHookTrustDiagnostic[];
  verification?: CodexHookTrustInspection;
}

export type CodexHookTrustApprovalOutcome =
  | "review"
  | "unavailable"
  | "not-needed"
  | "complete"
  | "incomplete";

export function codexHookTrustApprovalOutcome(
  result: TrustCodexHooksResult,
): CodexHookTrustApprovalOutcome {
  if (result.mode === "dry-run") return "review";
  if (!result.inspection.available) return "unavailable";
  if (result.targets.length === 0) {
    const summary = result.inspection.summary;
    return summary.untrusted === 0 && summary.modified === 0 && summary.unknown === 0
      ? "not-needed"
      : "incomplete";
  }
  if (result.verification?.available !== true) return "incomplete";
  const complete = result.targets.every((target) => {
    const verified = result.verification?.hooks.find(
      (hook) => hook.key === target.key,
    );
    return verified?.status === "trusted" || verified?.status === "managed";
  });
  return complete ? "complete" : "incomplete";
}

export class CodexHookTrustUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexHookTrustUnavailableError";
  }
}

export class CodexHookTrustChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexHookTrustChangedError";
  }
}

interface JsonRpcResponse {
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface CodexStdioTransportOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxStderrBytes?: number;
}

/**
 * Minimal line-delimited JSON-RPC transport for Codex 0.151 app-server.
 * It deliberately exposes only the two RPCs needed by hook trust management.
 */
export class CodexStdioAppServerTransport implements CodexAppServerTransport {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd?: string;
  private readonly timeoutMs: number;
  private readonly maxStderrBytes: number;
  private child?: ChildProcessWithoutNullStreams;
  private startPromise?: Promise<void>;
  private stdoutBuffer = "";
  private stderr = "";
  private nextId = 1;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(options: CodexStdioTransportOptions = {}) {
    this.command = options.command ?? "codex";
    this.args = options.args ?? ["app-server", "--stdio"];
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxStderrBytes = options.maxStderrBytes ?? 16_384;
  }

  async listHooks(cwds: string[]): Promise<CodexHooksListResponse> {
    const result = await this.request("hooks/list", { cwds });
    return parseHooksListResponse(result);
  }

  async batchWrite(params: CodexConfigBatchWriteParams): Promise<unknown> {
    return this.request("config/batchWrite", params);
  }

  async readConfig(cwd: string): Promise<CodexConfigReadResponse> {
    const result = await this.request("config/read", {
      cwd,
      includeLayers: true,
    });
    if (!isObject(result) || !Array.isArray(result.layers)) {
      throw new CodexHookTrustUnavailableError(
        "Codex app-server config/read did not return configuration layers",
      );
    }
    return result as unknown as CodexConfigReadResponse;
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 250);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureStarted();
    return this.rawRequest(method, params);
  }

  private async ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start();
    return this.startPromise;
  }

  private async start(): Promise<void> {
    if (this.closed) {
      throw new CodexHookTrustUnavailableError("Codex app-server transport is closed");
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.command, this.args, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      throw unavailable("Could not start Codex app-server", error);
    }
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-this.maxStderrBytes);
    });
    child.on("error", (error) => {
      this.failAll(unavailable("Codex app-server process error", error));
    });
    child.on("exit", (code, signal) => {
      if (this.closed) return;
      const detail = this.stderr.trim();
      this.failAll(
        new CodexHookTrustUnavailableError(
          `Codex app-server exited before completing the request (code=${code ?? "null"}, signal=${signal ?? "null"})${detail ? `: ${detail}` : ""}`,
        ),
      );
    });

    await this.rawRequest("initialize", {
      clientInfo: { name: "anamnesis", version: "1" },
      capabilities: null,
    });
    this.writeMessage({ method: "initialized" });
  }

  private rawRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CodexHookTrustUnavailableError(
            `Codex app-server ${method} timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.writeMessage({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(unavailable(`Could not send Codex app-server ${method}`, error));
      }
    });
  }

  private writeMessage(message: unknown): void {
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new CodexHookTrustUnavailableError("Codex app-server stdin is unavailable");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch (error) {
        this.failAll(unavailable("Codex app-server returned malformed JSON", error));
        this.child?.kill("SIGTERM");
        return;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new CodexHookTrustUnavailableError(
            `Codex app-server RPC failed${typeof message.error.code === "number" ? ` (${message.error.code})` : ""}: ${message.error.message ?? "unknown error"}`,
          ),
        );
      } else if (Object.hasOwn(message, "result")) {
        pending.resolve(message.result);
      } else {
        pending.reject(
          new CodexHookTrustUnavailableError(
            "Codex app-server returned a response without result or error",
          ),
        );
      }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function inspectCodexHookTrust(
  projectRoot: string,
  options: InspectCodexHookTrustOptions = {},
): Promise<CodexHookTrustInspection> {
  const localHooksPath = codexHooksPath(path.resolve(projectRoot));
  const ownership = readOwnership(localHooksPath, projectRoot);
  const transport =
    options.transport ??
    new CodexStdioAppServerTransport({
      cwd: projectRoot,
      timeoutMs: options.timeoutMs,
    });
  const ownsTransport = options.transport === undefined;
  try {
    const response = await transport.listHooks([path.resolve(projectRoot)]);
    return analyzeCodexHookTrust({
      projectRoot,
      ownership,
      response,
      authorizedLocalEntries: authorizedLocalEntries(projectRoot, ownership),
    });
  } catch (error) {
    return unavailableInspection(localHooksPath, ownership, error);
  } finally {
    if (ownsTransport) await transport.close?.();
  }
}

export interface AnalyzeCodexHookTrustInput {
  projectRoot: string;
  ownership: CodexHookOwnershipReport;
  response: CodexHooksListResponse;
  authorizedLocalEntries?: ReadonlySet<string>;
}

export function analyzeCodexHookTrust(
  input: AnalyzeCodexHookTrustInput,
): CodexHookTrustInspection {
  const projectRoot = path.resolve(input.projectRoot);
  const localHooksPath = codexHooksPath(projectRoot);
  const localHooks = input.ownership.entries.filter(isAnamnesisCommand);
  const responseEntry = selectResponseEntry(input.response, projectRoot);
  const runtimeHooks = responseEntry?.hooks ?? [];
  const localRuntimeHooks = runtimeHooks.filter(
    (hook): hook is CodexCommandHookMetadata =>
      hook.handlerType === "command" && hook.sourcePath === localHooksPath,
  );
  const hooks = localHooks.map((local) => {
    const runtime = localRuntimeHooks.find((candidate) =>
      runtimeMatchesLocal(candidate, local)
    );
    if (!runtime) return unknownDiagnostic(local);
    return runtimeDiagnostic(
      local,
      runtime,
      input.authorizedLocalEntries?.has(localEntryIdentity(local)) === true &&
        runtime.source === "project" &&
        runtime.pluginId === null,
    );
  });

  const alternateBySource = new Map<string, CodexCommandHookMetadata[]>();
  for (const runtime of runtimeHooks) {
    if (
      runtime.handlerType !== "command" ||
      runtime.source !== "project" ||
      runtime.sourcePath === localHooksPath ||
      !localHooks.some((local) => runtimeMatchesLocal(runtime, local))
    ) {
      continue;
    }
    const existing = alternateBySource.get(runtime.sourcePath) ?? [];
    existing.push(runtime);
    alternateBySource.set(runtime.sourcePath, existing);
  }
  const alternateProjectSources = [...alternateBySource].map(
    ([sourcePath, alternateHooks]) => ({
      sourcePath,
      hooks: alternateHooks.map((hook) => ({
        key: hook.key,
        eventName: hook.eventName,
        command: hook.command,
        trustStatus: normalizedRuntimeStatus(hook),
      })),
    }),
  );

  const warnings = [...(responseEntry?.warnings ?? [])];
  if (localHooks.length > 0 && hooks.every((hook) => !hook.runtimeDiscovered)) {
    warnings.push(
      alternateProjectSources.length > 0
        ? "This worktree's .codex/hooks.json exists but Codex did not discover it as a separate runtime source; project hooks from another worktree were discovered instead."
        : "This worktree's .codex/hooks.json exists but Codex did not discover its Anamnesis hooks at runtime.",
    );
  }
  if ((responseEntry?.errors.length ?? 0) > 0) {
    warnings.push("Codex reported one or more hook discovery errors.");
  }
  if (hooks.some((hook) => hook.runtimeDiscovered && !hook.authorizedForTrust)) {
    warnings.push(
      "One or more hook commands resemble Anamnesis hooks but are not manifest-backed regular files owned by this project; they are diagnostic-only and cannot be trusted by Anamnesis.",
    );
  }

  return {
    available: true,
    localHooksPath,
    ownership: input.ownership,
    hooks,
    summary: summarize(hooks),
    alternateProjectSources,
    warnings,
  };
}

export async function trustCodexHooks(
  projectRoot: string,
  options: TrustCodexHooksOptions,
): Promise<TrustCodexHooksResult> {
  const transport =
    options.transport ??
    new CodexStdioAppServerTransport({
      cwd: projectRoot,
      timeoutMs: options.timeoutMs,
    });
  const ownsTransport = options.transport === undefined;
  try {
    const inspection = await inspectWithTransport(projectRoot, transport);
    const targets = trustTargets(inspection);
    if (!options.apply || targets.length === 0) {
      return {
        mode: options.apply ? "apply" : "dry-run",
        inspection,
        targets,
        written: [],
        skipped: inspection.hooks.filter((hook) =>
          hook.status === "trusted" || hook.status === "managed"
        ),
      };
    }

    const config = await transport.readConfig(path.resolve(projectRoot));
    const userLayer = config.layers?.find(
      (layer) =>
        layer.name.type === "user" &&
        (layer.name.profile === null || layer.name.profile === undefined),
    );
    if (!userLayer || typeof userLayer.version !== "string") {
      throw new CodexHookTrustUnavailableError(
        "Codex config/read did not expose the base user configuration version; no trust state was written.",
      );
    }

    // Keep this re-list immediately adjacent to the version-checked write.
    // Hook identity/hash drift aborts before config/batchWrite, while the
    // expectedVersion below independently rejects concurrent config changes.
    const refreshed = await inspectWithTransport(projectRoot, transport);
    if (!refreshed.available) {
      throw new CodexHookTrustChangedError(
        "Codex hook trust state became unavailable before write; review and retry.",
      );
    }
    const refreshedByKey = new Map(
      refreshed.hooks.filter((hook) => hook.key).map((hook) => [hook.key!, hook]),
    );
    const writable: CodexHookTrustTarget[] = [];
    const skipped: CodexHookTrustDiagnostic[] = [];
    for (const target of targets) {
      const current = refreshedByKey.get(target.key);
      if (!current) {
        throw changed(target, "was no longer discovered from the local hooks file");
      }
      if (current.status === "trusted" || current.status === "managed") {
        skipped.push(current);
        continue;
      }
      if (
        current.authorizedForTrust !== true ||
        current.status !== target.status ||
        current.currentHash !== target.currentHash ||
        current.command !== target.command ||
        current.sourcePath !== target.sourcePath ||
        current.source !== target.source ||
        current.event !== target.event
      ) {
        throw changed(target, "changed after review");
      }
      writable.push(target);
    }

    if (writable.length === 0) {
      return {
        mode: "apply",
        inspection,
        targets,
        written: [],
        skipped,
        verification: refreshed,
      };
    }

    await transport.batchWrite({
      edits: [
        {
          keyPath: "hooks.state",
          value: Object.fromEntries(
            writable.map((target) => [
              target.key,
              { trusted_hash: target.currentHash },
            ]),
          ),
          mergeStrategy: "upsert",
        },
      ],
      expectedVersion: userLayer.version,
      reloadUserConfig: true,
    });

    const verification = await inspectWithTransport(projectRoot, transport);
    for (const target of writable) {
      const verified = verification.hooks.find((hook) => hook.key === target.key);
      if (!verified || (verified.status !== "trusted" && verified.status !== "managed")) {
        throw new CodexHookTrustChangedError(
          `Codex did not report ${target.key} as trusted after config/batchWrite.`,
        );
      }
    }
    return {
      mode: "apply",
      inspection,
      targets,
      written: writable,
      skipped,
      verification,
    };
  } finally {
    if (ownsTransport) await transport.close?.();
  }
}

async function inspectWithTransport(
  projectRoot: string,
  transport: CodexAppServerTransport,
): Promise<CodexHookTrustInspection> {
  const localHooksPath = codexHooksPath(path.resolve(projectRoot));
  const ownership = readOwnership(localHooksPath, projectRoot);
  try {
    const response = await transport.listHooks([path.resolve(projectRoot)]);
    return analyzeCodexHookTrust({
      projectRoot,
      ownership,
      response,
      authorizedLocalEntries: authorizedLocalEntries(projectRoot, ownership),
    });
  } catch (error) {
    return unavailableInspection(localHooksPath, ownership, error);
  }
}

function readOwnership(
  localHooksPath: string,
  projectRoot: string,
): CodexHookOwnershipReport {
  const content = fs.existsSync(localHooksPath)
    ? fs.readFileSync(localHooksPath, "utf8")
    : null;
  return analyzeCodexHookOwnership(content, { projectRoot });
}

function authorizedLocalEntries(
  projectRoot: string,
  ownership: CodexHookOwnershipReport,
): ReadonlySet<string> {
  let trackedPaths: Map<string, string>;
  try {
    trackedPaths = new Map(
      readManifest(projectRoot).files.map((file) => [
        file.path,
        file.last_applied_hash,
      ]),
    );
  } catch {
    return new Set();
  }
  const authorized = new Set<string>();
  for (const entry of ownership.entries.filter(isAnamnesisCommand)) {
    const relativePath = exactManagedHookPath(entry.command);
    const expectedHash = relativePath ? trackedPaths.get(relativePath) : undefined;
    if (
      !relativePath ||
      !expectedHash ||
      entry.command !== codexNativeNodeCommand(relativePath)
    ) {
      continue;
    }
    const absolutePath = path.join(projectRoot, relativePath);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    if (sha256(fs.readFileSync(absolutePath)) !== expectedHash) continue;
    authorized.add(localEntryIdentity(entry));
  }
  return authorized;
}

function exactManagedHookPath(command: string): string | null {
  const normalizedCommand = command.replace(/\\/g, "/");
  const matches = [
    ...normalizedCommand.matchAll(
      /(\.anamnesis\/codex-native-hooks\/[^"'\s;]+)/g,
    ),
  ];
  if (matches.length !== 1 || !matches[0]?.[1]) return null;
  const candidate = matches[0][1];
  const normalizedPath = path.posix.normalize(candidate);
  if (
    normalizedPath !== candidate ||
    !normalizedPath.startsWith(".anamnesis/codex-native-hooks/")
  ) {
    return null;
  }
  return normalizedPath;
}

function localEntryIdentity(
  entry: CodexHookOwnershipEntry & { command: string },
): string {
  return [entry.event, entry.matcher ?? "", entry.command].join("\u0000");
}

function isAnamnesisCommand(
  entry: CodexHookOwnershipEntry,
): entry is CodexHookOwnershipEntry & { command: string } {
  return entry.owner === "anamnesis" && typeof entry.command === "string";
}

function runtimeMatchesLocal(
  runtime: CodexCommandHookMetadata,
  local: CodexHookOwnershipEntry & { command: string },
): boolean {
  return (
    runtime.eventName === runtimeEventName(local.event) &&
    runtime.matcher === (local.matcher ?? null) &&
    runtime.command === local.command
  );
}

function runtimeEventName(localEvent: string): string {
  const names: Record<string, string> = {
    PreToolUse: "preToolUse",
    PermissionRequest: "permissionRequest",
    PostToolUse: "postToolUse",
    PreCompact: "preCompact",
    PostCompact: "postCompact",
    SessionStart: "sessionStart",
    SessionEnd: "sessionEnd",
    UserPromptSubmit: "userPromptSubmit",
    SubagentStart: "subagentStart",
    SubagentStop: "subagentStop",
    Stop: "stop",
    Interrupt: "interrupt",
  };
  return names[localEvent] ?? localEvent;
}

function normalizedRuntimeStatus(
  hook: CodexRuntimeHookMetadata,
): CodexRuntimeHookTrustStatus {
  return hook.isManaged ? "managed" : hook.trustStatus;
}

function runtimeDiagnostic(
  local: CodexHookOwnershipEntry & { command: string },
  runtime: CodexCommandHookMetadata,
  authorizedForTrust: boolean,
): CodexHookTrustDiagnostic {
  return {
    event: local.event,
    ...(local.matcher ? { matcher: local.matcher } : {}),
    command: local.command,
    registered: true,
    runtimeDiscovered: true,
    status: normalizedRuntimeStatus(runtime),
    key: runtime.key,
    currentHash: runtime.currentHash,
    sourcePath: runtime.sourcePath,
    source: runtime.source,
    enabled: runtime.enabled,
    isManaged: runtime.isManaged,
    authorizedForTrust,
  };
}

function unknownDiagnostic(
  local: CodexHookOwnershipEntry & { command: string },
): CodexHookTrustDiagnostic {
  return {
    event: local.event,
    ...(local.matcher ? { matcher: local.matcher } : {}),
    command: local.command,
    registered: true,
    runtimeDiscovered: false,
    status: "unknown",
    authorizedForTrust: false,
  };
}

function unavailableInspection(
  localHooksPath: string,
  ownership: CodexHookOwnershipReport,
  error: unknown,
): CodexHookTrustInspection {
  const hooks = ownership.entries.filter(isAnamnesisCommand).map(unknownDiagnostic);
  const message = error instanceof Error ? error.message : String(error);
  return {
    available: false,
    localHooksPath,
    ownership,
    hooks,
    summary: summarize(hooks),
    alternateProjectSources: [],
    warnings: [
      "Codex hook trust RPC is unavailable; inspect trust in Codex and approve manually if this Codex version does not support hooks/list and config/batchWrite.",
    ],
    error: message,
  };
}

function summarize(hooks: CodexHookTrustDiagnostic[]): CodexHookTrustSummary {
  const summary: CodexHookTrustSummary = {
    registered: hooks.length,
    discovered: 0,
    trusted: 0,
    untrusted: 0,
    modified: 0,
    managed: 0,
    unknown: 0,
  };
  for (const hook of hooks) {
    if (hook.runtimeDiscovered) summary.discovered += 1;
    summary[hook.status] += 1;
  }
  return summary;
}

function trustTargets(inspection: CodexHookTrustInspection): CodexHookTrustTarget[] {
  if (!inspection.available) return [];
  return inspection.hooks.flatMap((hook) => {
    if (
      (hook.status !== "untrusted" && hook.status !== "modified") ||
      !hook.runtimeDiscovered ||
      !hook.authorizedForTrust ||
      !hook.key ||
      !hook.currentHash ||
      !hook.sourcePath ||
      !hook.source
    ) {
      return [];
    }
    return [
      {
        key: hook.key,
        event: hook.event,
        ...(hook.matcher ? { matcher: hook.matcher } : {}),
        command: hook.command,
        currentHash: hook.currentHash,
        sourcePath: hook.sourcePath,
        source: hook.source,
        status: hook.status,
      },
    ];
  });
}

function selectResponseEntry(
  response: CodexHooksListResponse,
  projectRoot: string,
): CodexHooksListEntry | undefined {
  return response.data.find((entry) => path.resolve(entry.cwd) === projectRoot) ??
    response.data[0];
}

function parseHooksListResponse(value: unknown): CodexHooksListResponse {
  if (!isObject(value) || !Array.isArray(value.data)) {
    throw new CodexHookTrustUnavailableError(
      "Codex app-server hooks/list returned an unsupported response",
    );
  }
  for (const entry of value.data) {
    if (
      !isObject(entry) ||
      typeof entry.cwd !== "string" ||
      !Array.isArray(entry.hooks) ||
      !Array.isArray(entry.warnings) ||
      !Array.isArray(entry.errors)
    ) {
      throw new CodexHookTrustUnavailableError(
        "Codex app-server hooks/list returned malformed data",
      );
    }
    for (const hook of entry.hooks) {
      if (!validRuntimeHook(hook)) {
        throw new CodexHookTrustUnavailableError(
          "Codex app-server hooks/list returned unsupported hook metadata",
        );
      }
    }
  }
  return value as unknown as CodexHooksListResponse;
}

function validRuntimeHook(value: unknown): value is CodexRuntimeHookMetadata {
  if (!isObject(value)) return false;
  const common =
    typeof value.key === "string" &&
    typeof value.eventName === "string" &&
    (typeof value.matcher === "string" || value.matcher === null) &&
    typeof value.sourcePath === "string" &&
    typeof value.source === "string" &&
    (typeof value.pluginId === "string" || value.pluginId === null) &&
    typeof value.enabled === "boolean" &&
    typeof value.isManaged === "boolean" &&
    typeof value.currentHash === "string" &&
    ["managed", "untrusted", "trusted", "modified"].includes(
      String(value.trustStatus),
    );
  if (!common) return false;
  return value.handlerType === "command"
    ? typeof value.command === "string"
    : ["mcpTool", "prompt", "agent"].includes(String(value.handlerType));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable(message: string, cause: unknown): CodexHookTrustUnavailableError {
  return new CodexHookTrustUnavailableError(message, {
    cause: cause instanceof Error ? cause : undefined,
  });
}

function changed(target: CodexHookTrustTarget, detail: string): CodexHookTrustChangedError {
  return new CodexHookTrustChangedError(
    `Codex hook ${target.key} ${detail}; no trust state was written. Review the new hook definition and retry.`,
  );
}
