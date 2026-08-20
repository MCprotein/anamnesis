import * as path from "node:path";
import { z } from "zod";

import { findAgentfile, readAgentfile } from "../core/agentfile.js";
import {
	parseSingleWorkDraft,
	parseStagedWorkContractDraft,
	parseWorkContractDraft,
	parseWorkPromptRetainDraft,
	type WorkContractDraft,
	workTransitionDraftSchema,
} from "../core/work_command_draft.js";
import {
	calculateWorkContractHash,
	calculateWorkDelegationContractHash,
	calculateWorkDelegationFailureFingerprint,
	childContractSchema,
	parseTypedWorkEvent,
	providerFailureInputSchema,
	type SourceFreeWorkEvidenceEvent,
	type TypedWorkEvent,
	WORK_EXECUTION_LIMITS,
	type WorkContractDefinition,
	type WorkDelegationOutcomePayload,
	type WorkInstanceRef,
	type WorkReviewAttemptPayload,
	workArtifactRefSchema,
	workInstanceRefSchema,
	workParallelLaneSchema,
} from "../core/work_contract.js";
import {
	newWorkCursor,
	readWorkCursor,
	updateWorkCursorAtomic,
	type WorkCursor,
	writeWorkCursorAtomic,
} from "../core/work_cursor.js";
import {
	evaluateWorkProtectedAction,
	selectDelegationProvider,
	type WorkExecutionStateView,
	type WorkProtectedActionReadiness,
} from "../core/work_execution_contract.js";
import {
	resolveWorkExecutionInputs,
	type WorkExecutionInputs,
	workExecutionInputsSchema,
} from "../core/work_execution_inputs.js";
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
	type ProjectedParallelism,
	type ProjectedReviewGate,
	rebuildWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import { normalizeWorkPromptCapturePolicy } from "../core/work_prompt_policy.js";
import {
	allocateStagedWorkPromptToTypedWork,
	bindRetainedProvisionalPromptToTypedWork,
	deriveWorkPromptSourceEventId,
	discardStagedWorkPrompt,
	gcStagedWorkPrompts,
	readWorkPromptStageOutcome,
	retainStagedWorkPromptProvisional,
	type WorkPromptStageOutcome,
} from "../core/work_prompt_stage.js";
import {
	buildWorkBriefingSnapshot,
	confirmReconciliationDelivery,
	emptyWorkCursorReconciliationState,
	prepareReconciliationDelivery,
	type ReconciliationDeliveryBinding,
	type WorkBriefingSnapshot,
} from "../core/work_reconciliation.js";
import {
	appendCanonicalTypedWorkEvidenceEvent,
	appendCanonicalTypedWorkProgressEvent,
	type PublishedWorkSourceAllocation,
	publishAndAppendCanonicalTypedWorkSourceEvent,
	publishWorkSourceEvent,
	resolveWorkStateRoot,
	type WorkCaptureFidelity,
	type WorkSourceAllocationStatus,
	type WorkSourceEventInput,
} from "../core/work_storage.js";
import { sha256 } from "../util/hash.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const boundedDraftRef = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) =>
			Buffer.byteLength(value, "utf8") <= WORK_EXECUTION_LIMITS.maxRefUtf8Bytes,
		"reference exceeds the Work execution limit",
	);
const boundedDraftRefs = (maximum: number) =>
	z.array(boundedDraftRef).max(maximum);
const reviewRequestDraftSchema = z
	.object({
		execution_inputs: workExecutionInputsSchema,
	})
	.strict();
