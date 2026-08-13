import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { sha256 } from "../util/hash.js";
import {
  appendWorkLedger,
  appendWorkLedgerUnlocked,
  type AppendWorkLedgerResult,
  type WorkLedgerEvent,
  withWorkLedgerLock,
} from "./work_ledger.js";

export const WORK_SOURCE_EVENT_SCHEMA_VERSION = "anamnesis.work-source.v1";

export type WorkCaptureFidelity =
  | "native_exact"
  | "client_exact"
  | "agent_observed";

export interface WorkStateRoot {
  project_root: string;
  state_root: string;
  worktree_root: string;
  worktree_fingerprint: string;
  source: "project" | "git-primary-worktree" | "override";
}

export interface WorkSourceEventInput {
  stateRoot: string;
  eventId: string;
  capturedAt: string;
  client: string;
  contentType: string;
  fidelity: WorkCaptureFidelity;
  allocationStatus: string;
  body: string | Buffer;
  attachmentRefs?: readonly string[];
}

export interface WorkSourceEventEnvelope {
  schema_version: typeof WORK_SOURCE_EVENT_SCHEMA_VERSION;
  event_id: string;
  captured_at: string;
  client: string;
  content_type: string;
  fidelity: WorkCaptureFidelity;
  allocation_status: string;
  object_hash: string;
  object_path: string;
  attachment_refs: string[];
}

export interface PublishedWorkSourceEvent {
  envelope: WorkSourceEventEnvelope;
  envelope_path: string;
  object_path: string;
  created: boolean;
}

export type WorkStoragePublicationPhase =
  | "body-temp-written"
  | "body-temp-synced"
  | "body-renamed"
  | "body-directory-synced"
  | "envelope-temp-written"
  | "envelope-temp-synced"
  | "envelope-renamed"
  | "envelope-directory-synced";

export interface WorkStorageOptions {
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  onSourceLockAcquired?: () => void;
  onPublicationPhase?: (phase: WorkStoragePublicationPhase) => void;
}

interface SourceLockOwner {
  schema_version: "anamnesis.work-source-lock.v1";
  nonce: string;
  pid: number;
  process_start: string;
}

export interface PublishAndAppendWorkSourceEventInput {
  source: WorkSourceEventInput;
  ledgerPath: string;
  ledgerEvent: Omit<WorkLedgerEvent, "payload"> & {
    payload?: Record<string, unknown>;
  };
  expectedHead: string | null;
}

export interface PublishAndAppendWorkSourceEventOptions
  extends WorkStorageOptions {
  ledgerLockTimeoutMs?: number;
  ledgerLockRetryMs?: number;
  onSourcePublished?: (source: PublishedWorkSourceEvent) => void;
  onBeforeLedgerSync?: AppendParameters["onBeforeLedgerSync"];
}

type AppendParameters = Parameters<typeof appendWorkLedger>[0];

export interface PublishedWorkSourceAllocation {
  source: PublishedWorkSourceEvent;
  ledger: AppendWorkLedgerResult;
}

const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 10;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function resolveWorkStateRoot(
  projectRoot: string,
  override?: string,
): WorkStateRoot {
  const resolvedProject = realDirectory(projectRoot, "project root");
  if (override !== undefined) {
    const stateRoot = path.resolve(resolvedProject, override);
    const worktreeRoot = resolveGitWorktreeRoot(resolvedProject) ?? resolvedProject;
    return stateRootResult(
      resolvedProject,
      stateRoot,
      worktreeRoot,
      "override",
    );
  }

  const worktreeRoot = resolveGitWorktreeRoot(resolvedProject);
  if (!worktreeRoot) {
    return stateRootResult(
      resolvedProject,
      path.join(resolvedProject, ".anamnesis"),
      resolvedProject,
      "project",
    );
  }

  const primaryRoot = resolvePrimaryWorktree(resolvedProject);
  return stateRootResult(
    resolvedProject,
    path.join(primaryRoot, ".anamnesis"),
    worktreeRoot,
    primaryRoot === worktreeRoot ? "project" : "git-primary-worktree",
  );
}

export function worktreeFingerprint(worktreeRoot: string): string {
  const canonical = realDirectory(worktreeRoot, "worktree root");
  return sha256(`anamnesis-worktree-v1\0${canonical}`);
}

