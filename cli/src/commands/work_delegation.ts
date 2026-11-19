import { parseSingleWorkDraft } from "../core/work_command_draft.js";
import {
	calculateWorkDelegationContractHash,
	calculateWorkDelegationFailureFingerprint,
	parseTypedWorkEvent,
	type SourceFreeWorkEvidenceEvent,
	type WorkDelegationOutcomePayload,
} from "../core/work_contract.js";
import { selectDelegationProvider } from "../core/work_execution_contract.js";
import { resolveWorkExecutionInputs } from "../core/work_execution_inputs.js";
import {
	rebuildWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import {
	publishAndAppendCanonicalTypedWorkSourceEvent,
	publishWorkSourceEvent,
} from "../core/work_storage.js";
import { selectedSource } from "./work_command_input.js";
import {
	delegationAssessDraftSchema,
	delegationRecordDraftSchema,
	delegationWaiveDraftSchema,
} from "./work_draft_schemas.js";
import {
	appendEvidenceMutation,
	exactStoredRetry,
	executionBasis,
	executionMutationContext,
	latestParallelismAssessment,
	resolveCanonicalInputs,
} from "./work_execution_mutation.js";
import { readinessForProjection } from "./work_status.js";
import type {
	WorkDelegationWaiveInput,
	WorkEvidenceMutationInput,
	WorkExecutionCommandContract,
	WorkMutationResult,
} from "./work_types.js";

export function assessWorkDelegation(
	input: WorkEvidenceMutationInput,
): WorkMutationResult {
	const draft = parseSingleWorkDraft(input.draft, delegationAssessDraftSchema);
	const context = executionMutationContext(input);
	const retry = exactStoredRetry(
		input,
		context,
		"work_parallelism_assessed",
		(event) => {
			if (event.kind !== "work_parallelism_assessed") return false;
			const canonical = resolveWorkExecutionInputs({
				repositoryRoot: input.project_root,
				stateRoot: input.state_root,
				workId: event.payload.work_id,
				contractRevision: event.payload.basis_contract_revision,
				contractHash: event.payload.basis_contract_hash,
				policyHash: event.payload.policy_hash,
				executionInputs: draft.execution_inputs,
			});
			return (
				canonical.parallelism?.assessment_input_hash ===
					event.payload.assessment_input_hash &&
				event.payload.assessment_id === draft.assessment_id &&
				event.payload.decision === draft.decision &&
				JSON.stringify(event.payload.lanes) === JSON.stringify(draft.lanes) &&
				event.payload.selected_provider === draft.selected_provider &&
				JSON.stringify(event.payload.rationale_codes) ===
					JSON.stringify(draft.rationale_codes) &&
				JSON.stringify(event.payload.evidence_refs) ===
					JSON.stringify(draft.evidence_refs)
			);
		},
	);
	if (retry) {
		retry.readiness = readinessForProjection(
			input,
			retry.projection,
			"implementation_entry",
			draft.execution_inputs,
		);
		retry.execution_contract = {
			kind: "delegation_assessment",
			assessment_id: retry.projection.parallelism.assessment_id,
			state: retry.projection.parallelism.recorded_state,
			next_provider: retry.projection.parallelism.next_provider,
		};
		return retry;
	}
	const canonical = resolveCanonicalInputs(
		input,
		context.projection,
		draft.execution_inputs,
	);
	if (!canonical.parallelism)
		throw new Error("current parallelism inputs are required");
	const policy = context.projection.policy_snapshot!.policy.delegation;
	const selectedProvider = selectDelegationProvider(
		policy,
		canonical.parallelism.runtime_capability,
		draft.lanes.length,
	);
	if (
		draft.decision === "parallel" &&
		draft.selected_provider !== selectedProvider
	) {
		throw new Error(
			"parallel assessment selected_provider does not match current runtime capacity",
		);
	}
	if (draft.decision !== "parallel" && draft.selected_provider !== null) {
		throw new Error("non-parallel assessment cannot select a provider");
	}
	const event: SourceFreeWorkEvidenceEvent = {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: "work_parallelism_assessed",
		payload: {
			schema_version: "anamnesis.work-parallelism-assessment-event.v1",
			...executionBasis(context.projection),
			assessment_id: draft.assessment_id,
			assessment_input_hash: canonical.parallelism.assessment_input_hash,
			decision: draft.decision,
			lanes: draft.lanes,
			selected_provider: draft.selected_provider,
			rationale_codes: draft.rationale_codes,
			evidence_refs: draft.evidence_refs,
		},
	};
	const result = appendEvidenceMutation(input, context, event);
	result.readiness = readinessForProjection(
		input,
		result.projection,
		"implementation_entry",
		draft.execution_inputs,
	);
	result.execution_contract = {
		kind: "delegation_assessment",
		assessment_id: result.projection.parallelism.assessment_id,
		state: result.projection.parallelism.recorded_state,
		next_provider: result.projection.parallelism.next_provider,
	};
	return result;
}

function delegationRecordContract(
	projection: WorkProjection,
	payload: WorkDelegationOutcomePayload,
): WorkExecutionCommandContract {
	return {
		kind: "delegation_record",
		assessment_id: payload.assessment_id,
		outcome: payload.outcome,
		provider: payload.provider,
		state: projection.parallelism.recorded_state,
		next_provider: projection.parallelism.next_provider,
		...(payload.outcome === "delegated" ||
		payload.outcome === "results_recorded"
			? { delegation_contract_hash: payload.delegation_contract_hash }
			: { failure_refs: [...payload.failure_refs] }),
		...(payload.outcome === "results_recorded"
			? { result_refs: [...payload.result_refs] }
			: {}),
	};
}

export function recordWorkDelegation(
	input: WorkEvidenceMutationInput,
): WorkMutationResult {
	const draft = parseSingleWorkDraft(input.draft, delegationRecordDraftSchema);
	const context = executionMutationContext(input);
	const retry = exactStoredRetry(
		input,
		context,
		"work_delegation_outcome_recorded",
		(event) => {
			if (event.kind !== "work_delegation_outcome_recorded") return false;
			const payload = event.payload as Record<string, unknown>;
			const candidate = draft as Record<string, unknown>;
			return Object.entries(candidate).every(
				([key, value]) =>
					JSON.stringify(payload[key]) === JSON.stringify(value),
			);
		},
	);
	if (retry) {
		const stored = parseTypedWorkEvent(
			context.ledger.records.find((item) => item.event_id === input.event_id)!,
		);
		if (stored.kind !== "work_delegation_outcome_recorded")
			throw new Error("invalid stored delegation record");
		retry.execution_contract = delegationRecordContract(
			retry.projection,
			stored.payload,
		);
		return retry;
	}
	const assessment = latestParallelismAssessment(context.ledger.records);
	if (!assessment || assessment.payload.assessment_id !== draft.assessment_id) {
		throw new Error("delegation record requires the current assessment");
	}
	const common = {
		schema_version: "anamnesis.work-delegation-outcome-event.v1" as const,
		...executionBasis(context.projection),
		assessment_id: assessment.payload.assessment_id,
		assessment_input_hash: assessment.payload.assessment_input_hash,
		provider: draft.provider,
	};
	let payload: SourceFreeWorkEvidenceEvent["payload"];
	if (draft.outcome === "delegated") {
		const partial = {
			...common,
			outcome: draft.outcome,
			child_contracts: draft.child_contracts,
		};
		payload = {
			...partial,
			delegation_contract_hash: calculateWorkDelegationContractHash(partial),
		};
	} else if (draft.outcome === "results_recorded") {
		payload = {
			...common,
			outcome: draft.outcome,
			delegation_contract_hash: draft.delegation_contract_hash,
			result_refs: draft.result_refs,
		};
	} else {
		const partial = {
			...common,
			outcome: draft.outcome,
			failure_input: draft.failure_input,
			failure_refs: draft.failure_refs,
		};
		payload = {
			...partial,
			failure_fingerprint: calculateWorkDelegationFailureFingerprint(
				partial,
				assessment.payload.lanes,
			),
		};
	}
	const result = appendEvidenceMutation(input, context, {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: "work_delegation_outcome_recorded",
		payload,
	} as SourceFreeWorkEvidenceEvent);
	result.execution_contract = delegationRecordContract(
		result.projection,
		payload as WorkDelegationOutcomePayload,
	);
	return result;
}

export function waiveWorkDelegation(
	input: WorkDelegationWaiveInput,
): WorkMutationResult {
	const draft = parseSingleWorkDraft(input.draft, delegationWaiveDraftSchema);
	const context = executionMutationContext(input);
	const source = selectedSource(input);
	const retry = exactStoredRetry(
		input,
		context,
		"work_delegation_waived",
		(event) => {
			if (event.kind !== "work_delegation_waived") return false;
			return (
				event.payload.assessment_id === draft.assessment_id &&
				event.payload.reason === draft.reason &&
				event.payload.authority_ref === draft.authority_ref &&
				event.payload.source_event_id === source.eventId &&
				JSON.stringify(event.payload.evidence_refs) ===
					JSON.stringify(draft.evidence_refs)
			);
		},
	);
	if (retry) {
		publishWorkSourceEvent(source.value);
		retry.execution_contract = {
			kind: "delegation_waiver",
			assessment_id: retry.projection.parallelism.assessment_id,
			state: retry.projection.parallelism.recorded_state,
			next_provider: retry.projection.parallelism.next_provider,
		};
		return retry;
	}
	const event = {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: "work_delegation_waived",
		payload: {
			schema_version: "anamnesis.work-delegation-waiver-event.v1",
			...executionBasis(context.projection),
			assessment_id: draft.assessment_id,
			reason: draft.reason,
			authority_ref: draft.authority_ref,
			source_event_id: source.eventId,
			evidence_refs: draft.evidence_refs,
		},
	};
	const allocation = publishAndAppendCanonicalTypedWorkSourceEvent({
		source: source.value,
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
		allocation,
		projection,
		execution_contract: {
			kind: "delegation_waiver",
			assessment_id: projection.parallelism.assessment_id,
			state: projection.parallelism.recorded_state,
			next_provider: projection.parallelism.next_provider,
		},
	};
}