const reviewRecordDraftSchema = z.discriminatedUnion("outcome", [
	z
		.object({
			gate: z.enum(["planning", "completion"]),
			activity_id: boundedDraftRef,
			attempt_id: boundedDraftRef,
			provider: z.enum(["omx", "codex_native", "separate_process"]),
			role: boundedDraftRef,
			outcome: z.enum(["passed", "changes_requested"]),
			reviewer_instance_ref: workInstanceRefSchema,
			author_instance_refs: z
				.array(workInstanceRefSchema)
				.min(1)
				.max(WORK_EXECUTION_LIMITS.maxEvidenceRefs),
			independence_assurance: z.literal("runtime_attested"),
			independence_evidence_refs: boundedDraftRefs(
				WORK_EXECUTION_LIMITS.maxEvidenceRefs,
			).min(1),
			finding_refs: boundedDraftRefs(WORK_EXECUTION_LIMITS.maxFindingRefs),
		})
		.strict(),
	z
		.object({
			gate: z.enum(["planning", "completion"]),
			activity_id: boundedDraftRef,
			attempt_id: boundedDraftRef,
			provider: z.enum(["omx", "codex_native", "separate_process"]),
			role: boundedDraftRef,
			outcome: z.enum([
				"authorization_error",
				"unsupported_authority",
				"unavailable",
			]),
			failure_input: providerFailureInputSchema,
			failure_refs: boundedDraftRefs(WORK_EXECUTION_LIMITS.maxFailureRefs).min(
				1,
			),
		})
		.strict(),
]);
const delegationAssessDraftSchema = z
	.object({
		execution_inputs: workExecutionInputsSchema,
		assessment_id: boundedDraftRef,
		decision: z.enum(["parallel", "solo", "not_parallelizable"]),
		lanes: z
			.array(workParallelLaneSchema)
			.min(1)
			.max(WORK_EXECUTION_LIMITS.maxChildContracts),
		selected_provider: z.enum(["native_agents", "tmux_team"]).nullable(),
		rationale_codes: boundedDraftRefs(
			WORK_EXECUTION_LIMITS.maxEvidenceRefs,
		).min(1),
		evidence_refs: boundedDraftRefs(WORK_EXECUTION_LIMITS.maxEvidenceRefs).min(
			1,
		),
	})
	.strict();
const delegationRecordDraftSchema = z.discriminatedUnion("outcome", [
	z
		.object({
			assessment_id: boundedDraftRef,
			provider: z.enum(["native_agents", "tmux_team"]),
			outcome: z.enum([
				"authorization_error",
				"unsupported_authority",
				"unavailable",
				"runtime_incompatible",
			]),
			failure_input: providerFailureInputSchema,
			failure_refs: boundedDraftRefs(WORK_EXECUTION_LIMITS.maxFailureRefs).min(
				1,
			),
		})
		.strict(),
	z
		.object({
			assessment_id: boundedDraftRef,
			provider: z.enum(["native_agents", "tmux_team"]),
			outcome: z.literal("delegated"),
			child_contracts: z
				.array(childContractSchema)
				.min(1)
				.max(WORK_EXECUTION_LIMITS.maxChildContracts),
		})
		.strict(),
	z
		.object({
			assessment_id: boundedDraftRef,
			provider: z.enum(["native_agents", "tmux_team"]),
			outcome: z.literal("results_recorded"),
			delegation_contract_hash: boundedDraftRef,
			result_refs: boundedDraftRefs(WORK_EXECUTION_LIMITS.maxEvidenceRefs).min(
				1,
			),
		})
		.strict(),
]);
const delegationWaiveDraftSchema = z
	.object({
		assessment_id: boundedDraftRef,
		reason: boundedDraftRef,
		authority_ref: boundedDraftRef,
		evidence_refs: boundedDraftRefs(WORK_EXECUTION_LIMITS.maxEvidenceRefs).min(
			1,
		),
	})
	.strict();
const transitionWithExecutionInputsSchema = workTransitionDraftSchema.extend({
	execution_inputs: workExecutionInputsSchema.optional(),
});

export interface WorkRawSource {
	event_id: string;
	captured_at: string;
	client: string;
	content_type: string;
	fidelity: WorkCaptureFidelity;
	allocation_status: WorkSourceAllocationStatus;
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
	expected_head: string | null;
}

export interface WorkMutationResult {
	schema_version: "anamnesis.work-command-result.v1";
	work_id: string;
	ledger_path: string;
	projection_path: string;
	allocation: PublishedWorkSourceAllocation | null;
	projection: WorkProjection;
	readiness?: WorkProtectedActionReadiness;
	execution_contract?: WorkExecutionCommandContract;
}

