import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isHash, sha256 } from "../util/hash.js";

export const WORK_LEDGER_SCHEMA_VERSION = "anamnesis.work-ledger.v1";

export interface WorkLedgerEvent {
  event_id: string;
  occurred_at: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface WorkLedgerRecord extends WorkLedgerEvent {
  schema_version: typeof WORK_LEDGER_SCHEMA_VERSION;
  previous_hash: string | null;
  record_hash: string;
}

export interface WorkLedgerReadResult {
  records: WorkLedgerRecord[];
  head: string | null;
  valid_bytes: number;
}

export interface AppendWorkLedgerOptions {
  ledgerPath: string;
  event: WorkLedgerEvent;
  expectedHead: string | null;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  onBeforeLedgerSync?: (record: WorkLedgerRecord) => void;
}

export interface WorkLedgerLockOptions {
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

interface WorkLockOwner {
  schema_version: "anamnesis.work-lock.v1";
  nonce: string;
  pid: number;
  process_start: string;
}

export interface AppendWorkLedgerResult {
  record: WorkLedgerRecord;
  head: string;
  idempotent: boolean;
}

export interface RecoverWorkLedgerOptions {
  ledgerPath: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface RecoverWorkLedgerResult extends WorkLedgerReadResult {
  recovered: boolean;
  truncated_bytes: number;
}

const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 10;

export function readWorkLedger(ledgerPath: string): WorkLedgerReadResult {
  const safePath = secureManagedFilePath(ledgerPath, false);
  if (!safePath) {
    return { records: [], head: null, valid_bytes: 0 };
  }
  const bytes = readFileNoFollow(safePath);
  if (bytes.length === 0) {
    return { records: [], head: null, valid_bytes: 0 };
  }
  if (bytes.at(-1) !== 0x0a) {
    throw new Error("work ledger has an uncommitted non-newline final tail");
  }
  return validateCommittedBytes(bytes);
}

export function validateWorkLedger(ledgerPath: string): WorkLedgerReadResult {
  return readWorkLedger(ledgerPath);
}

export function appendWorkLedger(
  options: AppendWorkLedgerOptions,
): AppendWorkLedgerResult {
  assertWorkLedgerEvent(options.event);
  if (hasSourceReference(options.event.payload)) {
    throw new Error(
      "source-referencing work ledger events require the official source publication API",
    );
  }
  return withWorkLedgerLock(options.ledgerPath, options, () =>
    appendWorkLedgerUnlocked(options),
  );
}

function appendWorkLedgerUnlocked(
  options: AppendWorkLedgerOptions,
): AppendWorkLedgerResult {
    const ledgerPath = secureManagedFilePath(options.ledgerPath, true)!;
    const current = readWorkLedger(ledgerPath);
    const duplicate = current.records.find(
      (record) => record.event_id === options.event.event_id,
    );
    if (duplicate) {
      if (!sameEvent(duplicate, options.event)) {
        throw new Error(`work ledger event ID collision: ${options.event.event_id}`);
      }
      return {
        record: duplicate,
        head: current.head!,
        idempotent: true,
      };
    }
    if (current.head !== options.expectedHead) {
      throw new Error(
        `work ledger head conflict: expected ${options.expectedHead ?? "null"}, actual ${current.head ?? "null"}`,
      );
    }
    assertTypedSemanticValidationBoundary(current.records, options.event);
    const unsigned = {
      schema_version: WORK_LEDGER_SCHEMA_VERSION,
      event_id: options.event.event_id,
      occurred_at: options.event.occurred_at,
      kind: options.event.kind,
      payload: options.event.payload,
      previous_hash: current.head,
    } as const;
    const record: WorkLedgerRecord = {
      ...unsigned,
      record_hash: sha256(Buffer.from(canonicalJson(unsigned), "utf8")),
    };
    const line = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
    const fd = fs.openSync(
      ledgerPath,
      fs.constants.O_WRONLY |
        fs.constants.O_APPEND |
        fs.constants.O_CREAT |
        noFollowFlag(),
      0o600,
    );
    try {
      fs.fchmodSync(fd, 0o600);
      options.onBeforeLedgerSync?.(record);
      writeAll(fd, line);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fsyncDirectory(path.dirname(ledgerPath));
    return { record, head: record.record_hash, idempotent: false };
}

const TYPED_WORK_SCHEMAS = new Set([
  "anamnesis.work-contract-event.v1",
  "anamnesis.work-progress-event.v1",
  "anamnesis.work-lifecycle-event.v1",
]);
const WORK_SEMANTIC_KINDS = new Set([
  "work_created",
  "contract_revised",
  "work_contract_revised",
  "requirement_added",
  "requirement_recorded",
  "requirement_status_changed",
  "requirement_transitioned",
  "work_requirement_transitioned",
  "requirement_superseded",
  "work_lifecycle_changed",
  "lifecycle_changed",
  "conflict_recorded",
  "conflict_resolved",
]);

function assertTypedSemanticValidationBoundary(
  records: readonly WorkLedgerRecord[],
  event: WorkLedgerEvent,
): void {
  const created = records.find((record) => record.kind === "work_created");
  const currentTyped = created ? isTypedWorkPayload(created.payload) : false;
  const incomingTyped = isTypedWorkPayload(event.payload);
  if (incomingTyped || (currentTyped && WORK_SEMANTIC_KINDS.has(event.kind))) {
    throw new Error(
      "typed Work semantic events require the typed Work append API",
    );
  }
}

function isTypedWorkPayload(payload: Record<string, unknown>): boolean {
  return TYPED_WORK_SCHEMAS.has(String(payload.schema_version ?? ""));
}

function hasSourceReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSourceReference);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      key === "source_event_id" ||
      key === "source_event_ids" ||
	  key === "source_envelope_hash" ||
	  key === "source_envelope_bindings" ||
      key === "source_object_hash" ||
      key === "source_object_path" ||
      hasSourceReference(item),
  );
}

export function recoverWorkLedger(
  options: RecoverWorkLedgerOptions,
): RecoverWorkLedgerResult {
  return withWorkLedgerLock(options.ledgerPath, options, () => {
    const ledgerPath = secureManagedFilePath(options.ledgerPath, false);
    if (!ledgerPath) {
      return {
        records: [],
        head: null,
        valid_bytes: 0,
        recovered: false,
        truncated_bytes: 0,
      };
    }
    const bytes = readFileNoFollow(ledgerPath);
    if (bytes.length === 0 || bytes.at(-1) === 0x0a) {
      const result = validateCommittedBytes(bytes);
      return { ...result, recovered: false, truncated_bytes: 0 };
    }

    const lastNewline = bytes.lastIndexOf(0x0a);
    const validBytes = lastNewline + 1;
    const committed = bytes.subarray(0, validBytes);
    const result = validateCommittedBytes(committed);
    const fd = fs.openSync(
      ledgerPath,
      fs.constants.O_RDWR | noFollowFlag(),
    );
    try {
      fs.ftruncateSync(fd, validBytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fsyncDirectory(path.dirname(ledgerPath));
    return {
      ...result,
      recovered: true,
      truncated_bytes: bytes.length - validBytes,
    };
  });
}

export function canonicalWorkLedgerRecord(record: WorkLedgerRecord): string {
  return canonicalJson(record);
}

function validateCommittedBytes(bytes: Buffer): WorkLedgerReadResult {
  if (bytes.length === 0) {
    return { records: [], head: null, valid_bytes: 0 };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("work ledger contains invalid UTF-8", { cause: error });
  }
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new Error("work ledger UTF-8 byte roundtrip mismatch");
  }
  const records: WorkLedgerRecord[] = [];
  const eventIds = new Set<string>();
  let previous: string | null = null;
  const lines = text.split("\n");
  lines.pop();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.length === 0) {
      throw new Error(`invalid empty work ledger record at line ${index + 1}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid work ledger JSON at line ${index + 1}`, {
        cause: error,
      });
    }
    if (!isWorkLedgerRecord(value)) {
      throw new Error(`invalid work ledger record at line ${index + 1}`);
    }
    if (canonicalJson(value) !== line) {
      throw new Error(`non-canonical work ledger record at line ${index + 1}`);
    }
    if (value.previous_hash !== previous) {
      throw new Error(`work ledger chain mismatch at line ${index + 1}`);
    }
    const { record_hash: recordHash, ...unsigned } = value;
    if (sha256(Buffer.from(canonicalJson(unsigned), "utf8")) !== recordHash) {
      throw new Error(`work ledger record hash mismatch at line ${index + 1}`);
    }
    if (eventIds.has(value.event_id)) {
      throw new Error(`duplicate committed work ledger event ID: ${value.event_id}`);
    }
    eventIds.add(value.event_id);
    records.push(value);
    previous = value.record_hash;
  }
  return { records, head: previous, valid_bytes: bytes.length };
}

