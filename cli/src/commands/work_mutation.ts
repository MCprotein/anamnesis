import { z } from "zod";
import {
	parseSingleWorkDraft,
	parseWorkContractDraft,
	type WorkContractDraft,
} from "../core/work_command_draft.js";
import {
	calculateWorkContractHash,
	parseTypedWorkEvent,
	type TypedWorkEvent,
	type WorkContractDefinition,
} from "../core/work_contract.js";
import type { WorkProtectedActionReadiness } from "../core/work_execution_contract.js";
import { readWorkLedger } from "../core/work_ledger.js";
import { createWorkPolicySnapshot } from "../core/work_policy.js";
import {
	foldWorkProjection,
	rebuildWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import {
	appendCanonicalTypedWorkEventWithPublishedSource,
	appendCanonicalTypedWorkProgressEvent,
	publishAndAppendCanonicalTypedWorkSourceEvent,
	type WorkSourceEventInput,
} from "../core/work_storage.js";
import {
	assertSafeId,
	selectedSource,
	workLocations,
	type WorkLocations,
} from "./work_command_input.js";
import {
	closeWithExecutionInputsSchema,
	transitionWithExecutionInputsSchema,
} from "./work_draft_schemas.js";
import {
	exactStoredRetry,
	executionBasis,
	executionMutationContext,
	resolveCanonicalInputs,
} from "./work_execution_mutation.js";
import { resolveCommandPolicy } from "./work_policy_resolution.js";
import { readinessForProjection } from "./work_status.js";
import type {
	PublicWorkExecutionMutationResult,
	WorkCloseInput,
	WorkMutationInput,
	WorkMutationResult,
} from "./work_types.js";

export function publicWorkExecutionMutation(
	result: WorkMutationResult,
): PublicWorkExecutionMutationResult {
	if (!result.execution_contract)
		throw new Error("Work execution command contract is unavailable");
	return {
		schema_version: "anamnesis.work-execution-command-result.v1",
		work_id: result.work_id,
		ledger_head: result.projection.ledger_head,
		execution_contract: result.execution_contract,
		...(result.readiness ? { readiness: result.readiness } : {}),
	};
}

export function createWork(input: WorkMutationInput): WorkMutationResult {
	if (input.expected_head !== undefined && input.expected_head !== null) {
		throw new Error("work create requires expected_head=null");
	}
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
	if (input.expected_head === undefined || input.expected_head === null) {
		throw new Error("work amend requires an explicit expected_head");
	}
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
			input.expected_head,
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
		input.expected_head,
	);
}

