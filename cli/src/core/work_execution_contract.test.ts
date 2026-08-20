import { describe, expect, it } from "vitest";

import type { RuntimeAttestedCapability } from "./work_contract.js";
import {
	assertParallelLanesSafe,
	calculateAssessmentInputHash,
	calculateReviewInputHash,
	evaluateWorkProtectedAction,
	repositoryScopesOverlap,
	selectDelegationProvider,
	selectNextReviewProvider,
	validateRepositoryPath,
	type WorkExecutionStateView,
	workProtectedActionReadinessSchema,
} from "./work_execution_contract.js";
import { normalizeWorkPolicyConfig } from "./work_policy.js";

const H1 = `sha256:${"1".repeat(64)}`;
const H2 = `sha256:${"2".repeat(64)}`;

function state(): WorkExecutionStateView {
	return {
		work_id: "wu_test",
		contract_revision: 1,
		contract_hash: H1,
		policy_hash: H2,
		review: {},
		parallelism: null,
	};
}

function capability(
	providers: RuntimeAttestedCapability["providers"] = [
		{ provider: "native_agents", availability: "available", max_agents: 4 },
		{ provider: "tmux_team", availability: "available", max_agents: 4 },
	],
): RuntimeAttestedCapability {
	return {
		assurance: "runtime_attested",
		capability_ref: "runtime:cap",
		providers,
	};
}

describe("execution hashes", () => {
	it("changes review and assessment hashes when material inputs change", () => {
		const review = {
			gate: "planning" as const,
			work_id: "wu_test",
			contract_revision: 1,
			contract_hash: H1,
			policy_hash: H2,
		};
		expect(
			calculateReviewInputHash({ ...review, inputs: { bytes: "a" } }),
		).not.toBe(calculateReviewInputHash({ ...review, inputs: { bytes: "b" } }));
		const assessment = {
			work_id: "wu_test",
			contract_revision: 1,
			contract_hash: H1,
			policy_hash: H2,
			material_scope: { repository_scopes: [], external_effects: [] },
			runtime_capability: capability(),
			worktree_fingerprint: H1,
		};
		expect(calculateAssessmentInputHash(assessment)).not.toBe(
			calculateAssessmentInputHash({ ...assessment, worktree_fingerprint: H2 }),
		);
	});
});

describe("repository and external-effect lane safety", () => {
	it("uses structural repo/file/tree overlap semantics", () => {
		expect(
			repositoryScopesOverlap(
				{ kind: "repo", access: "read" },
				{ kind: "file", path: "cli/src/a.ts", access: "read" },
			),
		).toBe(true);
		expect(
			repositoryScopesOverlap(
				{ kind: "tree", path: "cli/src", access: "read" },
				{ kind: "file", path: "cli/src/a.ts", access: "write" },
			),
		).toBe(true);
		expect(
			repositoryScopesOverlap(
				{ kind: "tree", path: "cli/src", access: "read" },
				{ kind: "file", path: "cli/src-other/a.ts", access: "write" },
			),
		).toBe(false);
	});

	it.each([
		"/absolute",
		"../escape",
		"a/../b",
		"a//b",
		"a/",
		"a\\b",
		"*.ts",
	])("rejects unsafe repository path %s", (value) =>
		expect(() => validateRepositoryPath(value)).toThrow(/unsafe/));

	it("requires dependency serialization for write overlap and irreversible effects", () => {
		const lanes = [
			{
				lane_id: "a",
				repository_scopes: [
					{ kind: "tree" as const, path: "cli/src", access: "write" as const },
				],
				external_effects: [],
				depends_on: [],
			},
			{
				lane_id: "b",
				repository_scopes: [
					{
						kind: "file" as const,
						path: "cli/src/a.ts",
						access: "read" as const,
					},
				],
				external_effects: [],
				depends_on: [],
			},
		];
		expect(() => assertParallelLanesSafe(lanes)).toThrow(/conflict/);
		expect(() =>
			assertParallelLanesSafe([{ ...lanes[0]!, depends_on: ["b"] }, lanes[1]!]),
		).not.toThrow();
	});
});

