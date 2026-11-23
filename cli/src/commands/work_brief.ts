import {
	newWorkCursor,
	readWorkCursor,
	updateWorkCursorAtomic,
	type WorkCursor,
	writeWorkCursorAtomic,
} from "../core/work_cursor.js";
import { readWorkLedger } from "../core/work_ledger.js";
import { foldWorkProjection } from "../core/work_projection.js";
import {
	buildWorkBriefingSnapshot,
	confirmReconciliationDelivery,
	emptyWorkCursorReconciliationState,
	prepareReconciliationDelivery,
	type ReconciliationDeliveryBinding,
	type WorkBriefingSnapshot,
} from "../core/work_reconciliation.js";
import { resolveStateRootFor } from "../core/work_state_root_resolver.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { workLocations } from "./work_command_input.js";
import {
	projectionTruth,
	statusResultFromProjection,
	statusWork,
} from "./work_status.js";
import type {
	ConfirmWorkBriefInput,
	ConfirmWorkBriefResult,
	WorkBriefInput,
	WorkBriefResult,
	WorkBriefSection,
} from "./work_types.js";

export function briefWork(input: WorkBriefInput): WorkBriefResult {
	const locations = workLocations(input);
	const ledger = readWorkLedger(locations.ledgerPath);
	const projection = foldWorkProjection(ledger.records);
	if (projection.work_id !== input.work_id)
		throw new Error(`Work not found: ${input.work_id}`);
	const status = statusResultFromProjection(
		input,
		locations.ledgerPath,
		projection,
	);
	let previousConfirmed: WorkBriefingSnapshot | null = null;
	const state = input.cursor_id ? resolveStateRootFor(input) : null;
	let cursor: WorkCursor | null = null;
	if (input.cursor_id) {
		const read = readWorkCursor(
			state!.state_root,
			input.cursor_id,
			undefined,
			state!.worktree_fingerprint,
		);
		if (read.status === "corrupt") throw new Error(read.error);
		if (read.status === "switched") {
			throw new Error("Work cursor belongs to another worktree");
		}
		cursor = read.cursor;
		if (cursor && cursor.work_id !== input.work_id) {
			throw new Error("Work cursor targets another Work; switch it explicitly");
		}
	}
	const baselineHead =
		input.last_reconciled_head ??
		cursor?.reconciliation?.last_reconciled_head ??
		null;
	if (baselineHead) {
		const baselineIndex = ledger.records.findIndex(
			(record) => record.record_hash === baselineHead,
		);
		if (baselineIndex < 0) {
			throw new Error("last reconciled ledger head is not in this Work ledger");
		}
		previousConfirmed = buildWorkBriefingSnapshot({
			projection: foldWorkProjection(
				ledger.records.slice(0, baselineIndex + 1),
			),
		});
	}
	const briefing = buildWorkBriefingSnapshot({
		projection: status.projection,
		previous_confirmed: previousConfirmed,
	});
	const delivery: ReconciliationDeliveryBinding = {
		fingerprint: briefing.semantic_fingerprint,
		ledger_head: status.projection.ledger_head,
		contract_revision: status.projection.contract_revision,
		contract_hash: status.projection.contract_hash,
		policy_hash: status.projection.policy_hash,
	};
	if (input.cursor_id) {
		if (!input.occurred_at)
			throw new Error("occurred_at is required with cursor_id");
		const truth = projectionTruth(status.projection);
		if (cursor) {
			const reconciliation = prepareReconciliationDelivery(
				cursor.reconciliation ?? emptyWorkCursorReconciliationState(),
				delivery,
			);
			updateWorkCursorAtomic(
				state!.state_root,
				{ ...cursor, reconciliation },
				truth,
				input.occurred_at,
			);
		} else {
			const fresh = newWorkCursor({
				cursor_id: input.cursor_id,
				client_session_ref: input.client_session_ref ?? null,
				worktree_fingerprint: state!.worktree_fingerprint,
				updated_at: input.occurred_at,
				truth,
			});
			fresh.reconciliation = prepareReconciliationDelivery(
				fresh.reconciliation!,
				delivery,
			);
			writeWorkCursorAtomic(state!.state_root, fresh, {
				expectedCursorRevision: null,
				durability: input.durability,
			});
		}
	}
	return {
		...status,
		schema_version: "anamnesis.work-brief.v1",
		briefing,
		sections: orderedBriefSections(briefing),
		delivery,
		delivery_token: briefing.semantic_fingerprint,
		delivery_state: "pending",
	};
}

