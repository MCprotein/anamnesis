import * as path from "node:path";

import { findAgentfile, readAgentfile } from "../core/agentfile.js";
import {
	parseWorkContractDraft,
	parseWorkTransitionDraft,
	type WorkContractDraft,
} from "../core/work_command_draft.js";
import {
	calculateWorkContractHash,
	parseTypedWorkEvent,
	type TypedWorkEvent,
	type WorkContractDefinition,
} from "../core/work_contract.js";
import {
	newWorkCursor,
	readWorkCursor,
	updateWorkCursorAtomic,
	type WorkCursor,
	writeWorkCursorAtomic,
} from "../core/work_cursor.js";
import { readWorkLedger } from "../core/work_ledger.js";
import {
	compareWorkPolicySnapshots,
	createWorkPolicySnapshot,
	resolveWorkPolicy,
	type WorkPolicyLayer,
	type WorkPolicySnapshotComparison,
} from "../core/work_policy.js";
import {
	foldWorkProjection,
	rebuildWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import {
	buildWorkBriefingSnapshot,
	confirmReconciliationDelivery,
	emptyWorkCursorReconciliationState,
	prepareReconciliationDelivery,
	type ReconciliationDeliveryBinding,
	type WorkBriefingSnapshot,
} from "../core/work_reconciliation.js";
import {
	type PublishedWorkSourceAllocation,
	appendCanonicalTypedWorkProgressEvent,
	publishAndAppendCanonicalTypedWorkSourceEvent,
	resolveWorkStateRoot,
	type WorkCaptureFidelity,
	type WorkSourceEventInput,
} from "../core/work_storage.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface WorkRawSource {
	event_id: string;
	captured_at: string;
	client: string;
	content_type: string;
	fidelity: WorkCaptureFidelity;
	allocation_status: string;
	body: Buffer;
	attachment_refs?: readonly string[];
}

export interface WorkCommandSourceSelection {
	source_file?: WorkRawSource;
	source_stdin?: WorkRawSource;
}

export interface WorkMutationInput extends WorkCommandSourceSelection {
	project_root: string;
	state_root?: string;
	work_id: string;
	event_id: string;
	occurred_at: string;
	draft: Buffer;
}

export interface WorkMutationResult {
	schema_version: "anamnesis.work-command-result.v1";
	work_id: string;
	ledger_path: string;
	projection_path: string;
	allocation: PublishedWorkSourceAllocation | null;
	projection: WorkProjection;
}

export interface WorkReadInput {
	project_root: string;
	state_root?: string;
	work_id: string;
}

export interface WorkStatusResult {
	schema_version: "anamnesis.work-status.v1";
	work_id: string;
	ledger_path: string;
	projection: WorkProjection;
	policy_drift: WorkPolicySnapshotComparison | null;
}

export interface WorkBriefSection {
	id:
		| "work"
		| "requirements"
		| "done"
		| "remaining"
		| "blockers"
		| "progress"
		| "next";
	label: string;
	values: string[];
}

export interface WorkBriefResult
	extends Omit<WorkStatusResult, "schema_version"> {
	schema_version: "anamnesis.work-brief.v1";
	briefing: WorkBriefingSnapshot;
	sections: WorkBriefSection[];
	delivery: ReconciliationDeliveryBinding;
	delivery_token: string;
	delivery_state: "pending";
}

export interface WorkBriefInput extends WorkReadInput {
	last_reconciled_head?: string | null;
	cursor_id?: string;
	client_session_ref?: string | null;
	occurred_at?: string;
}

export interface ConfirmWorkBriefInput extends WorkReadInput {
	cursor_id: string;
	delivery_token: string;
	confirmed_at: string;
}

export interface ConfirmWorkBriefResult {
	schema_version: "anamnesis.work-brief-confirmation.v1";
	work_id: string;
	cursor_id: string;
	delivery_token: string;
	confirmed_at: string;
}

export interface WorkSwitchAdapter<Result> {
	switchWork(input: {
		state_root: string;
		worktree_fingerprint: string;
		work_id: string;
		projection: WorkProjection;
		cursor_id: string;
		client_session_ref: string | null;
		occurred_at: string;
	}): Result;
}

export interface WorkSwitchInput extends WorkReadInput {
	cursor_id: string;
	client_session_ref: string | null;
	occurred_at: string;
}

