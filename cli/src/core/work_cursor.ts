import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { isHash } from "../util/hash.js";
import { withWorkLedgerLock } from "./work_ledger.js";
import { emptyWorkCursorReconciliationState } from "./work_reconciliation.js";
import { worktreeFingerprint as storageWorktreeFingerprint } from "./work_storage.js";

export const WORK_CURSOR_SCHEMA_VERSION = "anamnesis.work-cursor.v1" as const;

export interface WorkCursor {
	schema_version: typeof WORK_CURSOR_SCHEMA_VERSION;
	cursor_id: string;
	client_session_ref: string | null;
	work_id: string;
	observed_revision: number;
	last_event_id: string | null;
	projection_hash: string;
	worktree_fingerprint: string;
	updated_at: string;
	cursor_revision?: number;
	reconciliation?: WorkCursorReconciliationState;
}

export interface WorkCursorWriteOptions {
	/** Undefined preserves the legacy unconditional-write behavior; null requires no prior cursor. */
	expectedCursorRevision?: number | null;
	lockTimeoutMs?: number;
	lockRetryMs?: number;
}

export interface NewWorkCursorInput {
	cursor_id: string;
	client_session_ref: string | null;
	worktree_fingerprint: string;
	updated_at: string;
	truth: WorkCursorTruth;
}

export interface WorkCursorReconciliationState {
	last_reconciled_head: string | null;
	last_reconciled_revision: number | null;
	last_reconciled_at: string | null;
	meaningful_actions_since_confirmed: number;
	pending_delivery: WorkCursorPendingDelivery | null;
	confirmed_delivery_fingerprint: string | null;
	injected_unconfirmed?: WorkCursorInjectedObservation | null;
}

export interface WorkCursorInjectedObservation {
	delivery: WorkCursorPendingDelivery;
	injected_at: string;
	boundary_id: string;
	meaningful_actions_observed: number;
}

export interface WorkCursorPendingDelivery {
	fingerprint: string;
	ledger_head: string | null;
	contract_revision: number;
	contract_hash: string | null;
	policy_hash: string | null;
}

export interface WorkCursorTruth {
	work_id: string;
	revision: number;
	last_event_id: string | null;
	projection_hash: string;
}

export type WorkCursorReadResult =
	| { status: "missing"; cursor: null; reload_required: true }
	| { status: "corrupt"; cursor: null; reload_required: true; error: string }
	| {
			status: "current" | "lagging" | "switched";
			cursor: WorkCursor;
			reload_required: boolean;
	  };

export interface WorkCursorFs {
	openSync: typeof fs.openSync;
	writeFileSync: typeof fs.writeFileSync;
	fsyncSync: typeof fs.fsyncSync;
	closeSync: typeof fs.closeSync;
	renameSync: typeof fs.renameSync;
	mkdirSync: typeof fs.mkdirSync;
}

const defaultFs: WorkCursorFs = {
	openSync: fs.openSync,
	writeFileSync: fs.writeFileSync,
	fsyncSync: fs.fsyncSync,
	closeSync: fs.closeSync,
	renameSync: fs.renameSync,
	mkdirSync: fs.mkdirSync,
};

function requireNonEmpty(
	value: unknown,
	field: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`invalid Work cursor: ${field} must be a non-empty string`);
	}
}

function requireIsoTimestamp(
	value: unknown,
	field: string,
): asserts value is string {
	const matchesCanonicalShape =
		typeof value === "string" &&
		/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(
			value,
		);
	const parsed = matchesCanonicalShape ? new Date(value) : null;
	const canonical =
		typeof value === "string"
			? value.includes(".")
				? value
				: value.replace(/Z$/, ".000Z")
			: "";
	if (
		!parsed ||
		!Number.isFinite(parsed.getTime()) ||
		parsed.toISOString() !== canonical
	) {
		throw new Error(
			`invalid Work cursor: ${field} must be an ISO-8601 timestamp`,
		);
	}
}

