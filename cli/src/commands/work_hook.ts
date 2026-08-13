import { findAgentfile, readAgentfile } from "../core/agentfile.js";
import {
	readWorkCursor,
	updateWorkCursorAtomic,
	type WorkCursor,
} from "../core/work_cursor.js";
import { readWorkLedger } from "../core/work_ledger.js";
import {
	foldWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import {
	buildWorkBriefingSnapshot,
	emptyWorkCursorReconciliationState,
	evaluateReconciliationDue,
	observeInjectedReconciliation,
	type ReconciliationDeliveryBinding,
	type WorkBriefingSnapshot,
} from "../core/work_reconciliation.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { sha256 } from "../util/hash.js";
import { statusWork } from "./work.js";

export type WorkHookClient = "codex" | "claude" | "claude-code";

export interface WorkHookInput {
	project_root: string;
	state_root?: string;
	client: WorkHookClient;
	payload: unknown;
	now?: string;
}

export interface WorkHookResult {
	schema_version: "anamnesis.work-hook-result.v1";
	status: "unavailable" | "not_due" | "briefing_due";
	reason:
		| "invalid_payload"
		| "missing_stable_id"
		| "cursor_unavailable"
		| "policy_off"
		| "duplicate_boundary"
		| "not_due"
		| "briefing_due";
	context: string | null;
	cursor_id: string | null;
	boundary_id: string | null;
}

interface ParsedBoundary {
	sessionId: string;
	boundaryStableId: string;
}

const MAX_STABLE_ID_LENGTH = 512;
const MAX_CAS_ATTEMPTS = 3;
const MAX_HOOK_CONTEXT_CHARACTERS = 32_000;
const LIST_BUDGET = 2_000;
const REQUIREMENT_SUMMARY_BUDGET = 4_000;

/**
 * Foreground UserPromptSubmit service. Prompt text is checked for type only
 * and is never persisted, fingerprinted, logged, or returned.
 */
export function handleWorkUserPromptSubmit(
	input: WorkHookInput,
): WorkHookResult {
	const parsed = parseBoundary(input.client, input.payload);
	if (!parsed.ok) return unavailable(parsed.reason);
	const cursorId = deriveWorkHookCursorId(input.client, parsed.value.sessionId);
	const boundaryId = deriveWorkHookBoundaryId(
		input.client,
		parsed.value.sessionId,
		parsed.value.boundaryStableId,
	);
	let state: ReturnType<typeof resolveWorkStateRoot>;
	try {
		state = resolveWorkStateRoot(input.project_root, input.state_root);
	} catch {
		return unavailable("cursor_unavailable", cursorId, boundaryId);
	}
	const now = input.now ?? new Date().toISOString();

	for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
		const read = readWorkCursor(
			state.state_root,
			cursorId,
			undefined,
			state.worktree_fingerprint,
		);
		if (!read.cursor || read.status === "switched") {
			if (!projectReconciliationEnabled(input.project_root)) {
				return result("not_due", "policy_off", cursorId, boundaryId);
			}
			return onboardingUnavailable(cursorId, boundaryId);
		}
		const cursor = read.cursor;
		const reconciliation =
			cursor.reconciliation ?? emptyWorkCursorReconciliationState();

		try {
			const status = statusWork({
				project_root: input.project_root,
				state_root: input.state_root,
				work_id: cursor.work_id,
			});
			const projection = status.projection;
			const policy = projection.policy_snapshot?.policy;
			if (!policy) {
				return unavailable("cursor_unavailable", cursorId, boundaryId);
			}
			if (policy.reconciliation.preset === "off") {
				return result("not_due", "policy_off", cursorId, boundaryId);
			}
			const briefing = buildBriefing(status.ledger_path, projection, cursor);
			const observation = reconciliation.injected_unconfirmed;
			if (
				observation?.boundary_id === boundaryId &&
				observation.delivery.fingerprint === briefing.semantic_fingerprint
			) {
				return result("not_due", "duplicate_boundary", cursorId, boundaryId);
			}
			const sameObservedFingerprint =
				observation?.delivery.fingerprint === briefing.semantic_fingerprint;
			const actionsAtObservation = sameObservedFingerprint
				? observation.meaningful_actions_observed
				: 0;
			const decision = evaluateReconciliationDue({
				policy,
				lifecycle: projection.lifecycle,
				safe_boundary: true,
				trigger: "work_resume",
				now,
				last_confirmed_at: sameObservedFingerprint
					? observation.injected_at
					: reconciliation.last_reconciled_at,
				meaningful_actions_since_confirmed: Math.max(
					0,
					reconciliation.meaningful_actions_since_confirmed -
						actionsAtObservation,
				),
				current_fingerprint: briefing.semantic_fingerprint,
				confirmed_fingerprint: reconciliation.confirmed_delivery_fingerprint,
				last_observed_fingerprint:
					observation?.delivery.fingerprint ??
					reconciliation.confirmed_delivery_fingerprint,
			});
			if (!decision.due) {
				return result("not_due", "not_due", cursorId, boundaryId);
			}
			const delivery = deliveryBinding(briefing, projection);
			const nextReconciliation = observeInjectedReconciliation(reconciliation, {
				delivery,
				injected_at: now,
				boundary_id: boundaryId,
				meaningful_actions_observed:
					reconciliation.meaningful_actions_since_confirmed,
			});
			updateWorkCursorAtomic(
				state.state_root,
				{ ...cursor, reconciliation: nextReconciliation },
				projectionTruth(projection),
				now,
				{ expectedCursorRevision: cursor.cursor_revision ?? 0 },
			);
			return {
				...result("briefing_due", "briefing_due", cursorId, boundaryId),
				context: renderWorkBriefingContext(
					briefing,
					policy.reconciliation.detail,
					decision.auto_continue,
				),
			};
		} catch (error) {
			if (
				String((error as Error).message).includes("stale Work cursor write")
			) {
				continue;
			}
			return unavailable("cursor_unavailable", cursorId, boundaryId);
		}
	}
	return unavailable("cursor_unavailable", cursorId, boundaryId);
}