export function createWork(input: WorkMutationInput): WorkMutationResult {
	assertSafeId(input.work_id, "work ID");
	const draft = parseWorkContractDraft(input.draft);
	assertBoundaryClassification(draft, "new_unit", "create");
	const source = selectedSource(input);
	assertCurrentSourceReferenced(draft, source.eventId);
	const locations = workLocations(input);
	const ledger = readWorkLedger(locations.ledgerPath);
	if (ledger.records.length !== 0) {
		const existing = ledger.records.find(
			(record) => record.event_id === input.event_id,
		);
		if (!existing || existing.kind !== "work_created") {
			throw new Error(`Work already exists: ${input.work_id}`);
		}
		return appendContract(
			input,
			draft,
			source.value,
			locations,
			1,
			null,
			null,
			ledger.head,
		);
	}
	return appendContract(
		input,
		draft,
		source.value,
		locations,
		1,
		null,
		null,
		ledger.head,
	);
}

export function amendWork(input: WorkMutationInput): WorkMutationResult {
	assertSafeId(input.work_id, "work ID");
	const draft = parseWorkContractDraft(input.draft);
	assertBoundaryClassification(draft, "same_unit", "amend");
	const source = selectedSource(input);
	assertCurrentSourceReferenced(draft, source.eventId);
	const locations = workLocations(input);
	const ledger = readWorkLedger(locations.ledgerPath);
	const existing = ledger.records.find(
		(record) => record.event_id === input.event_id,
	);
	if (existing) {
		if (existing.kind !== "work_contract_revised") {
			throw new Error(`work ledger event ID collision: ${input.event_id}`);
		}
		const revision = existing.payload.contract_revision;
		const previousRevision = existing.payload.previous_contract_revision;
		const previousHash = existing.payload.previous_contract_hash;
		if (
			typeof revision !== "number" ||
			typeof previousRevision !== "number" ||
			typeof previousHash !== "string"
		) {
			throw new Error(`invalid stored Work revision: ${input.event_id}`);
		}
		return appendContract(
			input,
			draft,
			source.value,
			locations,
			revision,
			previousRevision,
			previousHash,
			ledger.head,
		);
	}
	const projection = foldWorkProjection(ledger.records);
	if (projection.work_id !== input.work_id || !projection.contract_hash) {
		throw new Error(`Work ${input.work_id} has no typed contract to amend`);
	}
	return appendContract(
		input,
		draft,
		source.value,
		locations,
		projection.contract_revision + 1,
		projection.contract_revision,
		projection.contract_hash,
		ledger.head,
	);
}

export function transitionWork(input: WorkMutationInput): WorkMutationResult {
	assertSafeId(input.work_id, "work ID");
	const draft = parseWorkTransitionDraft(input.draft);
	const locations = workLocations(input);
	let ledger = readWorkLedger(locations.ledgerPath);
	let projection = foldWorkProjection(ledger.records);
	if (projection.work_id !== input.work_id || !projection.contract_hash) {
		throw new Error(
			`Work ${input.work_id} has no typed contract to transition`,
		);
	}
	if (currentBoundaryState(ledger.records) !== "accepted") {
		throw new Error("Work progress requires an accepted boundary");
	}
	if (
		projection.configured_required_gates.includes("planning") &&
		["in_progress", "implemented_unverified", "verified"].includes(
			draft.status,
		)
	) {
		throw new Error(
			"required planning review evidence is not yet modeled; implementation transition is blocked",
		);
	}
	if (draft.status === "verified" && draft.evidence_refs.length === 0) {
		throw new Error("verified Work requirement transition requires evidence");
	}
	if (draft.status === "waived") {
		const source = selectedSource(input);
		if (!draft.waiver)
			throw new Error("waived transition requires waiver evidence");
		if (draft.waiver.source_event_id !== source.eventId) {
			throw new Error(
				"waiver source_event_id must be the current source event",
			);
		}
		const event = progressEvent(input, draft, projection.contract_hash, source.eventId);
		return publishMutation(locations, source.value, event, ledger.head);
	} else if (draft.waiver) {
		throw new Error("waiver metadata is only valid for a waived transition");
	}
	if (input.source_file || input.source_stdin) {
		throw new Error(
			"non-waiver progress uses evidence_refs and must not create a user source event",
		);
	}
	const basisContractHash = projection.contract_hash;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const priorRecordCount = ledger.records.length;
		const event = progressEvent(input, draft, basisContractHash);
		try {
			appendCanonicalTypedWorkProgressEvent({
				stateRoot: locations.stateRoot,
				ledgerPath: locations.ledgerPath,
				ledgerEvent: event,
				expectedHead: ledger.head,
			});
			const nextProjection = rebuildWorkProjection(
				locations.ledgerPath,
				locations.projectionPath,
			);
			return {
				schema_version: "anamnesis.work-command-result.v1",
				work_id: nextProjection.work_id,
				ledger_path: locations.ledgerPath,
				projection_path: locations.projectionPath,
				allocation: null,
				projection: nextProjection,
			};
		} catch (error) {
			if (!String((error as Error).message).includes("ledger head conflict")) {
				throw error;
			}
			const refreshed = readWorkLedger(locations.ledgerPath);
			assertProgressRetryIsAppendCompatible(
				refreshed.records.slice(priorRecordCount),
				draft.requirement_id,
				event.event_id,
			);
			ledger = refreshed;
			projection = foldWorkProjection(refreshed.records);
			if (projection.contract_hash !== event.payload.basis_contract_hash) {
				throw new Error("Work contract changed during progress transition");
			}
			if (attempt === 2) throw error;
		}
	}
	throw new Error("Work progress transition retry exhausted");
}