function parseReconciliationState(
	value: unknown,
): WorkCursorReconciliationState {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid Work cursor: reconciliation must be a mapping");
	}
	const state = value as Record<string, unknown>;
	const allowed = new Set([
		"last_reconciled_head",
		"last_reconciled_revision",
		"last_reconciled_at",
		"meaningful_actions_since_confirmed",
		"pending_delivery",
		"confirmed_delivery_fingerprint",
		"injected_unconfirmed",
	]);
	const unknown = Object.keys(state).find((key) => !allowed.has(key));
	if (unknown) {
		throw new Error(
			`invalid Work cursor: unknown reconciliation field ${unknown}`,
		);
	}
	for (const field of [...allowed].filter(
		(field) => field !== "injected_unconfirmed",
	)) {
		if (!(field in state)) {
			throw new Error(
				`invalid Work cursor: missing reconciliation field ${field}`,
			);
		}
	}
	if (
		state.last_reconciled_head !== null &&
		!isHash(state.last_reconciled_head)
	) {
		throw new Error(
			"invalid Work cursor: last_reconciled_head must be a SHA-256 hash or null",
		);
	}
	if (
		state.last_reconciled_revision !== null &&
		(!Number.isSafeInteger(state.last_reconciled_revision) ||
			(state.last_reconciled_revision as number) < 0)
	) {
		throw new Error(
			"invalid Work cursor: last_reconciled_revision must be a non-negative integer or null",
		);
	}
	if (state.last_reconciled_at !== null) {
		requireIsoTimestamp(state.last_reconciled_at, "last_reconciled_at");
	}
	if (
		!Number.isSafeInteger(state.meaningful_actions_since_confirmed) ||
		(state.meaningful_actions_since_confirmed as number) < 0
	) {
		throw new Error(
			"invalid Work cursor: meaningful_actions_since_confirmed must be a non-negative integer",
		);
	}
	if (state.pending_delivery !== null) {
		parsePendingDelivery(state.pending_delivery);
	}
	if (
		state.confirmed_delivery_fingerprint !== null &&
		!isHash(state.confirmed_delivery_fingerprint)
	) {
		throw new Error(
			"invalid Work cursor: confirmed_delivery_fingerprint must be a SHA-256 hash or null",
		);
	}
	if (
		state.injected_unconfirmed !== undefined &&
		state.injected_unconfirmed !== null
	) {
		parseInjectedObservation(state.injected_unconfirmed);
	}
	return state as unknown as WorkCursorReconciliationState;
}

function parseInjectedObservation(
	value: unknown,
): WorkCursorInjectedObservation {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(
			"invalid Work cursor: injected_unconfirmed must be a mapping",
		);
	}
	const observation = value as Record<string, unknown>;
	const fields = [
		"delivery",
		"injected_at",
		"boundary_id",
		"meaningful_actions_observed",
	] as const;
	const unknown = Object.keys(observation).find(
		(key) => !fields.includes(key as (typeof fields)[number]),
	);
	if (unknown) {
		throw new Error(
			`invalid Work cursor: unknown injected_unconfirmed field ${unknown}`,
		);
	}
	for (const field of fields) {
		if (!(field in observation)) {
			throw new Error(
				`invalid Work cursor: missing injected_unconfirmed field ${field}`,
			);
		}
	}
	parsePendingDelivery(observation.delivery);
	requireIsoTimestamp(
		observation.injected_at,
		"injected_unconfirmed.injected_at",
	);
	if (!isHash(observation.boundary_id)) {
		throw new Error(
			"invalid Work cursor: injected_unconfirmed.boundary_id must be a SHA-256 hash",
		);
	}
	if (
		!Number.isSafeInteger(observation.meaningful_actions_observed) ||
		(observation.meaningful_actions_observed as number) < 0
	) {
		throw new Error(
			"invalid Work cursor: injected_unconfirmed.meaningful_actions_observed must be a non-negative integer",
		);
	}
	return observation as unknown as WorkCursorInjectedObservation;
}