function projectReconciliationEnabled(projectRoot: string): boolean {
	try {
		if (!findAgentfile(projectRoot)) return false;
		const agentfile = readAgentfile(projectRoot);
		return (
			agentfile.version === 2 &&
			agentfile.settings?.work_policy?.reconciliation?.preset !== undefined &&
			agentfile.settings.work_policy.reconciliation.preset !== "off"
		);
	} catch {
		return false;
	}
}

export function deriveWorkHookCursorId(
	client: WorkHookClient,
	sessionId: string,
): string {
	return `hook_${sha256(`${canonicalClient(client)}\0${sessionId}`).slice("sha256:".length)}`;
}

export function deriveWorkHookBoundaryId(
	client: WorkHookClient,
	sessionId: string,
	boundaryStableId: string,
): string {
	return sha256(
		`${canonicalClient(client)}\0${sessionId}\0${boundaryStableId}`,
	);
}

function canonicalClient(client: WorkHookClient): "codex" | "claude" {
	return client === "claude-code" ? "claude" : client;
}

function parseBoundary(
	client: WorkHookClient,
	payload: unknown,
):
	| { ok: true; value: ParsedBoundary }
	| { ok: false; reason: "invalid_payload" | "missing_stable_id" } {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { ok: false, reason: "invalid_payload" };
	}
	const value = payload as Record<string, unknown>;
	// Deliberately do nothing with prompt bytes beyond validating the official field.
	if (typeof value.prompt !== "string") {
		return { ok: false, reason: "invalid_payload" };
	}
	const sessionId = validStableId(value.session_id);
	const boundaryStableId = validStableId(
		client === "codex" ? value.turn_id : value.prompt_id,
	);
	if (!sessionId || !boundaryStableId) {
		return { ok: false, reason: "missing_stable_id" };
	}
	return { ok: true, value: { sessionId, boundaryStableId } };
}

function validStableId(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_STABLE_ID_LENGTH ||
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		return null;
	}
	return value;
}

function buildBriefing(
	ledgerPath: string,
	projection: WorkProjection,
	cursor: WorkCursor,
): WorkBriefingSnapshot {
	const ledger = readWorkLedger(ledgerPath);
	let previousConfirmed: WorkBriefingSnapshot | null = null;
	const baselineHead = cursor.reconciliation?.last_reconciled_head ?? null;
	if (baselineHead) {
		const index = ledger.records.findIndex(
			(record) => record.record_hash === baselineHead,
		);
		if (index >= 0) {
			previousConfirmed = buildWorkBriefingSnapshot({
				projection: foldWorkProjection(ledger.records.slice(0, index + 1)),
			});
		}
	}
	return buildWorkBriefingSnapshot({
		projection,
		previous_confirmed: previousConfirmed,
	});
}

