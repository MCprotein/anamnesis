import {
	parseTypedWorkEvent,
	type SourceFreeWorkEvidenceEvent,
	type TypedWorkEvent,
} from "../core/work_contract.js";
import {
	resolveWorkExecutionInputs,
	type WorkExecutionInputs,
} from "../core/work_execution_inputs.js";
import { readWorkLedger } from "../core/work_ledger.js";
import {
	foldWorkProjection,
	rebuildWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import { appendCanonicalTypedWorkEvidenceEvent } from "../core/work_storage.js";
import { workLocations, type WorkLocations } from "./work_command_input.js";
import type {
	WorkEvidenceMutationInput,
	WorkMutationResult,
	WorkReadInput,
} from "./work_types.js";

type ExecutionMutationContext = {
	locations: WorkLocations;
	ledger: ReturnType<typeof readWorkLedger>;
	projection: WorkProjection;
};

export function executionMutationContext(
	input: WorkReadInput,
): ExecutionMutationContext {
	const locations = workLocations(input);
	const ledger = readWorkLedger(locations.ledgerPath);
	const projection = foldWorkProjection(ledger.records);
	if (
		!projection.contract_hash ||
		!projection.policy_hash ||
		!projection.policy_snapshot
	) {
		throw new Error(`Work ${input.work_id} has no typed execution contract`);
	}
	return { locations, ledger, projection };
}

export function executionBasis(projection: WorkProjection) {
	if (!projection.contract_hash || !projection.policy_hash)
		throw new Error("Work execution basis is unavailable");
	return {
		work_id: projection.work_id,
		basis_contract_revision: projection.contract_revision,
		basis_contract_hash: projection.contract_hash,
		policy_hash: projection.policy_hash,
	};
}

export function resolveCanonicalInputs(
	input: WorkReadInput,
	projection: WorkProjection,
	executionInputs?: WorkExecutionInputs,
) {
	if (!projection.contract_hash || !projection.policy_hash)
		throw new Error("Work execution basis is unavailable");
	return resolveWorkExecutionInputs({
		repositoryRoot: input.project_root,
		stateRoot: input.state_root,
		workId: projection.work_id,
		contractRevision: projection.contract_revision,
		contractHash: projection.contract_hash,
		policyHash: projection.policy_hash,
		executionInputs,
	});
}

export function requiredReviewGate(
	projection: WorkProjection,
	gate: "planning" | "completion",
) {
	const configured = projection.policy_snapshot?.policy.review.gates.find(
		(item) => item.gate === gate,
	);
	if (!configured || configured.enforcement === "off")
		throw new Error(`${gate} review is not configured for this Work`);
	return configured;
}

export function latestReviewRequest(
	records: ReturnType<typeof readWorkLedger>["records"],
	gate: "planning" | "completion",
) {
	for (let index = records.length - 1; index >= 0; index -= 1) {
		const record = records[index]!;
		if (record.kind !== "work_review_requested") continue;
		const event = parseTypedWorkEvent(record);
		if (event.kind === "work_review_requested" && event.payload.gate === gate)
			return event;
	}
	return null;
}

export function latestParallelismAssessment(
	records: ReturnType<typeof readWorkLedger>["records"],
) {
	for (let index = records.length - 1; index >= 0; index -= 1) {
		const record = records[index]!;
		if (record.kind !== "work_parallelism_assessed") continue;
		const event = parseTypedWorkEvent(record);
		if (event.kind === "work_parallelism_assessed") return event;
	}
	return null;
}

export function appendEvidenceMutation(
	input: WorkEvidenceMutationInput,
	context: ExecutionMutationContext,
	event: SourceFreeWorkEvidenceEvent,
): WorkMutationResult {
	appendCanonicalTypedWorkEvidenceEvent({
		stateRoot: context.locations.stateRoot,
		ledgerPath: context.locations.ledgerPath,
		ledgerEvent: event,
		expectedHead: input.expected_head,
	});
	const projection = rebuildWorkProjection(
		context.locations.ledgerPath,
		context.locations.projectionPath,
	);
	return {
		schema_version: "anamnesis.work-command-result.v1",
		work_id: projection.work_id,
		ledger_path: context.locations.ledgerPath,
		projection_path: context.locations.projectionPath,
		allocation: null,
		projection,
	};
}

function mutationResultFromContext(
	context: ExecutionMutationContext,
): WorkMutationResult {
	return {
		schema_version: "anamnesis.work-command-result.v1",
		work_id: context.projection.work_id,
		ledger_path: context.locations.ledgerPath,
		projection_path: context.locations.projectionPath,
		allocation: null,
		projection: context.projection,
	};
}

export function exactStoredRetry(
	input: Pick<
		WorkEvidenceMutationInput,
		"event_id" | "occurred_at" | "expected_head"
	>,
	context: ExecutionMutationContext,
	kind: TypedWorkEvent["kind"],
	matches: (event: TypedWorkEvent) => boolean,
): WorkMutationResult | null {
	const record = context.ledger.records.find(
		(item) => item.event_id === input.event_id,
	);
	if (!record) return null;
	const event = parseTypedWorkEvent(record);
	if (
		event.kind !== kind ||
		event.occurred_at !== input.occurred_at ||
		record.previous_hash !== input.expected_head ||
		!matches(event)
	) {
		throw new Error(`work ledger event ID collision: ${input.event_id}`);
	}
	return mutationResultFromContext(context);
}