/** Persist delivery only after the renderer reports the exact pending token. */
export function confirmWorkBrief(
	input: ConfirmWorkBriefInput,
): ConfirmWorkBriefResult {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const read = readWorkCursor(
		state.state_root,
		input.cursor_id,
		undefined,
		state.worktree_fingerprint,
	);
	if (read.status === "switched") {
		throw new Error("Work cursor belongs to another worktree");
	}
	if (!read.cursor) {
		throw new Error("Work briefing cursor is unavailable");
	}
	const cursor = read.cursor;
	if (cursor.work_id !== input.work_id)
		throw new Error("Work briefing cursor targets another Work");
	const pending = cursor.reconciliation?.pending_delivery;
	if (!pending || pending.fingerprint !== input.delivery_token) {
		throw new Error("Work briefing delivery token mismatch");
	}
	const reconciliation = confirmReconciliationDelivery(cursor.reconciliation!, {
		...pending,
		confirmed_at: input.confirmed_at,
	});
	const projection = statusWork(input).projection;
	updateWorkCursorAtomic(
		state.state_root,
		{ ...cursor, reconciliation },
		projectionTruth(projection),
		input.confirmed_at,
	);
	return {
		schema_version: "anamnesis.work-brief-confirmation.v1",
		work_id: input.work_id,
		cursor_id: input.cursor_id,
		delivery_token: input.delivery_token,
		confirmed_at: input.confirmed_at,
	};
}

function orderedBriefSections(
	briefing: WorkBriefingSnapshot,
): WorkBriefSection[] {
	const requirementLines = briefing.requirements.map(
		(item) => `${item.id}: ${item.summary} [${item.status}]`,
	);
	const lineById = new Map(
		briefing.requirements.map(
			(item, index) => [item.id, requirementLines[index]!] as const,
		),
	);
	const lines = (ids: readonly string[]) =>
		ids.map((id) => lineById.get(id) ?? id);
	const done = lines([
		...briefing.requirement_ids_by_status.verified,
		...briefing.requirement_ids_by_status.waived,
	]);
	const remaining = lines([
		...briefing.requirement_ids_by_status.in_progress,
		...briefing.requirement_ids_by_status.implemented_unverified,
		...briefing.requirement_ids_by_status.pending,
		...briefing.requirement_ids_by_status.blocked,
	]);
	return [
		{
			id: "work",
			label: "Work",
			values: [
				briefing.work_id,
				briefing.work.title ?? "",
				briefing.work.completion_contract ?? "",
				`required_gates: ${briefing.configured_required_gates.join(", ") || "none"}`,
			],
		},
		{
			id: "requirements",
			label: "Requirements",
			values: requirementLines,
		},
		{ id: "done", label: "Done", values: done },
		{ id: "remaining", label: "Remaining", values: remaining },
		{
			id: "blockers",
			label: "Blockers",
			values: [
				...briefing.blockers.requirement_ids,
				...briefing.blockers.conflict_ids,
			],
		},
		{
			id: "progress",
			label: "Progress",
			values: [
				`${briefing.progress.percent}%`,
				`mode: ${briefing.progress.mode}`,
				`denominator: ${briefing.progress.denominator}`,
			],
		},
		{ id: "next", label: "Next", values: briefing.next_requirement_ids },
	];
}
