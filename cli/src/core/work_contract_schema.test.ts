import { describe, expect, it } from "vitest";
import { repositoryScopesOverlap } from "./work_contract_calculation.js";
import {
	childContractSchema,
	providerFailureInputSchema,
	repositoryScopeSchema,
	runtimeAttestedCapabilitySchema,
	runtimeAttestedInlineArtifactSchema,
	WORK_EXECUTION_LIMITS,
	workDelegationOutcomePayloadSchema,
	workDelegationWaiverPayloadSchema,
	workParallelismAssessmentPayloadSchema,
	workReviewAttemptPayloadSchema,
	workReviewRequestedPayloadSchema,
} from "./work_contract_schema.js";

describe("Work execution evidence schemas", () => {
	const digest = `sha256:${"1".repeat(64)}`;
	const basis = {
		work_id: "wu_one",
		basis_contract_revision: 1,
		basis_contract_hash: digest,
		policy_hash: digest,
	};
	const artifact = { ref: "plan.md", hash: digest };
	const lane = {
		lane_id: "lane_one",
		requirement_ids: ["req_one"],
		repository_scopes: [
			{ kind: "tree" as const, path: "cli/src", access: "write" as const },
		],
		external_effects: [],
		depends_on: [],
		verification_owner: "leader" as const,
	};

	it("exports strict UTF-8 byte bounds and preserves inline whitespace", () => {
		const exact = "é".repeat(WORK_EXECUTION_LIMITS.maxRefUtf8Bytes / 2);
		expect(
			providerFailureInputSchema.parse({ capability_ref: exact })
				.capability_ref,
		).toBe(exact);
		expect(() =>
			providerFailureInputSchema.parse({ capability_ref: `${exact}é` }),
		).toThrow();
		expect(
			runtimeAttestedInlineArtifactSchema.parse({
				kind: "runtime_attested_inline",
				ref: "plan",
				content: "  line one\nline two  ",
				assurance: "runtime_attested",
			}).content,
		).toBe("  line one\nline two  ");
		for (const invalid of ["\ud800", "\udc00"]) {
			expect(() =>
				providerFailureInputSchema.parse({ capability_ref: invalid }),
			).toThrow(/Unicode/);
			expect(() =>
				runtimeAttestedInlineArtifactSchema.parse({
					kind: "runtime_attested_inline",
					ref: "x",
					content: invalid,
					assurance: "runtime_attested",
				}),
			).toThrow(/Unicode/);
		}
	});

	it("validates runtime capability and repository scope grammar strictly", () => {
		expect(
			runtimeAttestedCapabilitySchema.parse({
				assurance: "runtime_attested",
				capability_ref: "cap_one",
				providers: [
					{
						provider: "native_agents",
						availability: "available",
						max_agents: WORK_EXECUTION_LIMITS.maxChildContracts,
					},
				],
			}).providers,
		).toHaveLength(1);
		expect(() =>
			runtimeAttestedCapabilitySchema.parse({
				assurance: "runtime_attested",
				capability_ref: "cap_one",
				providers: [
					{
						provider: "native_agents",
						availability: "available",
						max_agents: 1,
					},
					{
						provider: "native_agents",
						availability: "unavailable",
						max_agents: 0,
					},
				],
			}),
		).toThrow(/duplicate/);
		for (const pathValue of ["/abs", "a/../b", "a//b", "a\\b", "a/*", "a/"]) {
			expect(() =>
				repositoryScopeSchema.parse({
					kind: "tree",
					path: pathValue,
					access: "read",
				}),
			).toThrow();
		}
		expect(() =>
			repositoryScopeSchema.parse({ kind: "repo", path: "x", access: "read" }),
		).toThrow();
		expect(
			repositoryScopesOverlap(
				{ kind: "tree", path: "a/b", access: "read" },
				{ kind: "file", path: "a/b/c", access: "write" },
			),
		).toBe(true);
		expect(
			repositoryScopesOverlap(
				{ kind: "tree", path: "a/b", access: "read" },
				{ kind: "tree", path: "a/bc", access: "write" },
			),
		).toBe(false);
		expect(
			repositoryScopesOverlap(
				{ kind: "repo", access: "read" },
				{ kind: "file", path: "anything", access: "read" },
			),
		).toBe(true);
	});

	it("keeps review verdicts, provider failures, and independence fields disjoint", () => {
		const common = {
			schema_version: "anamnesis.work-review-attempt-event.v1" as const,
			...basis,
			gate: "planning" as const,
			activity_id: "review_one",
			attempt_id: "attempt_one",
			review_input_hash: digest,
			provider: "codex_native" as const,
			role: "critic",
		};
		expect(() =>
			workReviewAttemptPayloadSchema.parse({
				...common,
				outcome: "passed",
				reviewer_instance_ref: { provider: "codex_native", ref: "same" },
				author_instance_refs: [{ provider: "codex_native", ref: "same" }],
				independence_assurance: "runtime_attested",
				independence_evidence_refs: ["runtime:refs"],
				artifact_refs: [artifact],
				finding_refs: [],
			}),
		).toThrow(/differ/);
		expect(
			workReviewAttemptPayloadSchema.parse({
				...common,
				outcome: "passed",
				reviewer_instance_ref: { provider: "codex_native", ref: "Ref" },
				author_instance_refs: [{ provider: "codex_native", ref: "ref" }],
				independence_assurance: "runtime_attested",
				independence_evidence_refs: ["runtime:refs"],
				artifact_refs: [artifact],
				finding_refs: [],
			}).outcome,
		).toBe("passed");
		expect(() =>
			workReviewAttemptPayloadSchema.parse({
				...common,
				outcome: "unavailable",
				failure_input: { capability_ref: "cap" },
				failure_refs: ["diag"],
				finding_refs: ["must-not-mix"],
			}),
		).toThrow();
	});

	it("accepts all five strict payload families and rejects cross-variant fields", () => {
		expect(
			workReviewRequestedPayloadSchema.parse({
				schema_version: "anamnesis.work-review-request-event.v1",
				...basis,
				gate: "planning",
				activity_id: "review_one",
				review_input_hash: digest,
				artifact_refs: [artifact],
				provider_order: ["omx", "codex_native", "separate_process"],
				role_hint: "critic",
				minimum_reviewers: 1,
			}).gate,
		).toBe("planning");
		expect(
			workParallelismAssessmentPayloadSchema.parse({
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				decision: "not_parallelizable",
				lanes: [lane],
				selected_provider: null,
				rationale_codes: ["indivisible"],
				evidence_refs: ["plan:one"],
			}).decision,
		).toBe("not_parallelizable");
		expect(() =>
			workParallelismAssessmentPayloadSchema.parse({
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				...basis,
				assessment_id: "assess_fake",
				assessment_input_hash: digest,
				decision: "parallel",
				lanes: [lane],
				selected_provider: "native_agents",
				rationale_codes: ["fake"],
				evidence_refs: ["plan:one"],
			}),
		).toThrow(/at least two lanes/);
		expect(() =>
			workParallelismAssessmentPayloadSchema.parse({
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				...basis,
				assessment_id: "assess_solo",
				assessment_input_hash: digest,
				decision: "solo",
				lanes: [lane],
				selected_provider: "native_agents",
				rationale_codes: ["indivisible"],
				evidence_refs: ["plan:one"],
			}),
		).toThrow(/cannot select/);
		const child = {
			lane_id: "lane_one",
			work_id: "wu_one",
			basis_contract_revision: 1,
			requirement_ids: ["req_one"],
			invariant_refs: ["inv:one"],
			invariant_hash: digest,
			repository_scopes: lane.repository_scopes,
			external_effects: [],
			side_effect_exclusions: ["no-network"],
			expected_artifact_refs: ["artifact:one"],
			expected_evidence_refs: ["evidence:one"],
			source_pointers: ["docs/plan.md"],
		};
		expect(childContractSchema.parse(child).lane_id).toBe("lane_one");
		expect(
			workDelegationOutcomePayloadSchema.parse({
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				provider: "native_agents",
				outcome: "delegated",
				child_contracts: [child],
				delegation_contract_hash: digest,
			}).outcome,
		).toBe("delegated");
		expect(() =>
			workDelegationOutcomePayloadSchema.parse({
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				provider: "native_agents",
				outcome: "results_recorded",
				delegation_contract_hash: digest,
				result_refs: ["result:one"],
				child_contracts: [child],
			}),
		).toThrow();
		expect(
			workDelegationWaiverPayloadSchema.parse({
				schema_version: "anamnesis.work-delegation-waiver-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				reason: "explicit user authority",
				authority_ref: "user:one",
				source_event_id: "src_one",
				evidence_refs: ["decision:one"],
			}).assessment_id,
		).toBe("assess_one");
	});
});