describe("provider selection", () => {
	it("advances OMX failures to Codex native only for frozen fallback outcomes", () => {
		const policy = normalizeWorkPolicyConfig({ review: { preset: "strict" } });
		const gate = policy.review.gates[0]!;
		expect(
			selectNextReviewProvider({
				gate,
				policy: policy.review,
				current_provider: "omx",
				outcome: "unsupported_authority",
			}),
		).toBe("codex_native");
		const noFallback = {
			...policy.review,
			fallback_on: ["authorization_error" as const],
		};
		expect(
			selectNextReviewProvider({
				gate,
				policy: noFallback,
				current_provider: "omx",
				outcome: "unsupported_authority",
			}),
		).toBeNull();
	});

	it("never falls through from a required runtime surface", () => {
		const nativeRequired = normalizeWorkPolicyConfig({
			delegation: {
				parallelism: "required",
				native_agents: "required",
				tmux_team: "auto",
			},
		}).delegation;
		expect(
			selectDelegationProvider(
				nativeRequired,
				capability([
					{
						provider: "native_agents",
						availability: "unavailable",
						max_agents: 0,
					},
					{ provider: "tmux_team", availability: "available", max_agents: 4 },
				]),
			),
		).toBeNull();
		const tmuxRequired = normalizeWorkPolicyConfig({
			delegation: {
				parallelism: "required",
				native_agents: "auto",
				tmux_team: "required",
			},
		}).delegation;
		expect(
			selectDelegationProvider(
				tmuxRequired,
				capability([
					{
						provider: "native_agents",
						availability: "available",
						max_agents: 4,
					},
					{
						provider: "tmux_team",
						availability: "unsupported_authority",
						max_agents: 0,
					},
				]),
			),
		).toBeNull();
	});

	it("selects only providers with capacity for the required assessed lanes", () => {
		const policy = normalizeWorkPolicyConfig({
			delegation: { parallelism: "required" },
		}).delegation;
		expect(
			selectDelegationProvider(
				policy,
				capability([
					{
						provider: "native_agents",
						availability: "available",
						max_agents: 1,
					},
					{ provider: "tmux_team", availability: "available", max_agents: 3 },
				]),
				2,
			),
		).toBe("tmux_team");
		expect(
			selectDelegationProvider(
				policy,
				capability([
					{
						provider: "native_agents",
						availability: "available",
						max_agents: 1,
					},
					{ provider: "tmux_team", availability: "available", max_agents: 1 },
				]),
				2,
			),
		).toBeNull();
		expect(() => selectDelegationProvider(policy, capability(), 0)).toThrow(
			/positive/,
		);
	});
});