export function statusWork(input: WorkReadInput): WorkStatusResult {
	const locations = workLocations(input);
	const projection = foldWorkProjection(
		readWorkLedger(locations.ledgerPath).records,
	);
	if (projection.work_id !== input.work_id)
		throw new Error(`Work not found: ${input.work_id}`);
	return {
		schema_version: "anamnesis.work-status.v1",
		work_id: input.work_id,
		ledger_path: locations.ledgerPath,
		projection,
		policy_drift: detectPolicyDrift(input.project_root, projection),
	};
}

export function briefWork(input: WorkBriefInput): WorkBriefResult {
	const locations = workLocations(input);
	const ledger = readWorkLedger(locations.ledgerPath);
	const status = statusWork(input);
	let previousConfirmed: WorkBriefingSnapshot | null = null;
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	let cursor: WorkCursor | null = null;
	if (input.cursor_id) {
		const read = readWorkCursor(
			state.state_root,
			input.cursor_id,
			undefined,
			state.worktree_fingerprint,
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
				state.state_root,
				{ ...cursor, reconciliation },
				truth,
				input.occurred_at,
			);
		} else {
			const fresh = newWorkCursor({
				cursor_id: input.cursor_id,
				client_session_ref: input.client_session_ref ?? null,
				worktree_fingerprint: state.worktree_fingerprint,
				updated_at: input.occurred_at,
				truth,
			});
			fresh.reconciliation = prepareReconciliationDelivery(
				fresh.reconciliation!,
				delivery,
			);
			writeWorkCursorAtomic(state.state_root, fresh, {
				expectedCursorRevision: null,
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

export function switchWork<Result>(
	input: WorkSwitchInput,
	adapter: WorkSwitchAdapter<Result>,
): Result {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const status = statusWork(input);
	return adapter.switchWork({
		state_root: state.state_root,
		worktree_fingerprint: state.worktree_fingerprint,
		work_id: input.work_id,
		projection: status.projection,
		cursor_id: input.cursor_id,
		client_session_ref: input.client_session_ref,
		occurred_at: input.occurred_at,
	});
}

function appendContract(
	input: WorkMutationInput,
	draft: WorkContractDraft,
	source: WorkSourceEventInput,
	locations: WorkLocations,
	revision: number,
	previousRevision: number | null,
	previousHash: string | null,
	expectedHead: string | null,
): WorkMutationResult {
	const records = readWorkLedger(locations.ledgerPath).records;
	const storedEvent = records.find((record) => record.event_id === input.event_id);
	const storedPolicy = storedEvent
		? parseStoredContractPolicy(storedEvent)
		: null;
	const priorProjection = revision > 1 ? foldWorkProjection(records) : null;
	const priorPolicy = storedPolicy ?? priorProjection?.policy_snapshot ?? null;
	if (revision > 1 && !priorPolicy) {
		throw new Error("prior Work policy snapshot is missing");
	}
	const policy = createWorkPolicySnapshot(
		revision,
		priorPolicy?.policy ?? resolveCommandPolicy(input),
	);
	const contract: WorkContractDefinition = {
		...draft,
		work: { id: input.work_id, ...draft.work },
		policy_snapshot: policy,
	};
	const contractHash = calculateWorkContractHash(contract);
	const event: TypedWorkEvent = {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: revision === 1 ? "work_created" : "work_contract_revised",
		payload: {
			schema_version: "anamnesis.work-contract-event.v1",
			work_id: input.work_id,
			contract_revision: revision,
			previous_contract_revision: previousRevision,
			previous_contract_hash: previousHash,
			contract_hash: contractHash,
			contract,
			source_event_id: source.eventId,
		},
	};
	return publishMutation(locations, source, event, expectedHead);
}

function parseStoredContractPolicy(
	record: ReturnType<typeof readWorkLedger>["records"][number],
): NonNullable<WorkProjection["policy_snapshot"]> | null {
	if (record.kind !== "work_created" && record.kind !== "work_contract_revised") {
		return null;
	}
	const parsed = parseTypedWorkEvent(record);
	return parsed.kind === "work_created" || parsed.kind === "work_contract_revised"
		? parsed.payload.contract.policy_snapshot
		: null;
}

function currentBoundaryState(
	records: ReturnType<typeof readWorkLedger>["records"],
): WorkContractDefinition["boundary"]["state"] | null {
	for (let index = records.length - 1; index >= 0; index -= 1) {
		const record = records[index]!;
		if (record.kind !== "work_created" && record.kind !== "work_contract_revised") {
			continue;
		}
		const parsed = parseTypedWorkEvent(record);
		if (parsed.kind === "work_created" || parsed.kind === "work_contract_revised") {
			return parsed.payload.contract.boundary.state;
		}
	}
	return null;
}

function publishMutation(
	locations: WorkLocations,
	source: WorkSourceEventInput,
	event: TypedWorkEvent,
	expectedHead: string | null,
): WorkMutationResult {
	const existing = readWorkLedger(locations.ledgerPath).records.find(
		(record) => record.event_id === event.event_id,
	);
	if (existing) assertIdempotentMutationCandidate(existing, event, source.eventId);
	const allocation = publishAndAppendCanonicalTypedWorkSourceEvent({
		source,
		ledgerPath: locations.ledgerPath,
		ledgerEvent: event,
		expectedHead,
	});
	const projection = rebuildWorkProjection(
		locations.ledgerPath,
		locations.projectionPath,
	);
	return {
		schema_version: "anamnesis.work-command-result.v1",
		work_id: projection.work_id,
		ledger_path: locations.ledgerPath,
		projection_path: locations.projectionPath,
		allocation,
		projection,
	};
}

function assertIdempotentMutationCandidate(
	existing: ReturnType<typeof readWorkLedger>["records"][number],
	candidate: TypedWorkEvent,
	sourceEventId: string,
): void {
	const sameBase =
		existing.kind === candidate.kind &&
		existing.occurred_at === candidate.occurred_at &&
		existing.payload.source_event_id === sourceEventId;
	const sameSemanticPayload =
		candidate.kind === "work_created" ||
		candidate.kind === "work_contract_revised"
			? existing.payload.contract_hash === candidate.payload.contract_hash &&
				existing.payload.contract_revision ===
					candidate.payload.contract_revision
			: candidate.kind === "work_requirement_transitioned"
				? existing.payload.requirement_id === candidate.payload.requirement_id &&
					existing.payload.basis_contract_hash ===
					candidate.payload.basis_contract_hash &&
					existing.payload.status === candidate.payload.status &&
					JSON.stringify(existing.payload.evidence_refs) ===
						JSON.stringify(candidate.payload.evidence_refs) &&
					JSON.stringify(existing.payload.waiver ?? null) ===
						JSON.stringify(candidate.payload.waiver ?? null)
				: false;
	if (!sameBase || !sameSemanticPayload) {
		throw new Error(`work ledger event ID collision: ${candidate.event_id}`);
	}
}

function resolveCommandPolicy(input: Pick<WorkMutationInput, "project_root">) {
	const layers: WorkPolicyLayer[] = [];
	const agentfilePath = findAgentfile(input.project_root);
	if (agentfilePath) {
		const agentfile = readAgentfile(input.project_root);
		const config =
			agentfile.version === 2 ? agentfile.settings?.work_policy : undefined;
		if (config) {
			layers.push({
				kind: "project",
				config,
				source_refs: [{ source: "agentfile", ref: agentfilePath }],
			});
		}
	}
	return resolveWorkPolicy(layers);
}

function progressEvent(
	input: WorkMutationInput,
	draft: ReturnType<typeof parseWorkTransitionDraft>,
	basisContractHash: string,
	sourceEventId?: string,
): Extract<TypedWorkEvent, { kind: "work_requirement_transitioned" }> {
	return {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: "work_requirement_transitioned",
		payload: {
			schema_version: "anamnesis.work-progress-event.v1",
			work_id: input.work_id,
			requirement_id: draft.requirement_id,
			basis_contract_hash: basisContractHash,
			status: draft.status,
			evidence_refs: draft.evidence_refs,
			...(draft.waiver ? { waiver: draft.waiver } : {}),
			...(sourceEventId ? { source_event_id: sourceEventId } : {}),
		},
	};
}

function assertBoundaryClassification(
	draft: WorkContractDraft,
	expected: "new_unit" | "same_unit",
	command: "create" | "amend",
): void {
	if (draft.boundary.state !== "accepted") {
		throw new Error(`work ${command} requires boundary.state=accepted`);
	}
	if (draft.boundary.classification === "interruption") {
		throw new Error("interruption must not mutate or create a Work");
	}
	if (draft.boundary.classification !== expected) {
		throw new Error(
			`work ${command} requires boundary.classification=${expected}`,
		);
	}
}

function detectPolicyDrift(
	projectRoot: string,
	projection: WorkProjection,
): WorkPolicySnapshotComparison | null {
	const frozen = projection.policy_snapshot;
	if (!frozen) return null;
	const current = createWorkPolicySnapshot(
		frozen.revision,
		resolveCommandPolicy({ project_root: projectRoot }),
	);
	return compareWorkPolicySnapshots(frozen, current);
}

export function assertProgressRetryIsAppendCompatible(
	interveningRecords: readonly ReturnType<typeof readWorkLedger>["records"][number][],
	requirementId: string,
	candidateEventId: string,
): void {
	const conflict = interveningRecords.some(
		(record) =>
			record.event_id !== candidateEventId &&
			record.kind === "work_requirement_transitioned" &&
			record.payload.requirement_id === requirementId,
	);
	if (conflict) {
		throw new Error(
			`concurrent Work requirement transition conflict: ${requirementId}`,
		);
	}
}

function assertCurrentSourceReferenced(
	draft: WorkContractDraft,
	sourceEventId: string,
): void {
	const referenced =
		draft.requirements.some((item) =>
			item.source_event_ids.includes(sourceEventId),
		) ||
		draft.open_conflicts.some((item) =>
			item.source_event_ids.includes(sourceEventId),
		);
	if (!referenced)
		throw new Error("contract draft must reference the current source event");
}

function selectedSource(input: WorkMutationInput): {
	eventId: string;
	value: WorkSourceEventInput;
} {
	const selected = [input.source_file, input.source_stdin].filter(
		(value) => value !== undefined,
	);
	if (selected.length !== 1) {
		throw new Error("exactly one of source_file or source_stdin is required");
	}
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const value = selected[0]!;
	if ("body" in value && !(value.body instanceof Buffer)) {
		throw new Error("raw Work source body must be a Buffer");
	}
	const source: WorkSourceEventInput = {
		stateRoot: state.state_root,
		eventId: value.event_id,
		capturedAt: value.captured_at,
		client: value.client,
		contentType: value.content_type,
		fidelity: value.fidelity,
		allocationStatus: value.allocation_status,
		body: Buffer.from(value.body),
		attachmentRefs: value.attachment_refs,
	};
	assertSafeId(source.eventId, "source event ID");
	return { eventId: source.eventId, value: source };
}

interface WorkLocations {
	stateRoot: string;
	ledgerPath: string;
	projectionPath: string;
}

function workLocations(input: WorkReadInput): WorkLocations {
	assertSafeId(input.work_id, "work ID");
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const directory = path.join(state.state_root, "work-units", input.work_id);
	return {
		stateRoot: state.state_root,
		ledgerPath: path.join(directory, "ledger.jsonl"),
		projectionPath: path.join(directory, "projection.yaml"),
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

function projectionTruth(projection: WorkProjection) {
	return {
		work_id: projection.work_id,
		revision: projection.contract_revision,
		last_event_id: projection.last_event_id,
		projection_hash: projection.projection_hash,
	};
}

function assertSafeId(value: string, label: string): void {
	if (!SAFE_ID.test(value)) throw new Error(`invalid ${label}`);
}