export function publishWorkSourceEvent(
  input: WorkSourceEventInput,
  options: WorkStorageOptions = {},
): PublishedWorkSourceEvent {
  assertSafeId(input.eventId, "event ID");
  const stateRoot = secureStateRoot(input.stateRoot);
  managedDescendant(stateRoot, path.join("work-inputs", "objects", `${input.eventId}.txt`));
  managedDescendant(stateRoot, path.join("work-inputs", "events", `${input.eventId}.yaml`));
  const lockPath = managedDescendant(
    stateRoot,
    path.join("work-inputs", ".locks", input.eventId),
  );

  return withWorkSourceEventLock(lockPath, options, () => {
    return publishWorkSourceEventUnlocked(input, options, stateRoot);
  });
}

function publishWorkSourceEventUnlocked(
  input: WorkSourceEventInput,
  options: WorkStorageOptions,
  stateRoot: string,
): PublishedWorkSourceEvent {
  const objectRelative = path.join("work-inputs", "objects", `${input.eventId}.txt`);
  const envelopeRelative = path.join("work-inputs", "events", `${input.eventId}.yaml`);
  const objectPath = managedDescendant(stateRoot, objectRelative);
  const envelopePath = managedDescendant(stateRoot, envelopeRelative);
  const body = Buffer.isBuffer(input.body) ? Buffer.from(input.body) : Buffer.from(input.body, "utf8");
  const envelope: WorkSourceEventEnvelope = {
    schema_version: WORK_SOURCE_EVENT_SCHEMA_VERSION,
    event_id: input.eventId,
    captured_at: input.capturedAt,
    client: input.client,
    content_type: input.contentType,
    fidelity: input.fidelity,
    allocation_status: input.allocationStatus,
    object_hash: sha256(body),
    object_path: objectRelative.split(path.sep).join("/"),
    attachment_refs: [...(input.attachmentRefs ?? [])],
  };
  const envelopeBytes = Buffer.from(`${canonicalJson(envelope)}\n`, "utf8");
    const objectExists = fs.existsSync(objectPath);
    const envelopeExists = fs.existsSync(envelopePath);
    if (envelopeExists && !objectExists) {
        throw new Error(`source event ${input.eventId} is partially published`);
    }
    if (objectExists) {
      if (!readFileNoFollow(objectPath).equals(body)) {
        throw new Error(`source event ID collision for ${input.eventId}`);
      }
      fs.chmodSync(objectPath, 0o600);
      fsyncDirectory(path.dirname(objectPath));
    }
    if (envelopeExists) {
      if (!readFileNoFollow(envelopePath).equals(envelopeBytes)) {
        throw new Error(`source event envelope collision for ${input.eventId}`);
      }
      fs.chmodSync(envelopePath, 0o600);
      fsyncDirectory(path.dirname(envelopePath));
      return {
        envelope,
        envelope_path: envelopePath,
        object_path: objectPath,
        created: false,
      };
    }

    if (!objectExists) {
      durablePublish(
        objectPath,
        body,
        "body",
        options.onPublicationPhase,
      );
    }
    durablePublish(
      envelopePath,
      envelopeBytes,
      "envelope",
      options.onPublicationPhase,
    );
    return {
      envelope,
      envelope_path: envelopePath,
      object_path: objectPath,
      created: true,
    };
}

export function publishAndAppendWorkSourceEvent(
  input: PublishAndAppendWorkSourceEventInput,
  options: PublishAndAppendWorkSourceEventOptions = {},
): PublishedWorkSourceAllocation {
  assertSafeId(input.source.eventId, "event ID");
  const stateRoot = secureStateRoot(input.source.stateRoot);
  const lockPath = managedDescendant(
    stateRoot,
    path.join("work-inputs", ".locks", input.source.eventId),
  );
  return withWorkSourceEventLock(lockPath, options, () => {
    const source = publishWorkSourceEventUnlocked(input.source, options, stateRoot);
    options.onSourcePublished?.(source);
    const payload = {
      ...(input.ledgerEvent.payload ?? {}),
      source_event_id: source.envelope.event_id,
      source_object_hash: source.envelope.object_hash,
      source_object_path: source.envelope.object_path,
    };
    const appendOptions: AppendParameters = {
      ledgerPath: input.ledgerPath,
      event: { ...input.ledgerEvent, payload },
      expectedHead: input.expectedHead,
      sourcePrecondition: () => assertPublishedWorkSourceEvent(source),
      onBeforeLedgerSync: options.onBeforeLedgerSync,
    };
    const ledger = withWorkLedgerLock(
      input.ledgerPath,
      {
        lockTimeoutMs: options.ledgerLockTimeoutMs,
        lockRetryMs: options.ledgerLockRetryMs,
      },
      () => appendWorkLedgerUnlocked(appendOptions),
    );
    return { source, ledger };
  });
}