export type WorkExecutionCommandContract =
	| {
			kind: "review_request";
			gate: "planning" | "completion";
			review_input_hash: string;
			capability: "independent_agent";
			role: string;
			minimum_reviewers: number;
			provider_order: Array<"omx" | "codex_native" | "separate_process">;
			next_provider: "omx" | "codex_native" | "separate_process" | null;
			evidence_requirements: [
				"runtime_attested_unequal_provider_namespaced_refs",
			];
			blocking: boolean;
	  }
	| {
			kind: "review_record";
			gate: "planning" | "completion";
			outcome: WorkReviewAttemptPayload["outcome"];
			provider: WorkReviewAttemptPayload["provider"];
			state: ProjectedReviewGate["state"];
			next_provider: ProjectedReviewGate["next_provider"];
			independence_assurance?: "runtime_attested";
			reviewer_instance_ref?: WorkInstanceRef;
			finding_refs?: string[];
			failure_refs?: string[];
	  }
	| {
			kind: "delegation_assessment" | "delegation_waiver";
			assessment_id: string | null;
			state: ProjectedParallelism["recorded_state"];
			next_provider: ProjectedParallelism["next_provider"];
	  }
	| {
			kind: "delegation_record";
			assessment_id: string | null;
			outcome: WorkDelegationOutcomePayload["outcome"];
			provider: WorkDelegationOutcomePayload["provider"];
			state: ProjectedParallelism["recorded_state"];
			next_provider: ProjectedParallelism["next_provider"];
			delegation_contract_hash?: string;
			failure_refs?: string[];
			result_refs?: string[];
	  };

export interface PublicWorkExecutionMutationResult {
	schema_version: "anamnesis.work-execution-command-result.v1";
	work_id: string;
	ledger_head: string | null;
	execution_contract: WorkExecutionCommandContract;
	readiness?: WorkProtectedActionReadiness;
}

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

export interface StagedWorkAllocationInput extends WorkReadInput {
	capture_id: string;
	occurred_at: string;
	draft: Buffer;
	expected_head: string | null;
	expected_contract_revision: number | null;
	expected_contract_hash: string | null;
}

export interface RetainStagedWorkPromptInput {
	project_root: string;
	state_root?: string;
	capture_id: string;
	resolved_at: string;
	draft: Buffer;
}

export interface DiscardStagedWorkPromptInput {
	project_root: string;
	state_root?: string;
	capture_id: string;
	resolved_at: string;
	reason: "interruption" | "non_requirement";
}

export interface GcStagedWorkPromptInput {
	project_root: string;
	state_root?: string;
	now?: string;
}

export interface GcStagedWorkPromptResult {
	schema_version: "anamnesis.work-prompt-gc.v1";
	removed: string[];
	skipped_locked: string[];
	skipped_indeterminate: string[];
}

export interface WorkPromptResolutionResult {
	schema_version: "anamnesis.work-prompt-resolution.v1";
	capture_id: string;
	resolution:
		| "allocate_same"
		| "allocate_new"
		| "retain_provisional"
		| "discard";
	outcome: WorkPromptStageOutcome;
	work_id: string | null;
	ledger_path: string | null;
	projection_path: string | null;
	projection: WorkProjection | null;
}

export interface PublicWorkPromptResolutionResult {
	schema_version: "anamnesis.work-prompt-resolution.v1";
	capture_id: string;
	resolution: WorkPromptResolutionResult["resolution"];
	outcome: Record<string, unknown>;
	work_id: string | null;
	ledger_path: string | null;
	projection_path: string | null;
	projection: WorkProjection | null;
}

