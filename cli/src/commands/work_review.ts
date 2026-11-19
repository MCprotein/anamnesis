import { parseSingleWorkDraft } from "../core/work_command_draft.js";
import {
	parseTypedWorkEvent,
	type SourceFreeWorkEvidenceEvent,
	type WorkReviewAttemptPayload,
	workArtifactRefSchema,
} from "../core/work_contract.js";
import {
	resolveWorkExecutionInputs,
	type WorkExecutionInputs,
	workExecutionInputsSchema,
} from "../core/work_execution_inputs.js";
import type { WorkProjection } from "../core/work_projection.js";
import { sha256 } from "../util/hash.js";
import {
	reviewRecordDraftSchema,
	reviewRequestDraftSchema,
} from "./work_draft_schemas.js";
import {
	appendEvidenceMutation,
	exactStoredRetry,
	executionBasis,
	executionMutationContext,
	latestReviewRequest,
	requiredReviewGate,
	resolveCanonicalInputs,
} from "./work_execution_mutation.js";
import type {
	WorkEvidenceMutationInput,
	WorkExecutionCommandContract,
	WorkMutationResult,
	WorkReviewRequestInput,
} from "./work_types.js";

export function requestWorkReview(
	input: WorkReviewRequestInput,
): WorkMutationResult {
	const draft = parseSingleWorkDraft(input.draft, reviewRequestDraftSchema);
	const context = executionMutationContext(input);
	const parsedInputs = workExecutionInputsSchema.parse(draft.execution_inputs);
	const gateInputs: WorkExecutionInputs =
		input.gate === "planning"
			? parsedInputs.planning_review_inputs
				? { planning_review_inputs: parsedInputs.planning_review_inputs }
				: {}
			: parsedInputs.completion_review_inputs
				? { completion_review_inputs: parsedInputs.completion_review_inputs }
				: {};
	const retry = exactStoredRetry(
		input,
		context,
		"work_review_requested",
		(event) => {
			if (
				event.kind !== "work_review_requested" ||
				event.payload.gate !== input.gate ||
				event.payload.activity_id !== input.activity_id
			)
				return false;
			const canonical = resolveWorkExecutionInputs({
				repositoryRoot: input.project_root,
				stateRoot: input.state_root,
				workId: event.payload.work_id,
				contractRevision: event.payload.basis_contract_revision,
				contractHash: event.payload.basis_contract_hash,
				policyHash: event.payload.policy_hash,
				executionInputs: gateInputs,
			});
			const candidate =
				input.gate === "planning"
					? canonical.planning_review
					: canonical.completion_review;
			return (
				!!candidate &&
				!("unavailable" in candidate) &&
				candidate.review_input_hash === event.payload.review_input_hash
			);
		},
	);
	if (retry) {
		const stored = parseTypedWorkEvent(
			context.ledger.records.find((item) => item.event_id === input.event_id)!,
		);
		if (stored.kind !== "work_review_requested")
			throw new Error("invalid stored review request");
		retry.execution_contract = {
			kind: "review_request",
			gate: stored.payload.gate,
			review_input_hash: stored.payload.review_input_hash,
			capability: "independent_agent",
			role: stored.payload.role_hint,
			minimum_reviewers: stored.payload.minimum_reviewers,
			provider_order: stored.payload.provider_order,
			next_provider:
				retry.projection.review_gates.find(
					(item) => item.gate === stored.payload.gate,
				)?.next_provider ?? null,
			evidence_requirements: [
				"runtime_attested_unequal_provider_namespaced_refs",
			],
			blocking:
				requiredReviewGate(retry.projection, stored.payload.gate)
					.enforcement === "required",
		};
		return retry;
	}
	const canonical = resolveCanonicalInputs(
		input,
		context.projection,
		gateInputs,
	);
	const gate = requiredReviewGate(context.projection, input.gate);
	let reviewInputHash: string;
	let artifactRefs: Array<{ ref: string; hash: string }>;
	if (input.gate === "planning") {
		const current = canonical.planning_review;
		if (!current)
			throw new Error("current planning review inputs are unavailable");
		reviewInputHash = current.review_input_hash;
		artifactRefs = current.artifacts.map(({ ref, hash }) => ({ ref, hash }));
	} else {
		const current = canonical.completion_review;
		if (!current || "unavailable" in current)
			throw new Error("current completion review inputs are unavailable");
		reviewInputHash = current.review_input_hash;
		artifactRefs = [
			{
				ref: `git-base:${current.base_ref}`,
				hash: sha256(current.base_object),
			},
			{
				ref: `git-head:${current.head_ref}`,
				hash: sha256(current.head_object),
			},
			{ ref: "git-diff", hash: current.diff_hash },
			{ ref: "verification", hash: current.verification_hash },
		];
	}
	const event: SourceFreeWorkEvidenceEvent = {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: "work_review_requested",
		payload: {
			schema_version: "anamnesis.work-review-request-event.v1",
			...executionBasis(context.projection),
			gate: input.gate,
			activity_id: input.activity_id,
			review_input_hash: reviewInputHash,
			artifact_refs: workArtifactRefSchema.array().parse(artifactRefs),
			provider_order: gate.provider_order,
			role_hint: gate.role_hint,
			minimum_reviewers: gate.minimum_reviewers,
		},
	};
	const result = appendEvidenceMutation(input, context, event);
	result.execution_contract = {
		kind: "review_request",
		gate: input.gate,
		review_input_hash: reviewInputHash,
		capability: "independent_agent",
		role: gate.role_hint,
		minimum_reviewers: gate.minimum_reviewers,
		provider_order: [...gate.provider_order],
		next_provider: gate.provider_order[0] ?? null,
		evidence_requirements: [
			"runtime_attested_unequal_provider_namespaced_refs",
		],
		blocking: gate.enforcement === "required",
	};
	return result;
}