function parsePendingDelivery(value: unknown): WorkCursorPendingDelivery {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid Work cursor: pending_delivery must be a mapping");
	}
	const pending = value as Record<string, unknown>;
	const fields = [
		"fingerprint",
		"ledger_head",
		"contract_revision",
		"contract_hash",
		"policy_hash",
	] as const;
	const unknown = Object.keys(pending).find(
		(key) => !fields.includes(key as (typeof fields)[number]),
	);
	if (unknown) {
		throw new Error(
			`invalid Work cursor: unknown pending_delivery field ${unknown}`,
		);
	}
	for (const field of fields) {
		if (!(field in pending)) {
			throw new Error(
				`invalid Work cursor: missing pending_delivery field ${field}`,
			);
		}
	}
	if (!isHash(pending.fingerprint)) {
		throw new Error("invalid Work cursor: pending delivery fingerprint");
	}
	for (const field of [
		"ledger_head",
		"contract_hash",
		"policy_hash",
	] as const) {
		if (pending[field] !== null && !isHash(pending[field])) {
			throw new Error(`invalid Work cursor: pending delivery ${field}`);
		}
	}
	if (
		!Number.isSafeInteger(pending.contract_revision) ||
		(pending.contract_revision as number) < 0
	) {
		throw new Error("invalid Work cursor: pending delivery contract_revision");
	}
	return pending as unknown as WorkCursorPendingDelivery;
}