export function publicWorkPromptResolution(
	result: WorkPromptResolutionResult,
): PublicWorkPromptResolutionResult {
	const outcome = result.outcome;
	const publicOutcome: Record<string, unknown> = {
		schema_version: outcome.schema_version,
		capture_id: outcome.capture_id,
		outcome: outcome.outcome,
		resolved_at: outcome.resolved_at,
	};
	if (outcome.outcome === "discarded") publicOutcome.reason = outcome.reason;
	if (outcome.outcome === "provisional") {
		Object.assign(publicOutcome, {
			source_event_id: outcome.source_event_id,
			boundary_state: outcome.boundary_state,
			classification: outcome.classification,
			reason_codes: outcome.reason_codes,
			...(outcome.question === undefined ? {} : { question: outcome.question }),
		});
	}
	if (outcome.outcome === "allocated") {
		Object.assign(publicOutcome, {
			source_event_id: outcome.source_event_id,
			decision: outcome.decision,
			work_id: outcome.work_id,
			ledger_event_id: outcome.ledger_event_id,
		});
	}
	return { ...result, outcome: publicOutcome };
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
	readiness?: "current_inputs_required";
}

export interface WorkEvidenceMutationInput extends WorkReadInput {
	event_id: string;
	occurred_at: string;
	expected_head: string;
	draft: Buffer;
}

export interface WorkReviewRequestInput extends WorkEvidenceMutationInput {
	gate: "planning" | "completion";
	activity_id: string;
}

export interface WorkDelegationWaiveInput
	extends WorkEvidenceMutationInput,
		WorkCommandSourceSelection {}