export function assertPublishedWorkSourceEvent(
  published: PublishedWorkSourceEvent,
): void {
  let body: Buffer;
  let envelopeBytes: Buffer;
  try {
    body = readFileNoFollow(published.object_path);
    envelopeBytes = readFileNoFollow(published.envelope_path);
  } catch (error) {
    throw new Error(`source event ${published.envelope.event_id} is not published`, {
      cause: error,
    });
  }
  if (sha256(body) !== published.envelope.object_hash) {
    throw new Error(`source event ${published.envelope.event_id} object hash mismatch`);
  }
  const expectedEnvelope = Buffer.from(
    `${canonicalJson(published.envelope)}\n`,
    "utf8",
  );
  if (!envelopeBytes.equals(expectedEnvelope)) {
    throw new Error(`source event ${published.envelope.event_id} envelope mismatch`);
  }
}

function resolveGitWorktreeRoot(projectRoot: string): string | undefined {
  try {
    const inside = git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") return undefined;
    return realDirectory(
      git(projectRoot, ["rev-parse", "--show-toplevel"]),
      "Git worktree root",
    );
  } catch (error) {
    if (findGitMarker(projectRoot)) {
      throw new Error("cannot establish canonical Git worktree state root", {
        cause: error,
      });
    }
    return undefined;
  }
}

function findGitMarker(start: string): boolean {
  let current = start;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function resolvePrimaryWorktree(projectRoot: string): string {
  let output: string;
  try {
    output = git(projectRoot, ["worktree", "list", "--porcelain"]);
  } catch (error) {
    throw new Error("cannot establish canonical Git worktree state root", {
      cause: error,
    });
  }
  const first = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  if (!first) {
    throw new Error("cannot establish canonical Git worktree state root");
  }
  return realDirectory(first, "primary Git worktree root");
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function stateRootResult(
  projectRoot: string,
  stateRoot: string,
  worktreeRoot: string,
  source: WorkStateRoot["source"],
): WorkStateRoot {
  return {
    project_root: projectRoot,
    state_root: path.resolve(stateRoot),
    worktree_root: worktreeRoot,
    worktree_fingerprint: worktreeFingerprint(worktreeRoot),
    source,
  };
}

function realDirectory(candidate: string, label: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync(candidate);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${candidate}`, { cause: error });
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`${label} is not a directory: ${candidate}`);
  }
  return resolved;
}

function durablePublish(
  destination: string,
  content: Buffer,
  kind: "body" | "envelope",
  hook?: (phase: WorkStoragePublicationPhase) => void,
): void {
  const directory = path.dirname(destination);
  ensurePrivateDirectories(directory);
  assertNoSymlinkPath(destination, true);
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${randomSuffix()}.tmp`,
  );
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    writeAll(fd, content);
    hook?.(`${kind}-temp-written`);
    fs.fsyncSync(fd);
    hook?.(`${kind}-temp-synced`);
    fs.closeSync(fd);
    fd = undefined;
    if (fs.existsSync(destination)) throw new Error(`immutable Work file already exists: ${destination}`);
    fs.renameSync(temporary, destination);
    hook?.(`${kind}-renamed`);
    fsyncDirectory(directory);
    hook?.(`${kind}-directory-synced`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

function writeAll(fd: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.length) {
    offset += fs.writeSync(fd, content, offset, content.length - offset);
  }
}

function fsyncDirectory(directory: string): void {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | noFollowFlag());
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function withWorkSourceEventLock<T>(
  lockPath: string,
  options: WorkStorageOptions,
  operation: () => T,
): T {
  ensurePrivateDirectories(path.dirname(lockPath));
  assertNoSymlinkPath(lockPath, true);
  const timeout = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retry = options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
  const deadline = Date.now() + timeout;
  const owner = currentSourceLockOwner();
  while (true) {
    if (tryAcquireSourceLock(lockPath, owner)) break;
    reclaimDeadSourceLock(lockPath);
    if (Date.now() >= deadline) {
      throw new Error(`timed out acquiring source-event lock: ${lockPath}`);
    }
    sleepSync(retry);
  }
  try {
    options.onSourceLockAcquired?.();
    return operation();
  } finally {
    releaseSourceLock(lockPath, owner);
  }
}

function secureStateRoot(stateRoot: string): string {
  const lexical = path.resolve(stateRoot);
  const parent = fs.realpathSync(path.dirname(lexical));
  const absolute = path.join(parent, path.basename(lexical));
  ensurePrivateDirectories(absolute);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`managed Work state root is not a real directory: ${absolute}`);
  }
  return absolute;
}