export function transitionWork(input: WorkMutationInput): WorkMutationResult {
	if (input.expected_head === undefined || input.expected_head === null) {
		throw new Error("work transition requires an explicit expected_head");
	}
	assertSafeId(input.work_id, "work ID");
	const draft = parseSingleWorkDraft(
		input.draft,
		transitionWithExecutionInputsSchema,
	);
	const locations = workLocations(input);
	const ledger = readWorkLedger(locations.ledgerPath);
	const projection = foldWorkProjection(ledger.records);
	if (projection.work_id !== input.work_id || !projection.contract_hash) {
		throw new Error(
			`Work ${input.work_id} has no typed contract to transition`,
		);
	}
	const retry =
		draft.status === "waived"
			? null
			: exactStoredRetry(
					{
						event_id: input.event_id,
						occurred_at: input.occurred_at,
						expected_head: input.expected_head,
					},
					{ locations, ledger, projection },
					"work_requirement_transitioned",
					(event) =>
						event.kind === "work_requirement_transitioned" &&
						event.payload.requirement_id === draft.requirement_id &&
						event.payload.status === draft.status &&
						JSON.stringify(event.payload.evidence_refs) ===
							JSON.stringify(draft.evidence_refs) &&
						JSON.stringify(event.payload.waiver ?? null) ===
							JSON.stringify(draft.waiver ?? null),
				);
	if (retry) return retry;
	if (draft.status === "waived") {
		const stored = ledger.records.find(
			(record) => record.event_id === input.event_id,
		);
		if (stored) {
			const event = parseTypedWorkEvent(stored);
			if (
				event.kind !== "work_requirement_transitioned" ||
				event.occurred_at !== input.occurred_at ||
				stored.previous_hash !== input.expected_head ||
				event.payload.requirement_id !== draft.requirement_id ||
				event.payload.status !== draft.status ||
				JSON.stringify(event.payload.evidence_refs) !==
					JSON.stringify(draft.evidence_refs) ||
				JSON.stringify(event.payload.waiver ?? null) !==
					JSON.stringify(draft.waiver ?? null)
			)
				throw new Error(`work ledger event ID collision: ${input.event_id}`);
			const source = selectedSource(input);
			return publishMutation(
				locations,
				source.value,
				event,
				input.expected_head,
			);
		}
	}
	if (currentBoundaryState(ledger.records) !== "accepted") {
		throw new Error("Work progress requires an accepted boundary");
	}
	let readiness: WorkProtectedActionReadiness | undefined;
	if (
		["in_progress", "implemented_unverified", "verified"].includes(draft.status)
	) {
		readiness = readinessForProjection(
			input,
			projection,
			"implementation_entry",
			draft.execution_inputs,
		);
		if (!readiness.allowed) {
			throw new Error(
				`Work implementation entry is blocked: ${readiness.blockers.join(", ")}`,
			);
		}
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
		const event = progressEvent(
			input,
			draft,
			projection.contract_hash,
			source.eventId,
		);
		return publishMutation(locations, source.value, event, input.expected_head);
	} else if (draft.waiver) {
		throw new Error("waiver metadata is only valid for a waived transition");
	}
	if (input.source_file || input.source_stdin) {
		throw new Error(
			"non-waiver progress uses evidence_refs and must not create a user source event",
		);
	}
	const basisContractHash = projection.contract_hash;
	const event = progressEvent(input, draft, basisContractHash);
	appendCanonicalTypedWorkProgressEvent({
		stateRoot: locations.stateRoot,
		ledgerPath: locations.ledgerPath,
		ledgerEvent: event,
		expectedHead: input.expected_head,
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
		...(readiness ? { readiness } : {}),
	};
}

export function closeWork(input: WorkCloseInput): WorkMutationResult {
	assertSafeId(input.work_id, "work ID");
	const draft = parseSingleWorkDraft(
		input.draft,
		closeWithExecutionInputsSchema,
	);
	const context = executionMutationContext(input);
	const { projection } = context;
	const canonicalInputs = resolveCanonicalInputs(
		input,
		projection,
		draft.execution_inputs,
	);
	const completionReviewInputHash =
		canonicalInputs.completion_review &&
		"review_input_hash" in canonicalInputs.completion_review
			? canonicalInputs.completion_review.review_input_hash
			: null;
	const storedIndex = context.ledger.records.findIndex(
		(record) => record.event_id === input.event_id,
	);
	const basisProjectionHash =
		storedIndex >= 0
			? foldWorkProjection(context.ledger.records.slice(0, storedIndex))
					.projection_hash
			: projection.projection_hash;
	const retry = exactStoredRetry(
		input,
		context,
		"work_lifecycle_changed",
		(event) =>
			event.kind === "work_lifecycle_changed" &&
			event.payload.lifecycle === "completed" &&
			event.payload.basis_contract_revision ===
				input.expected_contract_revision &&
			event.payload.basis_contract_hash === input.expected_contract_hash &&
			event.payload.basis_projection_hash === basisProjectionHash &&
			event.payload.authority_kind === draft.authority.kind &&
			event.payload.authority_ref === draft.authority.authority_ref &&
			event.payload.source_event_id === draft.authority.source_event_id &&
			event.payload.completion_review_input_hash ===
				completionReviewInputHash &&
			JSON.stringify(event.payload.evidence_refs) ===
				JSON.stringify(draft.evidence_refs),
	);
	if (retry) {
		const stored = context.ledger.records[storedIndex];
		if (!stored) throw new Error("stored Work close retry is unavailable");
		const allocation = appendCanonicalTypedWorkEventWithPublishedSource({
			stateRoot: context.locations.stateRoot,
			sourceEventId: draft.authority.source_event_id,
			ledgerPath: context.locations.ledgerPath,
			ledgerEvent: parseTypedWorkEvent(stored),
			expectedHead: input.expected_head,
		});
		return { ...retry, allocation };
	}
	if (projection.contract_revision !== input.expected_contract_revision) {
		throw new Error("Work close expected contract revision is stale");
	}
	if (projection.contract_hash !== input.expected_contract_hash) {
		throw new Error("Work close expected contract hash is stale");
	}
	if (projection.lifecycle !== "open") {
		throw new Error("Work is already terminal and cannot be closed again");
	}
	const authorityIsBound = projection.requirements.some((requirement) =>
		requirement.source_event_ids.includes(draft.authority.source_event_id),
	);
	if (!authorityIsBound) {
		throw new Error(
			"Work close authority source must be referenced by the current contract",
		);
	}
	if (!projection.requirements_ready) {
		throw new Error(
			"Work close requires every applicable requirement verified or waived, an accepted boundary, and no open conflicts",
		);
	}
	const readiness = readinessForProjection(
		input,
		projection,
		"completion",
		draft.execution_inputs,
	);
	if (!readiness.allowed) {
		throw new Error(`Work close is blocked: ${readiness.blockers.join(", ")}`);
	}
	const event: Extract<TypedWorkEvent, { kind: "work_lifecycle_changed" }> = {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: "work_lifecycle_changed",
		payload: {
			schema_version: "anamnesis.work-lifecycle-event.v1",
			...executionBasis(projection),
			basis_projection_hash: basisProjectionHash,
			lifecycle: "completed",
			authority_kind: draft.authority.kind,
			authority_ref: draft.authority.authority_ref,
			evidence_refs: draft.evidence_refs,
			completion_review_input_hash: completionReviewInputHash,
			source_event_id: draft.authority.source_event_id,
		},
	};
	const allocation = appendCanonicalTypedWorkEventWithPublishedSource({
		stateRoot: context.locations.stateRoot,
		sourceEventId: draft.authority.source_event_id,
		ledgerPath: context.locations.ledgerPath,
		ledgerEvent: event,
		expectedHead: input.expected_head,
	});
	const nextProjection = rebuildWorkProjection(
		context.locations.ledgerPath,
		context.locations.projectionPath,
	);
	return {
		schema_version: "anamnesis.work-command-result.v1",
		work_id: nextProjection.work_id,
		ledger_path: context.locations.ledgerPath,
		projection_path: context.locations.projectionPath,
		allocation,
		projection: nextProjection,
		readiness,
	};
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
	const storedEvent = records.find(
		(record) => record.event_id === input.event_id,
	);
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
	if (
		record.kind !== "work_created" &&
		record.kind !== "work_contract_revised"
	) {
		return null;
	}
	const parsed = parseTypedWorkEvent(record);
	return parsed.kind === "work_created" ||
		parsed.kind === "work_contract_revised"
		? parsed.payload.contract.policy_snapshot
		: null;
}

function currentBoundaryState(
	records: ReturnType<typeof readWorkLedger>["records"],
): WorkContractDefinition["boundary"]["state"] | null {
	for (let index = records.length - 1; index >= 0; index -= 1) {
		const record = records[index]!;
		if (
			record.kind !== "work_created" &&
			record.kind !== "work_contract_revised"
		) {
			continue;
		}
		const parsed = parseTypedWorkEvent(record);
		if (
			parsed.kind === "work_created" ||
			parsed.kind === "work_contract_revised"
		) {
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
	if (existing)
		assertIdempotentMutationCandidate(existing, event, source.eventId);
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

export function assertIdempotentMutationCandidate(
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
				? existing.payload.requirement_id ===
						candidate.payload.requirement_id &&
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

function progressEvent(
	input: WorkMutationInput,
	draft: z.infer<typeof transitionWithExecutionInputsSchema>,
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

export function assertBoundaryClassification(
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

export function assertProgressRetryIsAppendCompatible(
	interveningRecords: readonly ReturnType<
		typeof readWorkLedger
	>["records"][number][],
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

export function assertCurrentSourceReferenced(
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