export interface WorkReadinessInput extends WorkReadInput {
	action: "implementation_entry" | "completion";
	execution_inputs?: WorkExecutionInputs;
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

export function allocateStagedPromptToNewWork(
	input: StagedWorkAllocationInput,
): WorkPromptResolutionResult {
	return allocateStagedPrompt(input, "allocate_new");
}

export function allocateStagedPromptToSameWork(
	input: StagedWorkAllocationInput,
): WorkPromptResolutionResult {
	return allocateStagedPrompt(input, "allocate_same");
}

export function retainStagedPromptProvisional(
	input: RetainStagedWorkPromptInput,
): WorkPromptResolutionResult {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const draft = parseWorkPromptRetainDraft(input.draft);
	const outcome = retainStagedWorkPromptProvisional({
		stateRoot: state.state_root,
		captureId: input.capture_id,
		resolvedAt: input.resolved_at,
		boundaryState: draft.boundary.state,
		classification: draft.boundary.classification,
		reasonCodes: draft.boundary.reason_codes,
		question: draft.question,
	});
	return {
		schema_version: "anamnesis.work-prompt-resolution.v1",
		capture_id: input.capture_id,
		resolution: "retain_provisional",
		outcome,
		work_id: null,
		ledger_path: null,
		projection_path: null,
		projection: null,
	};
}

export function discardStagedPrompt(
	input: DiscardStagedWorkPromptInput,
): WorkPromptResolutionResult {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const outcome = discardStagedWorkPrompt({
		stateRoot: state.state_root,
		captureId: input.capture_id,
		resolvedAt: input.resolved_at,
		reason: input.reason,
	});
	return {
		schema_version: "anamnesis.work-prompt-resolution.v1",
		capture_id: input.capture_id,
		resolution: "discard",
		outcome,
		work_id: null,
		ledger_path: null,
		projection_path: null,
		projection: null,
	};
}

export function gcStagedWorkPromptEntries(
	input: GcStagedWorkPromptInput,
): GcStagedWorkPromptResult {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const agentfilePath = findAgentfile(input.project_root);
	const agentfile = agentfilePath ? readAgentfile(input.project_root) : null;
	const policy = normalizeWorkPromptCapturePolicy(
		agentfile?.version === 2
			? agentfile.settings?.work_prompt_capture
			: undefined,
	);
	const now = input.now === undefined ? Date.now() : Date.parse(input.now);
	if (!Number.isFinite(now))
		throw new Error("invalid Work prompt GC timestamp");
	return {
		schema_version: "anamnesis.work-prompt-gc.v1",
		...gcStagedWorkPrompts(state.state_root, policy, now),
	};
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

export function readinessWork(
	input: WorkReadinessInput,
): WorkProtectedActionReadiness {
	const locations = workLocations(input);
	const projection = foldWorkProjection(
		readWorkLedger(locations.ledgerPath).records,
	);
	if (projection.work_id !== input.work_id)
		throw new Error(`Work not found: ${input.work_id}`);
	return readinessForProjection(
		input,
		projection,
		input.action,
		input.execution_inputs,
	);
}

export function statusWork(input: WorkReadInput): WorkStatusResult {
	const locations = workLocations(input);
	const projection = foldWorkProjection(
		readWorkLedger(locations.ledgerPath).records,
	);
	if (projection.work_id !== input.work_id)
		throw new Error(`Work not found: ${input.work_id}`);
	return statusResultFromProjection(input, locations.ledgerPath, projection);
}

function statusResultFromProjection(
	input: WorkReadInput,
	ledgerPath: string,
	projection: WorkProjection,
): WorkStatusResult {
	const currentInputsRequired =
		projection.policy_snapshot?.policy.review.gates.some(
			(gate) => gate.enforcement !== "off",
		) === true || projection.parallelism.mode !== "off";
	return {
		schema_version: "anamnesis.work-status.v1",
		work_id: input.work_id,
		ledger_path: ledgerPath,
		projection,
		policy_drift: detectPolicyDrift(input.project_root, projection),
		...(currentInputsRequired
			? { readiness: "current_inputs_required" as const }
			: {}),
	};
}

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
	const state = input.cursor_id
		? resolveWorkStateRoot(input.project_root, input.state_root)
		: null;
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

function allocateStagedPrompt(
	input: StagedWorkAllocationInput,
	decision: "allocate_same" | "allocate_new",
): WorkPromptResolutionResult {
	assertSafeId(input.work_id, "work ID");
	const locations = workLocations(input);
	let ledger = readWorkLedger(locations.ledgerPath);
	const sourceEventId = deriveWorkPromptSourceEventId(input.capture_id);
	const draft = parseStagedWorkContractDraft(input.draft, sourceEventId);
	assertBoundaryClassification(
		draft,
		decision === "allocate_new" ? "new_unit" : "same_unit",
		decision === "allocate_new" ? "create" : "amend",
	);
	assertCurrentSourceReferenced(draft, sourceEventId);

	const eventId = stagedAllocationEventId(
		input.capture_id,
		decision,
		input.work_id,
	);
	const existing = ledger.records.find((record) => record.event_id === eventId);
	if (
		decision === "allocate_new" &&
		(input.expected_head !== null ||
			input.expected_contract_revision !== null ||
			input.expected_contract_hash !== null)
	) {
		throw new Error(
			"allocate-new requires null expected contract and ledger authority",
		);
	}
	let revision: number;
	let previousRevision: number | null;
	let previousHash: string | null;
	let policy: ReturnType<typeof createWorkPolicySnapshot>;
	let occurredAt = input.occurred_at;

	if (existing) {
		if (
			(decision === "allocate_new" && existing.kind !== "work_created") ||
			(decision === "allocate_same" &&
				existing.kind !== "work_contract_revised")
		) {
			throw new Error(`work ledger event ID collision: ${eventId}`);
		}
		const parsed = parseTypedWorkEvent(existing);
		if (
			parsed.kind !== "work_created" &&
			parsed.kind !== "work_contract_revised"
		) {
			throw new Error(`invalid stored staged Work allocation: ${eventId}`);
		}
		revision = parsed.payload.contract_revision;
		previousRevision = parsed.payload.previous_contract_revision;
		previousHash = parsed.payload.previous_contract_hash;
		policy = parsed.payload.contract.policy_snapshot;
		occurredAt = existing.occurred_at;
	} else if (decision === "allocate_new") {
		if (
			ledger.records.length !== 0 ||
			input.expected_head !== null ||
			input.expected_contract_revision !== null ||
			input.expected_contract_hash !== null
		) {
			throw new Error(
				"allocate-new requires an empty Work and null expected contract/head",
			);
		}
		revision = 1;
		previousRevision = null;
		previousHash = null;
		policy = createWorkPolicySnapshot(1, resolveCommandPolicy(input));
	} else {
		if (
			input.expected_head === null ||
			input.expected_contract_revision === null ||
			input.expected_contract_hash === null
		) {
			throw new Error(
				"allocate-same requires exact expected head, contract revision, and contract hash",
			);
		}
		if (ledger.head !== input.expected_head) {
			throw new Error("staged Work allocation observed a stale ledger head");
		}
		const projection = foldWorkProjection(ledger.records);
		if (
			projection.work_id !== input.work_id ||
			projection.contract_revision !== input.expected_contract_revision ||
			projection.contract_hash !== input.expected_contract_hash ||
			!projection.policy_snapshot
		) {
			throw new Error(
				"staged Work allocation observed stale Work contract truth",
			);
		}
		revision = projection.contract_revision + 1;
		previousRevision = projection.contract_revision;
		previousHash = projection.contract_hash;
		policy = createWorkPolicySnapshot(
			revision,
			projection.policy_snapshot.policy,
		);
	}

	if (decision === "allocate_same") {
		if (
			input.expected_head !== (existing?.previous_hash ?? ledger.head) ||
			input.expected_contract_revision !== previousRevision ||
			input.expected_contract_hash !== previousHash
		) {
			throw new Error(
				"staged Work allocation assertion does not match prior contract",
			);
		}
	}
	const contract: WorkContractDefinition = {
		...draft,
		work: { id: input.work_id, ...draft.work },
		policy_snapshot: policy,
	};
	const event: TypedWorkEvent = {
		event_id: eventId,
		occurred_at: occurredAt,
		kind:
			decision === "allocate_new" ? "work_created" : "work_contract_revised",
		payload: {
			schema_version: "anamnesis.work-contract-event.v1",
			work_id: input.work_id,
			contract_revision: revision,
			previous_contract_revision: previousRevision,
			previous_contract_hash: previousHash,
			contract_hash: calculateWorkContractHash(contract),
			contract,
			source_event_id: sourceEventId,
		},
	};
	if (existing) {
		assertIdempotentMutationCandidate(existing, event, sourceEventId);
		ledger = readWorkLedger(locations.ledgerPath);
	}
	const commitExpectedHead = existing ? existing.previous_hash : ledger.head;
	const priorOutcome = readWorkPromptStageOutcome(
		locations.stateRoot,
		input.capture_id,
	);
	let outcome: WorkPromptStageOutcome;
	if (priorOutcome?.outcome === "provisional") {
		bindRetainedProvisionalPromptToTypedWork({
			stateRoot: locations.stateRoot,
			captureId: input.capture_id,
			boundAt: input.occurred_at,
			decision,
			workId: input.work_id,
			ledgerPath: locations.ledgerPath,
			ledgerEvent: event,
			expectedHead: commitExpectedHead,
		});
		outcome = priorOutcome;
	} else {
		outcome = allocateStagedWorkPromptToTypedWork({
			stateRoot: locations.stateRoot,
			captureId: input.capture_id,
			resolvedAt: input.occurred_at,
			decision,
			workId: input.work_id,
			ledgerPath: locations.ledgerPath,
			ledgerEvent: event,
			expectedHead: commitExpectedHead,
		});
	}
	const projection = rebuildWorkProjection(
		locations.ledgerPath,
		locations.projectionPath,
	);
	return {
		schema_version: "anamnesis.work-prompt-resolution.v1",
		capture_id: input.capture_id,
		resolution: decision,
		outcome,
		work_id: input.work_id,
		ledger_path: locations.ledgerPath,
		projection_path: locations.projectionPath,
		projection,
	};
}

function stagedAllocationEventId(
	captureId: string,
	decision: "allocate_same" | "allocate_new",
	workId: string,
): string {
	return `prompt_alloc_${sha256(`anamnesis-prompt-allocation-v1\0${captureId}\0${decision}\0${workId}`).slice("sha256:".length)}`;
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

type ExecutionMutationContext = {
	locations: WorkLocations;
	ledger: ReturnType<typeof readWorkLedger>;
	projection: WorkProjection;
};

function executionMutationContext(
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

function executionBasis(projection: WorkProjection) {
	if (!projection.contract_hash || !projection.policy_hash)
		throw new Error("Work execution basis is unavailable");
	return {
		work_id: projection.work_id,
		basis_contract_revision: projection.contract_revision,
		basis_contract_hash: projection.contract_hash,
		policy_hash: projection.policy_hash,
	};
}

function resolveCanonicalInputs(
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

function requiredReviewGate(
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

function latestReviewRequest(
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

function latestParallelismAssessment(
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

function appendEvidenceMutation(
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

function exactStoredRetry(
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

function executionStateView(
	projection: WorkProjection,
): WorkExecutionStateView {
	if (!projection.contract_hash || !projection.policy_hash)
		throw new Error("Work execution state is unavailable");
	const review: WorkExecutionStateView["review"] = {};
	for (const gate of projection.review_gates) {
		if (
			gate.recorded_input_hash &&
			gate.state !== "off" &&
			gate.state !== "pending"
		) {
			review[gate.gate] = {
				gate: gate.gate,
				review_input_hash: gate.recorded_input_hash,
				state: gate.state,
				passing_reviewer_refs: gate.passing_reviewer_refs,
				next_provider: gate.next_provider,
			};
		}
	}
	const stored = projection.parallelism;
	const parallelism: WorkExecutionStateView["parallelism"] =
		stored.assessment_id &&
		stored.recorded_assessment_input_hash &&
		stored.decision &&
		stored.required_agents !== null &&
		stored.recorded_state !== "off"
			? {
					assessment_id: stored.assessment_id,
					assessment_input_hash: stored.recorded_assessment_input_hash,
					decision: stored.decision,
					state: stored.recorded_state,
					selected_provider: stored.selected_provider,
					next_provider: stored.next_provider,
					required_agents: stored.required_agents,
					waiver_assessment_id:
						stored.recorded_state === "continue_solo"
							? stored.assessment_id
							: null,
					waiver_assessment_input_hash:
						stored.recorded_state === "continue_solo"
							? stored.recorded_assessment_input_hash
							: null,
				}
			: null;
	return {
		work_id: projection.work_id,
		contract_revision: projection.contract_revision,
		contract_hash: projection.contract_hash,
		policy_hash: projection.policy_hash,
		review,
		parallelism,
	};
}

function readinessForProjection(
	input: WorkReadInput,
	projection: WorkProjection,
	action: "implementation_entry" | "completion",
	executionInputs?: WorkExecutionInputs,
): WorkProtectedActionReadiness {
	const policy = projection.policy_snapshot?.policy;
	if (!policy) throw new Error("Work policy snapshot is unavailable");
	const gateName =
		action === "implementation_entry" ? "planning" : "completion";
	const gate = policy.review.gates.find((item) => item.gate === gateName);
	if (!gate) throw new Error(`Work ${gateName} review gate is unavailable`);
	const parsedInputs = workExecutionInputsSchema.parse(executionInputs ?? {});
	const actionInputs: WorkExecutionInputs =
		action === "implementation_entry"
			? {
					...(parsedInputs.planning_review_inputs
						? { planning_review_inputs: parsedInputs.planning_review_inputs }
						: {}),
					...(parsedInputs.parallelism_inputs
						? { parallelism_inputs: parsedInputs.parallelism_inputs }
						: {}),
				}
			: parsedInputs.completion_review_inputs
				? { completion_review_inputs: parsedInputs.completion_review_inputs }
				: {};
	return evaluateWorkProtectedAction({
		execution_state: executionStateView(projection),
		action,
		canonical_inputs: resolveCanonicalInputs(input, projection, actionInputs),
		review_gate: gate,
		delegation_policy: policy.delegation,
	});
}

function selectedSource(input: WorkReadInput & WorkCommandSourceSelection): {
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