function reviewRecordContract(
	projection: WorkProjection,
	payload: WorkReviewAttemptPayload,
): WorkExecutionCommandContract {
	const gate = projection.review_gates.find(
		(item) => item.gate === payload.gate,
	);
	if (!gate) throw new Error(`missing projected ${payload.gate} review gate`);
	return {
		kind: "review_record",
		gate: payload.gate,
		outcome: payload.outcome,
		provider: payload.provider,
		state: gate.state,
		next_provider: gate.next_provider,
		...("reviewer_instance_ref" in payload
			? {
					independence_assurance: payload.independence_assurance,
					reviewer_instance_ref: payload.reviewer_instance_ref,
					finding_refs: [...payload.finding_refs],
				}
			: { failure_refs: [...payload.failure_refs] }),
	};
}

export function recordWorkReview(
	input: WorkEvidenceMutationInput,
): WorkMutationResult {
	const draft = parseSingleWorkDraft(input.draft, reviewRecordDraftSchema);
	const context = executionMutationContext(input);
	const retry = exactStoredRetry(
		input,
		context,
		"work_review_attempt_recorded",
		(event) => {
			if (event.kind !== "work_review_attempt_recorded") return false;
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
		if (stored.kind !== "work_review_attempt_recorded")
			throw new Error("invalid stored review record");
		retry.execution_contract = reviewRecordContract(
			retry.projection,
			stored.payload,
		);
		return retry;
	}
	const request = latestReviewRequest(context.ledger.records, draft.gate);
	if (!request) throw new Error(`no current ${draft.gate} review request`);
	let outcomeFields: Record<string, unknown>;
	if ("failure_input" in draft) {
		outcomeFields = {
			failure_input: draft.failure_input,
			failure_refs: draft.failure_refs,
		};
	} else {
		outcomeFields = {
			reviewer_instance_ref: draft.reviewer_instance_ref,
			author_instance_refs: draft.author_instance_refs,
			independence_assurance: draft.independence_assurance,
			independence_evidence_refs: draft.independence_evidence_refs,
			artifact_refs: request.payload.artifact_refs,
			finding_refs: draft.finding_refs,
		};
	}
	const payload = {
		schema_version: "anamnesis.work-review-attempt-event.v1" as const,
		...executionBasis(context.projection),
		gate: draft.gate,
		activity_id: draft.activity_id,
		attempt_id: draft.attempt_id,
		review_input_hash: request.payload.review_input_hash,
		provider: draft.provider,
		role: draft.role,
		outcome: draft.outcome,
		...outcomeFields,
	};
	const result = appendEvidenceMutation(input, context, {
		event_id: input.event_id,
		occurred_at: input.occurred_at,
		kind: "work_review_attempt_recorded",
		payload,
	} as SourceFreeWorkEvidenceEvent);
	result.execution_contract = reviewRecordContract(
		result.projection,
		payload as WorkReviewAttemptPayload,
	);
	return result;
}
