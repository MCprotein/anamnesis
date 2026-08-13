import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { sha256 } from "../util/hash.js";
import {
  type AppendWorkLedgerResult,
  type WorkLedgerEvent,
  type WorkLedgerRecord,
  WORK_LEDGER_SCHEMA_VERSION,
  assertWorkLedgerEvent,
  readWorkLedger,
  withWorkLedgerLock,
} from "./work_ledger.js";
import { parseTypedWorkEvent, validateWorkEventAppend } from "./work_contract.js";

export const WORK_SOURCE_EVENT_SCHEMA_VERSION = "anamnesis.work-source.v1";
export const SOURCE_ENVELOPE_BINDINGS_SCHEMA_VERSION =
	"anamnesis.source-envelope-bindings.v1" as const;

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

export interface MigrateLegacyWorkSourceEnvelopeBindingsInput {
	stateRoot: string;
	ledgerPath: string;
	eventId: string;
	occurredAt: string;
	expectedHead: string | null;
}

interface AppendParameters {
  ledgerPath: string;
  event: WorkLedgerEvent;
  expectedHead: string | null;
  onBeforeLedgerSync?: (record: WorkLedgerRecord) => void;
}

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
	return publishAndAppendWorkSourceEventInternal(input, options, false);
}

/** Official source-first typed publication path with fixed canonical validation. */
export function publishAndAppendCanonicalTypedWorkSourceEvent(
	input: PublishAndAppendWorkSourceEventInput,
	options: PublishAndAppendWorkSourceEventOptions = {},
): PublishedWorkSourceAllocation {
	return publishAndAppendWorkSourceEventInternal(input, options, true);
}

/**
 * Explicit TOFU migration for pre-binding ledgers. The operator authorizes the
 * currently published canonical envelopes as the one-time historical baseline.
 */
