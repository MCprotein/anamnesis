import {
	evaluateWorkProtectedAction,
	type WorkExecutionStateView,
	type WorkProtectedActionReadiness,
} from "../core/work_execution_contract.js";
import {
	type WorkExecutionInputs,
	workExecutionInputsSchema,
} from "../core/work_execution_inputs.js";
import { readWorkLedger } from "../core/work_ledger.js";
import {
	foldWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { workLocations } from "./work_command_input.js";
import { resolveCanonicalInputs } from "./work_execution_mutation.js";
import { inspectPolicyDrift } from "./work_policy_resolution.js";
import type {
	WorkReadinessInput,
	WorkReadInput,
	WorkStatusResult,
	WorkSwitchAdapter,
	WorkSwitchInput,
} from "./work_types.js";

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

export function statusResultFromProjection(
	input: WorkReadInput,
	ledgerPath: string,
	projection: WorkProjection,
): WorkStatusResult {
	const currentInputsRequired =
		projection.policy_snapshot?.policy.review.gates.some(
			(gate) => gate.enforcement !== "off",
		) === true || projection.parallelism.mode !== "off";
	const drift = inspectPolicyDrift(input.project_root, projection);
	return {
		schema_version: "anamnesis.work-status.v1",
		work_id: input.work_id,
		ledger_path: ledgerPath,
		projection,
		policy_drift: drift.comparison,
		policy_drift_state: drift.state,
		policy_drift_resolve_command: drift.resolve_command,
		...(currentInputsRequired
			? { readiness: "current_inputs_required" as const }
			: {}),
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

export function readinessForProjection(
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

export function projectionTruth(projection: WorkProjection) {
	return {
		work_id: projection.work_id,
		revision: projection.contract_revision,
		last_event_id: projection.last_event_id,
		projection_hash: projection.projection_hash,
	};
}