function deliveryBinding(
	briefing: WorkBriefingSnapshot,
	projection: WorkProjection,
): ReconciliationDeliveryBinding {
	return {
		fingerprint: briefing.semantic_fingerprint,
		ledger_head: projection.ledger_head,
		contract_revision: projection.contract_revision,
		contract_hash: projection.contract_hash,
		policy_hash: projection.policy_hash,
	};
}

export function renderWorkBriefingContext(
	briefing: WorkBriefingSnapshot,
	detail: "compact" | "full",
	autoContinue: boolean,
): string {
	const counts = briefing.requirement_ids_by_status;
	const changedRequirementIds = uniqueIds([
		...briefing.delta.added_requirement_ids,
		...briefing.delta.status_changed.map((change) => change.requirement_id),
		...briefing.delta.superseded.map((change) => change.requirement_id),
	]);
	const changedRequirements = briefing.requirements.filter((requirement) =>
		changedRequirementIds.includes(requirement.id),
	);
	const atRiskRequirements = briefing.requirements.filter((requirement) =>
		["blocked", "implemented_unverified"].includes(requirement.status),
	);
	const nextRequirement = briefing.requirements.find(
		(requirement) => requirement.id === briefing.next_requirement_ids[0],
	);
	const lines = [
		"Anamnesis Work briefing is due at this foreground boundary.",
		"Delivery observation: injected_unconfirmed. Hidden context injection does not prove the user saw a briefing.",
		autoContinue
			? "Before continuing, read the complete authoritative Work status, visibly brief the requirements, done, remaining, blockers, and progress, then continue the same task in this turn."
			: "Visibly brief the requirements, done, remaining, blockers, and progress. This Work is terminal; do not continue or restart it automatically.",
		`Required retrieval: run ${shellCommandForStatus(briefing.work_id)} before the visible briefing; compact context never replaces the complete projection.`,
		`Work: ${boundedSemanticField(briefing.work_id, 256)} — ${boundedSemanticField(briefing.work.title ?? "untitled", 512)} (contract revision ${briefing.contract_revision}, lifecycle ${briefing.lifecycle})`,
		`Completion contract: ${boundedSemanticField(briefing.work.completion_contract ?? "not recorded", 1_000)}`,
		`Contract delta: baseline=${briefing.baseline_available ? "confirmed" : "unavailable"}; added=${boundedIds(briefing.delta.added_requirement_ids)}; status_changed=${boundedStatusChanges(briefing.delta.status_changed)}; superseded=${boundedSuperseded(briefing.delta.superseded)}; conflicts_added=${boundedIds(briefing.delta.conflicts_added)}; conflicts_resolved=${boundedIds(briefing.delta.conflicts_resolved)}`,
		`Progress: ${briefing.progress.percent}% (${briefing.progress.verified}/${briefing.progress.denominator} verified/applicable)`,
		`Counts: pending=${counts.pending.length}, in_progress=${counts.in_progress.length}, implemented_unverified=${counts.implemented_unverified.length}, verified=${counts.verified.length}, blocked=${counts.blocked.length}, waived=${counts.waived.length}`,
		`Configured required review gates (not proof of satisfaction): ${briefing.configured_required_gates.join(", ") || "none"}`,
		`Changed requirements: ${boundedRequirements(changedRequirements)}`,
		`At-risk requirements: ${boundedRequirements(atRiskRequirements)}`,
		`Next requirement IDs: ${boundedIds(briefing.next_requirement_ids)}`,
		`Next action: ${nextRequirement ? formatRequirement(nextRequirement) : autoContinue ? "reconcile the completion contract and configured review gates before claiming completion" : "none; report the terminal state only"}`,
		`Blocker IDs: ${boundedIds([
			...briefing.blockers.requirement_ids,
			...briefing.blockers.conflict_ids,
		])}`,
		`Complete authoritative pointer: Work ${briefing.work_id}, semantic fingerprint ${briefing.semantic_fingerprint}.`,
	];
	if (detail === "full") {
		const requirementLines = briefing.requirements.map(
			(requirement) =>
				`- ${requirement.id} [${requirement.status}]: ${requirement.summary}`,
		);
		const requiredCharacters = requirementLines.reduce(
			(total, line) => total + line.length + 1,
			"Current requirements:".length + 1,
		);
		const usedCharacters = lines.reduce(
			(total, line) => total + line.length + 1,
			0,
		);
		if (usedCharacters + requiredCharacters <= MAX_HOOK_CONTEXT_CHARACTERS) {
			lines.push("Current requirements:", ...requirementLines);
		} else {
			lines.push(
				`Full requirement enumeration unavailable in one hook context (${briefing.requirements.length} requirements, ${requiredCharacters} characters). The required authoritative status retrieval above remains mandatory.`,
			);
		}
	}
	const context = lines.join("\n");
	if (context.length > MAX_HOOK_CONTEXT_CHARACTERS) {
		throw new Error("bounded Work hook context exceeded its structural budget");
	}
	return context;
}