export function migrateLegacyWorkSourceEnvelopeBindings(
	input: MigrateLegacyWorkSourceEnvelopeBindingsInput,
	options: WorkStorageOptions = {},
): AppendWorkLedgerResult {
	assertSafeId(input.eventId, "ledger event ID");
	assertWorkLedgerEvent({ event_id: input.eventId, occurred_at: input.occurredAt, kind: "source_envelope_bindings_migrated", payload: {} });
	const stateRoot = secureStateRoot(input.stateRoot);
	const snapshot = readWorkLedger(input.ledgerPath);
	if (snapshot.head !== input.expectedHead)
		throw new Error(`work ledger head conflict: expected ${input.expectedHead ?? "null"}, actual ${snapshot.head ?? "null"}`);
	const referencedIds = new Set<string>();
	const existingBindings = new Map<string, string>();
	for (const record of snapshot.records) {
		collectSourceEventIds(record.payload, referencedIds);
		for (const binding of parseEnvelopeBindingMigrationEvent(record))
			existingBindings.set(binding.source_event_id, binding.source_envelope_hash);
		if (typeof record.payload.source_event_id === "string" && typeof record.payload.source_envelope_hash === "string")
			existingBindings.set(record.payload.source_event_id, record.payload.source_envelope_hash);
	}
	const missingIds = [...referencedIds].filter((id) => !existingBindings.has(id)).sort(compareCodeUnits);
	if (missingIds.length === 0) throw new Error("legacy envelope binding migration has no missing bindings");
	const deadline = Date.now() + (options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
	return withSourceEventLocks(stateRoot, missingIds, options, deadline, () =>
		withWorkLedgerLock(input.ledgerPath, options, () => {
			const current = readWorkLedger(input.ledgerPath);
			if (current.head !== input.expectedHead)
				throw new Error(`work ledger head conflict: expected ${input.expectedHead ?? "null"}, actual ${current.head ?? "null"}`);
			const bindings = missingIds.map((source_event_id) => {
				assertPayloadSourceReferences(stateRoot, { source_event_ids: [source_event_id] }, source_event_id);
				const envelopePath = managedDescendant(stateRoot, path.join("work-inputs", "events", `${source_event_id}.yaml`));
				return { source_event_id, source_envelope_hash: sha256(readFileNoFollow(envelopePath)) };
			});
			const migrationEvent: WorkLedgerEvent = {
				event_id: input.eventId,
				occurred_at: input.occurredAt,
				kind: "source_envelope_bindings_migrated",
				payload: { schema_version: SOURCE_ENVELOPE_BINDINGS_SCHEMA_VERSION, source_envelope_bindings: bindings },
			};
			parseEnvelopeBindingMigrationEvent(migrationEvent);
			return appendPublishedLedgerUnlocked({
				ledgerPath: input.ledgerPath,
				expectedHead: input.expectedHead,
				event: migrationEvent,
			}, stateRoot);
		}),
	);
}

function publishAndAppendWorkSourceEventInternal(
	input: PublishAndAppendWorkSourceEventInput,
	options: PublishAndAppendWorkSourceEventOptions,
	typedLane: boolean,
): PublishedWorkSourceAllocation {
	const sourceEvent: WorkLedgerEvent = {
		...input.ledgerEvent,
		payload: input.ledgerEvent.payload ?? {},
	};
	assertWorkLedgerEvent(sourceEvent);
	if (Object.hasOwn(sourceEvent.payload, "source_envelope_bindings"))
		throw new Error("source_envelope_bindings is reserved for the dedicated legacy migration API");
	if (!typedLane && isTypedWorkPayload(input.ledgerEvent.payload)) {
		throw new Error(
			"typed Work events require the canonical typed source publication API",
		);
	}
	if (typedLane) parseTypedWorkEvent(sourceEvent);
  assertSafeId(input.source.eventId, "event ID");
  const stateRoot = secureStateRoot(input.source.stateRoot);
  const referencedIds = new Set<string>([input.source.eventId]);
  collectSourceEventIds(input.ledgerEvent.payload ?? {}, referencedIds);
  const orderedIds = [...referencedIds].sort(compareCodeUnits);
  const sourceLockDeadline = Date.now() + (options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  return withSourceEventLocks(stateRoot, orderedIds, options, sourceLockDeadline, () => {
    const source = publishWorkSourceEventUnlocked(input.source, options, stateRoot);
    options.onSourcePublished?.(source);
    const payload: Record<string, unknown> = {
      ...(input.ledgerEvent.payload ?? {}),
      source_event_id: source.envelope.event_id,
	  source_envelope_hash: envelopeBytesHash(source.envelope),
      source_object_hash: source.envelope.object_hash,
      source_object_path: source.envelope.object_path,
    };
    const appendOptions: AppendParameters = {
      ledgerPath: input.ledgerPath,
      event: { ...input.ledgerEvent, payload },
      expectedHead: input.expectedHead,
      onBeforeLedgerSync: options.onBeforeLedgerSync,
    };
    assertPayloadSourceReferences(stateRoot, payload, source.envelope.event_id);
    const ledger = withWorkLedgerLock(
      input.ledgerPath,
      {
        lockTimeoutMs: options.ledgerLockTimeoutMs,
        lockRetryMs: options.ledgerLockRetryMs,
      },
      () => {
        assertPublishedWorkSourceEvent(source);
        assertPayloadSourceReferences(stateRoot, payload, source.envelope.event_id);
		return appendPublishedLedgerUnlocked(
			appendOptions,
			stateRoot,
		);
      },
    );
    return { source, ledger };
  });
}

function isTypedWorkPayload(payload: Record<string, unknown> | undefined): boolean {
	return [
		"anamnesis.work-contract-event.v1",
		"anamnesis.work-progress-event.v1",
		"anamnesis.work-lifecycle-event.v1",
	].includes(String(payload?.schema_version ?? ""));
}

function appendPublishedLedgerUnlocked(
  options: AppendParameters,
	stateRoot: string,
): AppendWorkLedgerResult {
  const current = readWorkLedger(options.ledgerPath);
	assertCommittedEnvelopeBindings(stateRoot, current.records, options.event);
  const duplicate = current.records.find((record) => record.event_id === options.event.event_id);
  if (duplicate) {
    if (duplicate.occurred_at !== options.event.occurred_at || duplicate.kind !== options.event.kind || canonicalJson(duplicate.payload) !== canonicalJson(options.event.payload))
      throw new Error(`work ledger event ID collision: ${options.event.event_id}`);
    return { record: duplicate, head: current.head!, idempotent: true };
  }
  if (current.head !== options.expectedHead)
    throw new Error(`work ledger head conflict: expected ${options.expectedHead ?? "null"}, actual ${current.head ?? "null"}`);
  validateWorkEventAppend(current.records, options.event);
  const unsigned = {
    schema_version: WORK_LEDGER_SCHEMA_VERSION,
    event_id: options.event.event_id,
    occurred_at: options.event.occurred_at,
    kind: options.event.kind,
    payload: options.event.payload,
    previous_hash: current.head,
  } as const;
  const record: WorkLedgerRecord = { ...unsigned, record_hash: sha256(Buffer.from(canonicalJson(unsigned), "utf8")) };
  const fd = fs.openSync(path.resolve(options.ledgerPath), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | noFollowFlag(), 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    options.onBeforeLedgerSync?.(record);
    writeAll(fd, Buffer.from(`${canonicalJson(record)}\n`, "utf8"));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(path.dirname(path.resolve(options.ledgerPath)));
  return { record, head: record.record_hash, idempotent: false };
}

function assertCommittedEnvelopeBindings(
	stateRoot: string,
	records: readonly WorkLedgerRecord[],
	currentEvent: WorkLedgerEvent,
): void {
	resolveCommittedEnvelopeBindings(stateRoot, records, currentEvent);
}

function resolveCommittedEnvelopeBindings(
	stateRoot: string,
	records: readonly WorkLedgerRecord[],
	currentEvent: WorkLedgerEvent,
): void {
	const bindings = new Map<string, string>();
	const events = [...records, currentEvent];
	for (const event of events) {
		const parsedBindings = parseEnvelopeBindingMigrationEvent(event);
		for (const binding of parsedBindings) {
			const previous = bindings.get(binding.source_event_id);
			if (previous && previous !== binding.source_envelope_hash)
				throw new Error(`source event ${binding.source_event_id} envelope hash binding changed`);
			bindings.set(binding.source_event_id, binding.source_envelope_hash);
		}
	}
	for (const { payload } of events) {
		const eventId = payload.source_event_id;
		const envelopeHash = payload.source_envelope_hash;
		if (typeof eventId !== "string") continue;
		let effectiveHash: string;
		if (typeof envelopeHash !== "string") {
			const committedBinding = bindings.get(eventId);
			if (committedBinding) effectiveHash = committedBinding;
			else throw new Error(`source event ${eventId} requires explicit legacy envelope binding migration`);
		} else effectiveHash = envelopeHash;
		const previous = bindings.get(eventId);
		if (previous && previous !== effectiveHash)
			throw new Error(`source event ${eventId} envelope hash binding changed`);
		bindings.set(eventId, effectiveHash);
	}
	const referencedIds = new Set<string>();
	collectSourceEventIds(currentEvent.payload, referencedIds);
	for (const eventId of referencedIds) {
		const binding = bindings.get(eventId);
		if (!binding) throw new Error(`source event ${eventId} has no committed envelope hash binding`);
		const envelopePath = managedDescendant(stateRoot, path.join("work-inputs", "events", `${eventId}.yaml`));
		if (sha256(readFileNoFollow(envelopePath)) !== binding)
			throw new Error(`source event ${eventId} envelope metadata changed after publication`);
	}
}

function parseEnvelopeBindingMigrationEvent(event: Pick<WorkLedgerEvent, "kind" | "payload">): Array<{ source_event_id: string; source_envelope_hash: string }> {
	const hasReserved = Object.hasOwn(event.payload, "source_envelope_bindings");
	if (event.kind !== "source_envelope_bindings_migrated") {
		if (hasReserved) throw new Error("source_envelope_bindings is reserved for migration records");
		return [];
	}
	const keys = Object.keys(event.payload).sort(compareCodeUnits);
	if (canonicalJson(keys) !== canonicalJson(["schema_version", "source_envelope_bindings"]))
		throw new Error("invalid source envelope binding migration payload keys");
	if (event.payload.schema_version !== SOURCE_ENVELOPE_BINDINGS_SCHEMA_VERSION)
		throw new Error("invalid source envelope binding migration schema version");
	const value = event.payload.source_envelope_bindings;
	if (!Array.isArray(value) || value.length === 0) throw new Error("source envelope binding migration requires nonempty bindings");
	const seen = new Set<string>();
	const parsed = value.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid source_envelope_bindings entry");
		const keys = Object.keys(item).sort(compareCodeUnits);
		if (canonicalJson(keys) !== canonicalJson(["source_envelope_hash", "source_event_id"])) throw new Error("invalid source_envelope_bindings entry keys");
		const binding = item as Record<string, unknown>;
		if (typeof binding.source_event_id !== "string" || !SAFE_ID.test(binding.source_event_id) || typeof binding.source_envelope_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(binding.source_envelope_hash)) throw new Error("invalid source_envelope_bindings entry");
		if (seen.has(binding.source_event_id)) throw new Error("duplicate source_envelope_bindings event ID");
		seen.add(binding.source_event_id);
		return { source_event_id: binding.source_event_id, source_envelope_hash: binding.source_envelope_hash };
	});
	for (let index = 1; index < parsed.length; index += 1) {
		if (compareCodeUnits(parsed[index - 1]!.source_event_id, parsed[index]!.source_event_id) >= 0)
			throw new Error("source envelope binding migration bindings must be code-unit sorted");
	}
	return parsed;
}

function envelopeBytesHash(envelope: WorkSourceEventEnvelope): string {
	return sha256(Buffer.from(`${canonicalJson(envelope)}\n`, "utf8"));
}

function withSourceEventLocks<T>(
  stateRoot: string,
  eventIds: readonly string[],
  options: WorkStorageOptions,
  deadline: number,
  operation: () => T,
  index = 0,
): T {
  if (index === eventIds.length) return operation();
  const eventId = eventIds[index]!;
  assertSafeId(eventId, "source event ID");
  const lockPath = managedDescendant(
    stateRoot,
    path.join("work-inputs", ".locks", eventId),
  );
  return withWorkSourceEventLock(lockPath, { ...options, lockTimeoutMs: Math.max(0, deadline - Date.now()) }, () =>
    withSourceEventLocks(stateRoot, eventIds, options, deadline, operation, index + 1),
  );
}

function assertPayloadSourceReferences(
	stateRoot: string,
	payload: Record<string, unknown>,
	newSourceEventId: string,
): void {
	const ids = new Set<string>();
	collectSourceEventIds(payload, ids);
	if (!ids.has(newSourceEventId))
		throw new Error("published source must be referenced by the appended Work event");
	for (const eventId of ids) {
		assertSafeId(eventId, "source event ID");
		const envelopePath = managedDescendant(stateRoot, path.join("work-inputs", "events", `${eventId}.yaml`));
		let envelope: WorkSourceEventEnvelope;
		let envelopeBytes: Buffer;
		try {
			envelopeBytes = readFileNoFollow(envelopePath);
			envelope = JSON.parse(envelopeBytes.toString("utf8")) as WorkSourceEventEnvelope;
		} catch (error) {
			throw new Error(`referenced source event ${eventId} is not published`, { cause: error });
		}
		if (!isStrictWorkSourceEnvelope(envelope) || envelope.event_id !== eventId)
			throw new Error(`referenced source event ${eventId} envelope mismatch`);
		if (!envelopeBytes.equals(Buffer.from(`${canonicalJson(envelope)}\n`, "utf8")))
			throw new Error(`referenced source event ${eventId} envelope is not canonical`);
		const expectedObjectPath = path.posix.join("work-inputs", "objects", `${eventId}.txt`);
		if (envelope.object_path !== expectedObjectPath)
			throw new Error(`referenced source event ${eventId} object path mismatch`);
		try {
			const objectPath = managedDescendant(stateRoot, envelope.object_path);
			if (sha256(readFileNoFollow(objectPath)) !== envelope.object_hash)
				throw new Error(`referenced source event ${eventId} object hash mismatch`);
		} catch (error) {
			if (isMissing(error))
				throw new Error(`source event ${eventId} is not published`, { cause: error });
			throw error;
		}
	}
	assertPayloadObjectRefsMatch(payload, stateRoot, ids);
}

function isStrictWorkSourceEnvelope(value: unknown): value is WorkSourceEventEnvelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const envelope = value as Partial<WorkSourceEventEnvelope>;
	const keys = Object.keys(value).sort(compareCodeUnits);
	const expected = ["allocation_status", "attachment_refs", "captured_at", "client", "content_type", "event_id", "fidelity", "object_hash", "object_path", "schema_version"].sort(compareCodeUnits);
	return canonicalJson(keys) === canonicalJson(expected) &&
		envelope.schema_version === WORK_SOURCE_EVENT_SCHEMA_VERSION &&
		typeof envelope.event_id === "string" && SAFE_ID.test(envelope.event_id) &&
		typeof envelope.captured_at === "string" && typeof envelope.client === "string" &&
		typeof envelope.content_type === "string" && typeof envelope.allocation_status === "string" &&
		["native_exact", "client_exact", "agent_observed"].includes(String(envelope.fidelity)) &&
		typeof envelope.object_hash === "string" && /^sha256:[a-f0-9]{64}$/.test(envelope.object_hash) &&
		typeof envelope.object_path === "string" &&
		Array.isArray(envelope.attachment_refs) && envelope.attachment_refs.every((item) => typeof item === "string");
}