describe("evaluateWorkProtectedAction", () => {
	it("rejects a protected action paired with the wrong frozen review gate", () => {
		const policy = normalizeWorkPolicyConfig();
		expect(() =>
			evaluateWorkProtectedAction({
				execution_state: state(),
				action: "implementation_entry",
				canonical_inputs: {
					planning_review: null,
					completion_review: null,
					parallelism: null,
				},
				review_gate: policy.review.gates[1]!,
				delegation_policy: policy.delegation,
			}),
		).toThrow(/planning review gate/);
	});

	it("keeps default-off omission quiet", () => {
		const policy = normalizeWorkPolicyConfig();
		const result = evaluateWorkProtectedAction({
			execution_state: state(),
			action: "implementation_entry",
			canonical_inputs: {
				planning_review: null,
				completion_review: null,
				parallelism: null,
			},
			review_gate: policy.review.gates[0]!,
			delegation_policy: policy.delegation,
		});
		expect(result).toEqual({
			allowed: true,
			contextual_state: { review: "off", parallelism: "off" },
			input_status: {
				planning_review: "not_required",
				completion_review: "not_required",
				parallelism: "not_required",
			},
			reason_codes: [],
			blockers: [],
			advisories: [],
			obligations: [],
		});
	});

	it.each([
		["advisory", true, "advisories"],
		["strict", false, "blockers"],
	] as const)("maps missing planning inputs for %s policy", (preset, allowed, reasonField) => {
		const policy = normalizeWorkPolicyConfig({ review: { preset } });
		const result = evaluateWorkProtectedAction({
			execution_state: state(),
			action: "implementation_entry",
			canonical_inputs: {
				planning_review: null,
				completion_review: null,
				parallelism: null,
			},
			review_gate: policy.review.gates[0]!,
			delegation_policy: policy.delegation,
		});
		expect(result.allowed).toBe(allowed);
		expect(result.input_status.planning_review).toBe("missing");
		expect(result[reasonField]).toContain("current_inputs_required");
		expect(result.obligations).toEqual([
			{
				kind: "current_inputs_required",
				input: "planning_review",
				reason_code: "current_inputs_required",
			},
		]);
	});

	it("requires current matching review evidence and the minimum distinct reviewers", () => {
		const policy = normalizeWorkPolicyConfig({
			review: {
				preset: "custom",
				gates: [
					{
						gate: "planning",
						enforcement: "required",
						reviewer: { capability: "independent_agent", minimum_reviewers: 2 },
					},
				],
			},
		});
		const executionState = state();
		executionState.review.planning = {
			gate: "planning",
			review_input_hash: H1,
			state: "passed",
			passing_reviewer_refs: [
				{ provider: "omx", ref: "reviewer" },
				{ provider: "omx", ref: "reviewer" },
			],
			next_provider: null,
		};
		const result = evaluateWorkProtectedAction({
			execution_state: executionState,
			action: "implementation_entry",
			canonical_inputs: {
				planning_review: { review_input_hash: H1 },
				completion_review: null,
				parallelism: null,
			},
			review_gate: policy.review.gates[0]!,
			delegation_policy: policy.delegation,
		});
		expect(result.allowed).toBe(false);
		expect(result.blockers).toEqual(["reviewers_insufficient"]);
	});

	it("treats supplied unavailable completion facts as typed advisory or blocker", () => {
		for (const preset of ["advisory", "strict"] as const) {
			const policy = normalizeWorkPolicyConfig({ review: { preset } });
			const result = evaluateWorkProtectedAction({
				execution_state: state(),
				action: "completion",
				canonical_inputs: {
					planning_review: null,
					completion_review: { unavailable: "ref_unresolvable" },
					parallelism: null,
				},
				review_gate: policy.review.gates[1]!,
				delegation_policy: policy.delegation,
			});
			expect(result.allowed).toBe(preset === "advisory");
			expect(result.input_status.completion_review).toBe("ref_unresolvable");
			expect(result.reason_codes).toEqual(["ref_unresolvable"]);
		}
	});

	it("revalidates assessment hash and current waiver", () => {
		const policy = normalizeWorkPolicyConfig({
			delegation: { parallelism: "required" },
		});
		const executionState = state();
		executionState.parallelism = {
			assessment_id: "assess_1",
			assessment_input_hash: H1,
			decision: "solo",
			state: "assessed",
			selected_provider: null,
			next_provider: null,
			waiver_assessment_id: "assess_1",
			waiver_assessment_input_hash: H1,
		};
		const current = evaluateWorkProtectedAction({
			execution_state: executionState,
			action: "implementation_entry",
			canonical_inputs: {
				planning_review: null,
				completion_review: null,
				parallelism: {
					assessment_input_hash: H1,
					runtime_capability: capability(),
				},
			},
			review_gate: policy.review.gates[0]!,
			delegation_policy: policy.delegation,
		});
		expect(current.contextual_state.parallelism).toBe("continue_solo");
		expect(current.allowed).toBe(true);
		const changed = evaluateWorkProtectedAction({
			execution_state: executionState,
			action: "implementation_entry",
			canonical_inputs: {
				planning_review: null,
				completion_review: null,
				parallelism: {
					assessment_input_hash: H2,
					runtime_capability: capability(),
				},
			},
			review_gate: policy.review.gates[0]!,
			delegation_policy: policy.delegation,
		});
		expect(changed.contextual_state.parallelism).toBe("assessment_due");
		expect(changed.allowed).toBe(false);
		expect(changed.blockers).toEqual(["assessment_changed"]);
	});

	it("blocks on an explicit ask obligation even under automatic parallelism", () => {
		const policy = normalizeWorkPolicyConfig({
			delegation: { parallelism: "auto", unavailable: "ask" },
		});
		const executionState = state();
		executionState.parallelism = {
			assessment_id: "assess_ask",
			assessment_input_hash: H1,
			decision: "parallel",
			state: "ask",
			selected_provider: null,
			next_provider: null,
			waiver_assessment_id: null,
			waiver_assessment_input_hash: null,
			required_agents: 2,
		};
		const result = evaluateWorkProtectedAction({
			execution_state: executionState,
			action: "implementation_entry",
			canonical_inputs: {
				planning_review: null,
				completion_review: null,
				parallelism: {
					assessment_input_hash: H1,
					runtime_capability: capability(),
				},
			},
			review_gate: policy.review.gates[0]!,
			delegation_policy: policy.delegation,
		});
		expect(result.allowed).toBe(false);
		expect(result.blockers).toEqual(["explicit_user_choice_required"]);
		expect(result.obligations).toEqual([
			{
				kind: "ask_user",
				reason_code: "explicit_user_choice_required",
				assessment_id: "assess_ask",
			},
		]);
	});

	it("does not emit a delegation provider obligation below assessed lane capacity", () => {
		const policy = normalizeWorkPolicyConfig({
			delegation: { parallelism: "required" },
		});
		const executionState = state();
		executionState.parallelism = {
			assessment_id: "assess_capacity",
			assessment_input_hash: H1,
			decision: "parallel",
			state: "delegation_due",
			selected_provider: "native_agents",
			next_provider: "native_agents",
			waiver_assessment_id: null,
			waiver_assessment_input_hash: null,
			required_agents: 2,
		};
		const result = evaluateWorkProtectedAction({
			execution_state: executionState,
			action: "implementation_entry",
			canonical_inputs: {
				planning_review: null,
				completion_review: null,
				parallelism: {
					assessment_input_hash: H1,
					runtime_capability: capability([
						{
							provider: "native_agents",
							availability: "available",
							max_agents: 1,
						},
						{ provider: "tmux_team", availability: "available", max_agents: 4 },
					]),
				},
			},
			review_gate: policy.review.gates[0]!,
			delegation_policy: policy.delegation,
		});
		expect(result.allowed).toBe(false);
		expect(result.obligations).not.toContainEqual(
			expect.objectContaining({ kind: "delegate" }),
		);
		expect(result.blockers).toEqual(["assessment_changed"]);
	});

	it("exports a closed strict readiness DTO", () => {
		expect(() =>
			workProtectedActionReadinessSchema.parse({ extra: true }),
		).toThrow();
	});
});