function boundedIds(ids: readonly string[]): string {
	return boundedList(ids, LIST_BUDGET, (id) => id);
}

function boundedStatusChanges(
	changes: WorkBriefingSnapshot["delta"]["status_changed"],
): string {
	return boundedList(
		changes,
		LIST_BUDGET,
		(change) => `${change.requirement_id}:${change.from}->${change.to}`,
	);
}

function boundedSuperseded(
	changes: WorkBriefingSnapshot["delta"]["superseded"],
): string {
	return boundedList(
		changes,
		LIST_BUDGET,
		(change) => `${change.requirement_id}->${change.superseded_by}`,
	);
}

function boundedRequirements(
	requirements: WorkBriefingSnapshot["requirements"],
): string {
	return boundedList(
		requirements,
		REQUIREMENT_SUMMARY_BUDGET,
		formatRequirement,
		" | ",
	);
}

function uniqueIds(ids: readonly string[]): string[] {
	return [...new Set(ids)];
}

function boundedSemanticField(value: string, maxLength: number): string {
	const compact = value.replace(/\s+/gu, " ").trim();
	return compact.length <= maxLength
		? compact
		: `[omitted ${compact.length}-character value; retrieve authoritative status]`;
}

function formatRequirement(
	requirement: WorkBriefingSnapshot["requirements"][number],
): string {
	return `${boundedSemanticField(requirement.id, 256)} [${requirement.status}]: ${boundedSemanticField(requirement.summary, 512)}`;
}

function boundedList<T>(
	items: readonly T[],
	budget: number,
	format: (item: T) => string,
	separator = ", ",
): string {
	if (items.length === 0) return "none";
	const shown: string[] = [];
	let used = 0;
	for (const item of items) {
		const formatted = format(item);
		const addition =
			(shown.length === 0 ? 0 : separator.length) + formatted.length;
		if (used + addition > budget) break;
		shown.push(formatted);
		used += addition;
	}
	const omitted = items.length - shown.length;
	const suffix =
		omitted === 0
			? ""
			: `${shown.length === 0 ? "" : separator}… +${omitted} omitted; retrieve authoritative status`;
	return `${shown.join(separator)}${suffix}`;
}

function shellCommandForStatus(workId: string): string {
	return `\`anamnesis work status --work ${shellQuote(workId)} --json\``;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function projectionTruth(projection: WorkProjection) {
	return {
		work_id: projection.work_id,
		revision: projection.contract_revision,
		last_event_id: projection.last_event_id,
		projection_hash: projection.projection_hash,
	};
}

function unavailable(
	reason: WorkHookResult["reason"],
	cursorId: string | null = null,
	boundaryId: string | null = null,
): WorkHookResult {
	return result("unavailable", reason, cursorId, boundaryId);
}

function onboardingUnavailable(
	cursorId: string,
	boundaryId: string,
): WorkHookResult {
	return {
		...unavailable("cursor_unavailable", cursorId, boundaryId),
		context: [
			"Anamnesis Work briefing is unavailable because this foreground session has no linked Work cursor.",
			"If a current Work exists, resume it and run:",
			`anamnesis work switch --work <id> --session ${cursorId}`,
			"Then continue the current task. Do not infer or switch a global Work.",
		].join("\n"),
	};
}

function result(
	status: WorkHookResult["status"],
	reason: WorkHookResult["reason"],
	cursorId: string | null,
	boundaryId: string | null,
): WorkHookResult {
	return {
		schema_version: "anamnesis.work-hook-result.v1",
		status,
		reason,
		context: null,
		cursor_id: cursorId,
		boundary_id: boundaryId,
	};
}