function assertPayloadObjectRefsMatch(payload: Record<string, unknown>, stateRoot: string, ids: Set<string>): void {
	const hashes = new Set<string>();
	const paths = new Set<string>();
	const envelopeHashes = new Set<string>();
	const envelopes = new Map<string, WorkSourceEventEnvelope>();
	for (const id of ids) {
		const envelope = JSON.parse(readFileNoFollow(managedDescendant(stateRoot, path.join("work-inputs", "events", `${id}.yaml`))).toString("utf8")) as WorkSourceEventEnvelope;
		envelopes.set(id, envelope);
		envelopeHashes.add(envelopeBytesHash(envelope));
		hashes.add(envelope.object_hash);
		paths.add(envelope.object_path);
	}
	walkObjectRefs(payload, hashes, paths, envelopeHashes, envelopes);
}

function walkObjectRefs(value: unknown, hashes: Set<string>, paths: Set<string>, envelopeHashes: Set<string>, envelopes: Map<string, WorkSourceEventEnvelope>): void {
	if (Array.isArray(value)) { for (const item of value) walkObjectRefs(item, hashes, paths, envelopeHashes, envelopes); return; }
	if (!value || typeof value !== "object") return;
	const object = value as Record<string, unknown>;
	if (typeof object.source_event_id === "string") {
		const envelope = envelopes.get(object.source_event_id);
		if (!envelope) throw new Error("source event object reference is not published");
		if (object.source_object_hash !== undefined && object.source_object_hash !== envelope.object_hash)
			throw new Error("source object hash does not match its source event envelope");
		if (object.source_object_path !== undefined && object.source_object_path !== envelope.object_path)
			throw new Error("source object path does not match its source event envelope");
		if (object.source_envelope_hash !== undefined && object.source_envelope_hash !== envelopeBytesHash(envelope))
			throw new Error("source envelope hash does not match its source event envelope");
	}
	for (const [key, item] of Object.entries(value)) {
		if (key === "source_object_hash" && (typeof item !== "string" || !hashes.has(item))) throw new Error("source object hash does not match a referenced source envelope");
		else if (key === "source_object_path" && (typeof item !== "string" || !paths.has(item))) throw new Error("source object path does not match a referenced source envelope");
		else if (key === "source_envelope_hash" && (typeof item !== "string" || !envelopeHashes.has(item))) throw new Error("source envelope hash does not match a referenced source envelope");
		else walkObjectRefs(item, hashes, paths, envelopeHashes, envelopes);
	}
}

function compareCodeUnits(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	for (let index = 0; index < limit; index += 1) {
		const difference = left.charCodeAt(index) - right.charCodeAt(index);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

function collectSourceEventIds(value: unknown, output: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) collectSourceEventIds(item, output);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value)) {
		if (key === "source_event_id" && typeof item === "string") output.add(item);
		else if (key === "source_event_ids" && Array.isArray(item)) {
			for (const id of item) if (typeof id === "string") output.add(id);
		} else collectSourceEventIds(item, output);
	}
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
