import { z } from "zod";
import {
	workCloseDraftSchema,
	workTransitionDraftSchema,
} from "../core/work_command_draft.js";
import {
	childContractSchema,
	providerFailureInputSchema,
	WORK_EXECUTION_LIMITS,
	workInstanceRefSchema,
	workParallelLaneSchema,
} from "../core/work_contract.js";
import { workExecutionInputsSchema } from "../core/work_execution_inputs.js";

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
export const reviewRequestDraftSchema = z
	.object({
		execution_inputs: workExecutionInputsSchema,
	})
	.strict();
export const reviewRecordDraftSchema = z.discriminatedUnion("outcome", [
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
export const delegationAssessDraftSchema = z
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
export const delegationRecordDraftSchema = z.discriminatedUnion("outcome", [
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
export const delegationWaiveDraftSchema = z
	.object({
		assessment_id: boundedDraftRef,
		reason: boundedDraftRef,
		authority_ref: boundedDraftRef,
		evidence_refs: boundedDraftRefs(WORK_EXECUTION_LIMITS.maxEvidenceRefs).min(
			1,
		),
	})
	.strict();
export const transitionWithExecutionInputsSchema =
	workTransitionDraftSchema.extend({
		execution_inputs: workExecutionInputsSchema.optional(),
	});
export const closeWithExecutionInputsSchema = workCloseDraftSchema.extend({
	execution_inputs: workExecutionInputsSchema.optional(),
});
