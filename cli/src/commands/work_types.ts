import type {
	WorkDelegationOutcomePayload,
	WorkInstanceRef,
	WorkReviewAttemptPayload,
} from "../core/work_contract.js";
import type { WorkProtectedActionReadiness } from "../core/work_execution_contract.js";
import type { WorkDurabilityOptions } from "../core/work_durability.js";
import type { WorkExecutionInputs } from "../core/work_execution_inputs.js";
import type { WorkPolicySnapshotComparison } from "../core/work_policy.js";
import type {
	ProjectedParallelism,
	ProjectedReviewGate,
	WorkProjection,
} from "../core/work_projection.js";
import type { WorkPromptStageOutcome } from "../core/work_prompt_stage.js";
import type {
	ReconciliationDeliveryBinding,
	WorkBriefingSnapshot,
} from "../core/work_reconciliation.js";
import type {
	PublishedWorkSourceAllocation,
	WorkCaptureFidelity,
	WorkSourceAllocationStatus,
} from "../core/work_storage.js";

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

export interface WorkMutationInput
	extends WorkCommandSourceSelection,
		WorkDurabilityOptions {
	project_root: string;
	state_root?: string;
	work_id: string;
	event_id: string;
	occurred_at: string;
	draft: Buffer;
	expected_head: string | null;
}

export interface WorkCloseInput extends WorkEvidenceMutationInput {
	expected_contract_revision: number;
	expected_contract_hash: string;
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

export interface WorkBriefInput extends WorkReadInput, WorkDurabilityOptions {
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