function isWorkLedgerRecord(value: unknown): value is WorkLedgerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<WorkLedgerRecord>;
  return (
    record.schema_version === WORK_LEDGER_SCHEMA_VERSION &&
    typeof record.event_id === "string" &&
    record.event_id.trim().length > 0 &&
    typeof record.occurred_at === "string" &&
    record.occurred_at.trim().length > 0 &&
    typeof record.kind === "string" &&
    record.kind.trim().length > 0 &&
    !!record.payload &&
    typeof record.payload === "object" &&
    !Array.isArray(record.payload) &&
    (record.previous_hash === null || isHash(record.previous_hash)) &&
    isHash(record.record_hash)
  );
}

export function assertWorkLedgerEvent(event: WorkLedgerEvent): void {
  if (
    typeof event.event_id !== "string" || event.event_id.trim().length === 0 ||
    typeof event.occurred_at !== "string" || event.occurred_at.trim().length === 0 ||
    typeof event.kind !== "string" || event.kind.trim().length === 0
  ) {
    throw new Error("work ledger event requires event_id, occurred_at, and kind");
  }
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error("work ledger event payload must be an object");
  }
  canonicalJson(event.payload);
}

function sameEvent(record: WorkLedgerRecord, event: WorkLedgerEvent): boolean {
  return (
    record.event_id === event.event_id &&
    record.occurred_at === event.occurred_at &&
    record.kind === event.kind &&
    canonicalJson(record.payload) === canonicalJson(event.payload)
  );
}