function managedDescendant(root: string, relative: string): string {
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`managed Work path escapes state root: ${relative}`);
  }
  assertNoSymlinkPath(candidate, true);
  return candidate;
}

function ensurePrivateDirectories(directory: string): void {
  const missing: string[] = [];
  let current = path.resolve(directory);
  while (!fs.existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const trusted = fs.realpathSync(current);
  current = trusted;
  for (const item of missing.reverse()) fs.mkdirSync(item, 0o700);
}

function assertNoSymlinkPath(candidate: string, allowMissingFinal: boolean): void {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`managed Work path contains a symbolic link: ${current}`);
    } catch (error) {
      if (isMissing(error) && allowMissingFinal) return;
      throw error;
    }
  }
}

function noFollowFlag(): number {
  return fs.constants.O_NOFOLLOW ?? 0;
}

function readFileNoFollow(filePath: string): Buffer {
  assertNoSymlinkPath(filePath, false);
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollowFlag());
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`managed Work file is not regular: ${filePath}`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function currentSourceLockOwner(): SourceLockOwner {
  return {
    schema_version: "anamnesis.work-source-lock.v1",
    nonce: randomBytes(16).toString("hex"),
    pid: process.pid,
    process_start: processStartIdentity(process.pid),
  };
}

function processStartIdentity(pid: number): string {
  return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function tryAcquireSourceLock(lockPath: string, owner: SourceLockOwner): boolean {
  try {
    fs.mkdirSync(lockPath, 0o700);
  } catch (error) {
    if (isExists(error)) return false;
    throw error;
  }
  try {
    const ownerPath = path.join(lockPath, "owner.json");
    const fd = fs.openSync(
      ownerPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag(),
      0o600,
    );
    try {
      writeAll(fd, Buffer.from(`${JSON.stringify(owner)}\n`, "utf8"));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fsyncDirectory(lockPath);
    fsyncDirectory(path.dirname(lockPath));
    return true;
  } catch (error) {
    fs.rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }
}

function reclaimDeadSourceLock(lockPath: string): void {
  let owner: SourceLockOwner;
  try {
    const value = JSON.parse(readFileNoFollow(path.join(lockPath, "owner.json")).toString("utf8"));
    if (!isSourceLockOwner(value)) return;
    owner = value;
  } catch {
    return;
  }
  let provenDead = false;
  try {
    process.kill(owner.pid, 0);
    try {
      provenDead = processStartIdentity(owner.pid) !== owner.process_start;
    } catch {
      return;
    }
  } catch (error) {
    if (!isErrno(error, "ESRCH")) return;
    provenDead = true;
  }
  if (!provenDead) return;
  const quarantine = `${lockPath}.dead-${owner.nonce}`;
  try {
    fs.renameSync(lockPath, quarantine);
    fs.rmSync(quarantine, { recursive: true });
    fsyncDirectory(path.dirname(lockPath));
  } catch {
    // A concurrent reclaimer won.
  }
}

function releaseSourceLock(lockPath: string, owner: SourceLockOwner): void {
  const ownerPath = path.join(lockPath, "owner.json");
  let current: unknown;
  try {
    current = JSON.parse(readFileNoFollow(ownerPath).toString("utf8"));
  } catch {
    throw new Error(`cannot verify source-event lock ownership: ${lockPath}`);
  }
  if (!isSourceLockOwner(current) || current.nonce !== owner.nonce) {
    throw new Error(`source-event lock ownership changed: ${lockPath}`);
  }
  fs.unlinkSync(ownerPath);
  fs.rmdirSync(lockPath);
  fsyncDirectory(path.dirname(lockPath));
}

function isSourceLockOwner(value: unknown): value is SourceLockOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Partial<SourceLockOwner>;
  return owner.schema_version === "anamnesis.work-source-lock.v1" &&
    typeof owner.nonce === "string" && /^[a-f0-9]{32}$/.test(owner.nonce) &&
    Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.process_start === "string" && owner.process_start.length > 0;
}

function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function randomSuffix(): string {
  return Math.random().toString(16).slice(2);
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`invalid ${label}: ${value}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported JSON value: ${typeof value}`);
}

function isMissing(error: unknown): boolean {
  return isErrno(error, "ENOENT");
}

function isExists(error: unknown): boolean {
  return isErrno(error, "EEXIST");
}

function isErrno(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