export function parseWorkCursor(content: string): WorkCursor {
	let value: unknown;
	try {
		value = YAML.parse(content);
	} catch (error) {
		throw new Error(`invalid Work cursor YAML: ${(error as Error).message}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid Work cursor: expected a mapping");
	}
	const cursor = value as Record<string, unknown>;
	const allowedCursorFields = new Set([
		"schema_version",
		"cursor_id",
		"client_session_ref",
		"work_id",
		"observed_revision",
		"last_event_id",
		"projection_hash",
		"worktree_fingerprint",
		"updated_at",
		"cursor_revision",
		"reconciliation",
	]);
	const unknownCursorField = Object.keys(cursor).find(
		(key) => !allowedCursorFields.has(key),
	);
	if (unknownCursorField) {
		throw new Error(`invalid Work cursor: unknown field ${unknownCursorField}`);
	}
	if (cursor.schema_version !== WORK_CURSOR_SCHEMA_VERSION) {
		throw new Error("invalid Work cursor: unsupported schema_version");
	}
	requireNonEmpty(cursor.cursor_id, "cursor_id");
	requireNonEmpty(cursor.work_id, "work_id");
	requireNonEmpty(cursor.updated_at, "updated_at");
	if (
		cursor.client_session_ref !== null &&
		typeof cursor.client_session_ref !== "string"
	) {
		throw new Error(
			"invalid Work cursor: client_session_ref must be a string or null",
		);
	}
	if (
		!Number.isSafeInteger(cursor.observed_revision) ||
		(cursor.observed_revision as number) < 0
	) {
		throw new Error(
			"invalid Work cursor: observed_revision must be a non-negative integer",
		);
	}
	if (
		cursor.last_event_id !== null &&
		typeof cursor.last_event_id !== "string"
	) {
		throw new Error(
			"invalid Work cursor: last_event_id must be a string or null",
		);
	}
	if (!isHash(cursor.projection_hash) || !isHash(cursor.worktree_fingerprint)) {
		throw new Error(
			"invalid Work cursor: projection_hash and worktree_fingerprint must be SHA-256 hashes",
		);
	}
	requireIsoTimestamp(cursor.updated_at, "updated_at");
	if (
		cursor.cursor_revision !== undefined &&
		(!Number.isSafeInteger(cursor.cursor_revision) ||
			(cursor.cursor_revision as number) < 0)
	) {
		throw new Error(
			"invalid Work cursor: cursor_revision must be a non-negative integer",
		);
	}
	// A missing revision is the legacy v1 representation. Materialize its CAS
	// identity on read without requiring an eager on-disk migration.
	cursor.cursor_revision ??= 0;
	if (cursor.reconciliation !== undefined) {
		cursor.reconciliation = parseReconciliationState(cursor.reconciliation);
	}
	return cursor as unknown as WorkCursor;
}

export function worktreeFingerprint(worktreeRoot: string): string {
	return storageWorktreeFingerprint(worktreeRoot);
}

export function workCursorPath(stateRoot: string, cursorId: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cursorId)) {
		throw new Error("invalid Work cursor id");
	}
	return path.join(stateRoot, "work-cursors", `${cursorId}.yaml`);
}

export function writeWorkCursorAtomic(
	stateRoot: string,
	cursor: WorkCursor,
	ioOrOptions: WorkCursorFs | WorkCursorWriteOptions = defaultFs,
	maybeOptions: WorkCursorWriteOptions = {},
): string {
	const target = workCursorPath(stateRoot, cursor.cursor_id);
	const io = isWorkCursorFs(ioOrOptions) ? ioOrOptions : defaultFs;
	const options = isWorkCursorFs(ioOrOptions) ? maybeOptions : ioOrOptions;
	return withWorkLedgerLock(target, options, () => {
		const prior = readPriorCursorForWrite(stateRoot, cursor.cursor_id);
		const priorRevision = prior?.cursor_revision ?? null;
		if (
			options.expectedCursorRevision !== undefined &&
			options.expectedCursorRevision !== priorRevision
		) {
			throw new Error(
				`stale Work cursor write: expected revision ${String(options.expectedCursorRevision)}, found ${String(priorRevision)}`,
			);
		}
		const nextRevision = (priorRevision ?? 0) + 1;
		if (
			cursor.cursor_revision !== undefined &&
			cursor.cursor_revision !== priorRevision &&
			cursor.cursor_revision !== nextRevision
		) {
			throw new Error(
				`invalid Work cursor revision: expected next revision ${nextRevision}`,
			);
		}
		const normalized: WorkCursor = {
			...cursor,
			cursor_revision: nextRevision,
		};
		// Validate the exact value before touching the disposable cache on disk.
		parseWorkCursor(YAML.stringify(normalized));
		const directory = path.dirname(target);
		assertManagedWritePath(stateRoot, target);
		io.mkdirSync(directory, { recursive: true });
		const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
		let file: number | undefined;
		try {
			file = io.openSync(
				temporary,
				fs.constants.O_WRONLY |
					fs.constants.O_CREAT |
					fs.constants.O_EXCL |
					fs.constants.O_NOFOLLOW,
				0o600,
			);
			io.writeFileSync(file, YAML.stringify(normalized), "utf8");
			io.fsyncSync(file);
			io.closeSync(file);
			file = undefined;
			io.renameSync(temporary, target);
			const dir = io.openSync(directory, "r");
			try {
				io.fsyncSync(dir);
			} finally {
				io.closeSync(dir);
			}
		} catch (error) {
			if (file !== undefined) io.closeSync(file);
			try {
				fs.unlinkSync(temporary);
			} catch {
				// Best-effort cleanup; cursor files are explicitly disposable.
			}
			throw error;
		}
		return target;
	});
}

export function switchWorkCursorAtomic(
	stateRoot: string,
	cursor: WorkCursor,
	truth: WorkCursorTruth,
	ioOrOptions: WorkCursorFs | WorkCursorWriteOptions = defaultFs,
	maybeOptions: WorkCursorWriteOptions = {},
): string {
	const options = isWorkCursorFs(ioOrOptions) ? maybeOptions : ioOrOptions;
	const nextCursor: WorkCursor = {
		...cursor,
		work_id: truth.work_id,
		observed_revision: truth.revision,
		last_event_id: truth.last_event_id,
		projection_hash: truth.projection_hash,
		reconciliation: emptyWorkCursorReconciliationState(),
		cursor_revision: undefined,
	};
	const casOptions = {
		...options,
		expectedCursorRevision:
			options.expectedCursorRevision ?? cursor.cursor_revision ?? 0,
	};
	return isWorkCursorFs(ioOrOptions)
		? writeWorkCursorAtomic(stateRoot, nextCursor, ioOrOptions, casOptions)
		: writeWorkCursorAtomic(stateRoot, nextCursor, casOptions);
}

export function newWorkCursor(input: NewWorkCursorInput): WorkCursor {
	return {
		schema_version: WORK_CURSOR_SCHEMA_VERSION,
		cursor_id: input.cursor_id,
		client_session_ref: input.client_session_ref,
		work_id: input.truth.work_id,
		observed_revision: input.truth.revision,
		last_event_id: input.truth.last_event_id,
		projection_hash: input.truth.projection_hash,
		worktree_fingerprint: input.worktree_fingerprint,
		updated_at: input.updated_at,
		reconciliation: emptyWorkCursorReconciliationState(),
	};
}

export function updateWorkCursorAtomic(
	stateRoot: string,
	cursor: WorkCursor,
	truth: WorkCursorTruth,
	updatedAt: string,
	options: WorkCursorWriteOptions = {},
): string {
	return writeWorkCursorAtomic(
		stateRoot,
		{
			...cursor,
			work_id: truth.work_id,
			observed_revision: truth.revision,
			last_event_id: truth.last_event_id,
			projection_hash: truth.projection_hash,
			updated_at: updatedAt,
		},
		{
			...options,
			expectedCursorRevision:
				options.expectedCursorRevision ?? cursor.cursor_revision ?? 0,
		},
	);
}

function isWorkCursorFs(
	value: WorkCursorFs | WorkCursorWriteOptions,
): value is WorkCursorFs {
	return "openSync" in value;
}

function readPriorCursorForWrite(
	stateRoot: string,
	cursorId: string,
): WorkCursor | null {
	const result = readWorkCursor(stateRoot, cursorId);
	if (result.status === "missing") return null;
	if (result.status === "corrupt") {
		throw new Error(`cannot overwrite corrupt Work cursor: ${result.error}`);
	}
	return result.cursor;
}

export function readWorkCursor(
	stateRoot: string,
	cursorId: string,
	truth?: WorkCursorTruth,
	expectedWorktreeFingerprint?: string,
): WorkCursorReadResult {
	const file = workCursorPath(stateRoot, cursorId);
	let cursor: WorkCursor;
	let descriptor: number | undefined;
	try {
		assertManagedCursorPath(stateRoot, file);
		descriptor = fs.openSync(
			file,
			fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
		);
		cursor = parseWorkCursor(fs.readFileSync(descriptor, "utf8"));
		fs.closeSync(descriptor);
		descriptor = undefined;
	} catch (error) {
		if (descriptor !== undefined) fs.closeSync(descriptor);
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { status: "missing", cursor: null, reload_required: true };
		}
		return {
			status: "corrupt",
			cursor: null,
			reload_required: true,
			error: (error as Error).message,
		};
	}

	if (
		(truth && cursor.work_id !== truth.work_id) ||
		(expectedWorktreeFingerprint &&
			cursor.worktree_fingerprint !== expectedWorktreeFingerprint)
	) {
		return { status: "switched", cursor, reload_required: true };
	}
	if (
		truth &&
		(cursor.observed_revision !== truth.revision ||
			cursor.last_event_id !== truth.last_event_id ||
			cursor.projection_hash !== truth.projection_hash)
	) {
		return { status: "lagging", cursor, reload_required: true };
	}
	return { status: "current", cursor, reload_required: false };
}

export function deleteWorkCursor(stateRoot: string, cursorId: string): boolean {
	const target = workCursorPath(stateRoot, cursorId);
	try {
		assertManagedCursorPath(stateRoot, target);
		fs.unlinkSync(target);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function assertManagedWritePath(stateRoot: string, target: string): void {
	assertManagedCursorPath(stateRoot, target);
}

function assertManagedCursorPath(stateRoot: string, target: string): void {
	const root = path.resolve(stateRoot);
	const resolvedTarget = path.resolve(target);
	const relative = path.relative(root, resolvedTarget);
	if (
		relative.startsWith("..") ||
		path.isAbsolute(relative) ||
		relative === ""
	) {
		throw new Error("managed Work cursor path escapes its state root");
	}
	const parsed = path.parse(resolvedTarget);
	const lexicalParts = resolvedTarget
		.slice(parsed.root.length)
		.split(path.sep)
		.filter(Boolean);
	if (lexicalParts.length === 0) {
		throw new Error("managed Work cursor path is invalid");
	}
	let candidate = fs.realpathSync(path.join(parsed.root, lexicalParts[0]!));
	for (const part of lexicalParts.slice(1)) {
		candidate = path.join(candidate, part);
		try {
			if (fs.lstatSync(candidate).isSymbolicLink()) {
				throw new Error(
					`managed Work cursor path must not be a symbolic link: ${candidate}`,
				);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}