export function withWorkLedgerLock<T>(
  ledgerPath: string,
  options: WorkLedgerLockOptions,
  operation: () => T,
): T {
  const safeLedgerPath = secureManagedFilePath(ledgerPath, true)!;
  const lockPath = `${safeLedgerPath}.lock`;
  const owner = currentLockOwner();
  const deadline = Date.now() + (options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  const retry = options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
  while (true) {
    if (tryAcquireDurableLock(lockPath, owner)) break;
    reclaimDeadLock(lockPath);
    if (Date.now() >= deadline) {
      throw new Error(`timed out acquiring work ledger lock: ${lockPath}`);
    }
    sleepSync(retry);
  }
  try {
    return operation();
  } finally {
    releaseDurableLock(lockPath, owner);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported JSON value: ${typeof value}`);
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

function secureManagedFilePath(
  filePath: string,
  createParents: boolean,
): string | undefined {
  const lexical = path.resolve(filePath);
  const parsed = path.parse(lexical);
  const lexicalParts = lexical.slice(parsed.root.length).split(path.sep).filter(Boolean);
  if (lexicalParts.length === 0) throw new Error("managed Work file path is invalid");
  const trustedPrefix = fs.realpathSync(path.join(parsed.root, lexicalParts[0]!));
  const parts = lexicalParts.slice(1);
  const absolute = path.join(trustedPrefix, ...parts);
  let current = trustedPrefix;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    const final = index === parts.length - 1;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
      if (final) return createParents ? absolute : undefined;
      if (!createParents) return undefined;
      fs.mkdirSync(current, 0o700);
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`managed Work path contains a symbolic link: ${current}`);
    }
    if (!final && !stat.isDirectory()) {
      throw new Error(`managed Work path ancestor is not a directory: ${current}`);
    }
    if (final && !stat.isFile()) {
      throw new Error(`managed Work file is not a regular file: ${current}`);
    }
  }
  return absolute;
}

function readFileNoFollow(filePath: string): Buffer {
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollowFlag());
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`managed Work file is not regular: ${filePath}`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function noFollowFlag(): number {
  return fs.constants.O_NOFOLLOW ?? 0;
}

function currentLockOwner(): WorkLockOwner {
  return {
    schema_version: "anamnesis.work-lock.v1",
    nonce: randomBytes(16).toString("hex"),
    pid: process.pid,
    process_start: processStartIdentity(process.pid),
  };
}

function processStartIdentity(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    throw new Error(`cannot establish process-start identity for PID ${pid}`, {
      cause: error,
    });
  }
}

function tryAcquireDurableLock(lockPath: string, owner: WorkLockOwner): boolean {
  try {
    fs.mkdirSync(lockPath, 0o700);
  } catch (error) {
    if (isErrno(error, "EEXIST")) return false;
    throw error;
  }
  try {
    const ownerPath = path.join(lockPath, "owner.json");
    const fd = fs.openSync(
      ownerPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        noFollowFlag(),
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
    try {
      fs.rmSync(lockPath, { recursive: true });
    } catch {
      // The original acquisition error remains authoritative.
    }
    throw error;
  }
}

function reclaimDeadLock(lockPath: string): void {
  let owner: WorkLockOwner;
  try {
    const value = JSON.parse(readFileNoFollow(path.join(lockPath, "owner.json")).toString("utf8"));
    if (!isLockOwner(value)) return;
    owner = value;
  } catch {
    return;
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (!isErrno(error, "ESRCH")) return;
    const quarantine = `${lockPath}.dead-${owner.nonce}`;
    try {
      fs.renameSync(lockPath, quarantine);
      fs.rmSync(quarantine, { recursive: true });
      fsyncDirectory(path.dirname(lockPath));
    } catch (renameError) {
      if (!isErrno(renameError, "ENOENT")) return;
    }
    return;
  }
  let currentStart: string;
  try {
    currentStart = processStartIdentity(owner.pid);
  } catch {
    return;
  }
  if (currentStart === owner.process_start) return;
  const quarantine = `${lockPath}.dead-${owner.nonce}`;
  try {
    fs.renameSync(lockPath, quarantine);
    fs.rmSync(quarantine, { recursive: true });
    fsyncDirectory(path.dirname(lockPath));
  } catch {
    // A concurrent owner/reclaimer won; retry acquisition normally.
  }
}

function releaseDurableLock(lockPath: string, owner: WorkLockOwner): void {
  let current: WorkLockOwner;
  try {
    current = JSON.parse(
      readFileNoFollow(path.join(lockPath, "owner.json")).toString("utf8"),
    ) as WorkLockOwner;
  } catch {
    throw new Error(`cannot verify Work lock ownership before release: ${lockPath}`);
  }
  if (!isLockOwner(current) || current.nonce !== owner.nonce) {
    throw new Error(`Work lock ownership changed before release: ${lockPath}`);
  }
  fs.unlinkSync(path.join(lockPath, "owner.json"));
  fs.rmdirSync(lockPath);
  fsyncDirectory(path.dirname(lockPath));
}

function isLockOwner(value: unknown): value is WorkLockOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Partial<WorkLockOwner>;
  return (
    owner.schema_version === "anamnesis.work-lock.v1" &&
    typeof owner.nonce === "string" &&
    /^[a-f0-9]{32}$/.test(owner.nonce) &&
    Number.isSafeInteger(owner.pid) &&
    (owner.pid ?? 0) > 0 &&
    typeof owner.process_start === "string" &&
    owner.process_start.length > 0
  );
}

function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function isErrno(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
