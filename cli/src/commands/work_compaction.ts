import { readWorkCursor } from "../core/work_cursor.js";
import { buildWorkBriefingSnapshot } from "../core/work_reconciliation.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { statusWork } from "./work.js";
import {
	deriveWorkHookCursorId,
	renderWorkBriefingContext,
	type WorkHookInput,
	type WorkHookResult,
} from "./work_hook.js";

const MAX_STABLE_ID_LENGTH = 512;

export function handleWorkCompactionResume(
	input: WorkHookInput,
): WorkHookResult {
	if (input.client !== "codex") return unavailable("invalid_payload");
	const sessionId = parseCompactSession(input.payload);
	if (!sessionId) return unavailable("invalid_payload");

	const cursorId = deriveWorkHookCursorId("codex", sessionId);
	let state: ReturnType<typeof resolveWorkStateRoot>;
	try {
		state = resolveWorkStateRoot(input.project_root, input.state_root);
	} catch {
		return unavailable("cursor_unavailable", cursorId);
	}

	try {
		const initial = readWorkCursor(
			state.state_root,
			cursorId,
			undefined,
			state.worktree_fingerprint,
		);
		if (
			!initial.cursor ||
			initial.status === "switched" ||
			initial.cursor.client_session_ref !== sessionId
		) {
			return unavailable("cursor_unavailable", cursorId);
		}

		const cursor = initial.cursor;
		const status = statusWork({
			project_root: input.project_root,
			state_root: input.state_root,
			work_id: cursor.work_id,
		});
		const policy = status.projection.policy_snapshot?.policy;
		if (!policy) return unavailable("cursor_unavailable", cursorId);
		if (policy.reconciliation.preset === "off") {
			return result("not_due", "policy_off", cursorId);
		}

		const briefing = buildWorkBriefingSnapshot({
			projection: status.projection,
		});
		const context = renderWorkBriefingContext(
			briefing,
			policy.reconciliation.detail,
			status.projection.lifecycle === "open",
		);

		const reread = readWorkCursor(
			state.state_root,
			cursorId,
			undefined,
			state.worktree_fingerprint,
		);
		if (
			!reread.cursor ||
			reread.status === "switched" ||
			!sameCursorBinding(cursor, reread.cursor, sessionId)
		) {
			return unavailable("cursor_unavailable", cursorId);
		}

		return {
			...result("briefing_due", "briefing_due", cursorId),
			context,
		};
	} catch {
		return unavailable("cursor_unavailable", cursorId);
	}
}

function parseCompactSession(payload: unknown): string | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const value = payload as Record<string, unknown>;
	if (value.source !== "compact") return null;
	return validStableId(value.session_id);
}

function validStableId(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_STABLE_ID_LENGTH ||
		/[\u0000-\u001f\u007f]/u.test(value)
	) {
		return null;
	}
	return value;
}

function sameCursorBinding(
	initial: NonNullable<ReturnType<typeof readWorkCursor>["cursor"]>,
	current: NonNullable<ReturnType<typeof readWorkCursor>["cursor"]>,
	sessionId: string,
): boolean {
	return (
		current.cursor_id === initial.cursor_id &&
		current.cursor_revision === initial.cursor_revision &&
		current.client_session_ref === sessionId &&
		current.work_id === initial.work_id &&
		current.worktree_fingerprint === initial.worktree_fingerprint &&
		current.observed_revision === initial.observed_revision &&
		current.projection_hash === initial.projection_hash
	);
}

function unavailable(
	reason: WorkHookResult["reason"],
	cursorId: string | null = null,
): WorkHookResult {
	return result("unavailable", reason, cursorId);
}

function result(
	status: WorkHookResult["status"],
	reason: WorkHookResult["reason"],
	cursorId: string | null,
): WorkHookResult {
	return {
		schema_version: "anamnesis.work-hook-result.v1",
		status,
		reason,
		context: null,
		cursor_id: cursorId,
		boundary_id: null,
	};
}
