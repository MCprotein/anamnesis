import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { isHash } from "../util/hash.js";
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
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
			cursor.updated_at,
		) ||
		Number.isNaN(Date.parse(cursor.updated_at))
	) {
		throw new Error(
			"invalid Work cursor: updated_at must be an ISO-8601 timestamp",
		);
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
	io: WorkCursorFs = defaultFs,
): string {
	// Validate the exact value before touching the disposable cache on disk.
	parseWorkCursor(YAML.stringify(cursor));
	const target = workCursorPath(stateRoot, cursor.cursor_id);
	const directory = path.dirname(target);
	io.mkdirSync(directory, { recursive: true });
	assertManagedWritePath(stateRoot, target);
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
		io.writeFileSync(file, YAML.stringify(cursor), "utf8");
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
}

export function readWorkCursor(
	stateRoot: string,
	cursorId: string,
	truth?: WorkCursorTruth,
	expectedWorktreeFingerprint?: string,
): WorkCursorReadResult {
	const file = workCursorPath(stateRoot, cursorId);
	let cursor: WorkCursor;
	try {
		cursor = parseWorkCursor(fs.readFileSync(file, "utf8"));
	} catch (error) {
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
	try {
		fs.unlinkSync(workCursorPath(stateRoot, cursorId));
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function assertManagedWritePath(stateRoot: string, target: string): void {
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
	const cursorDirectory = path.dirname(resolvedTarget);
	for (const candidate of [root, cursorDirectory, resolvedTarget]) {
		try {
			if (fs.lstatSync(candidate).isSymbolicLink()) {
				throw new Error(
					`managed Work cursor path must not be a symbolic link: ${candidate}`,
				);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}
