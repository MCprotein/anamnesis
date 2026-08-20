import { z } from "zod";

import { sha256 } from "../util/hash.js";
import type {
	ExternalEffect,
	RepositoryScope,
	RuntimeAttestedCapability,
} from "./work_contract.js";
import type {
	NormalizedDelegationPolicy,
	NormalizedReviewGate,
	NormalizedReviewPolicy,
	ReviewGateName,
} from "./work_policy.js";

export {
	calculateWorkChildContractHash,
	calculateWorkDelegationContractHash,
	calculateWorkDelegationFailureFingerprint,
} from "./work_contract.js";

export type ReviewProvider = "omx" | "codex_native" | "separate_process";
export type DelegationProvider = "native_agents" | "tmux_team";

export type ReadinessReasonCode =
	| "current_inputs_required"
	| "git_unavailable"
	| "ref_unresolvable"
	| "git_output_limit_exceeded"
	| "review_request_required"
	| "review_changes_requested"
	| "review_provider_unavailable"
	| "reviewers_insufficient"
	| "assessment_required"
	| "assessment_changed"
	| "delegation_required"
	| "delegation_provider_unavailable"
	| "explicit_user_choice_required";

export type InputStatus =
	| "not_required"
	| "current"
	| "missing"
	| "git_unavailable"
	| "ref_unresolvable"
	| "git_output_limit_exceeded";

export type RuntimeObligation =
	| {
			kind: "current_inputs_required";
			input: "planning_review" | "completion_review" | "parallelism";
			reason_code:
				| "current_inputs_required"
				| "git_unavailable"
				| "ref_unresolvable"
				| "git_output_limit_exceeded";
	  }
	| {
			kind: "request_review";
			reason_code: "review_request_required";
			gate: ReviewGateName;
			provider: ReviewProvider;
			role: string;
			review_input_hash: string;
	  }
	| {
			kind: "assess_parallelism";
			reason_code: "assessment_required";
			assessment_input_hash: string;
	  }
	| {
			kind: "delegate";
			reason_code: "delegation_required";
			provider: DelegationProvider;
			assessment_id: string;
			assessment_input_hash: string;
	  }
	| {
			kind: "ask_user";
			reason_code: "explicit_user_choice_required";
			assessment_id: string | null;
	  };

export interface WorkProtectedActionReadiness {
	allowed: boolean;
	contextual_state: {
		review:
			| "off"
			| "pending"
			| "requested"
			| "changes_requested"
			| "passed"
			| "ask"
			| "blocked_unavailable"
			| "waived";
		parallelism:
			| "off"
			| "assessment_due"
			| "assessed"
			| "delegation_due"
			| "delegated"
			| "results_recorded"
			| "continue_solo"
			| "ask"
			| "blocked_unavailable";
	};
	input_status: {
		planning_review: InputStatus;
		completion_review: InputStatus;
		parallelism: InputStatus;
	};
	reason_codes: ReadinessReasonCode[];
	blockers: ReadinessReasonCode[];
	advisories: ReadinessReasonCode[];
	obligations: RuntimeObligation[];
}

export type ReviewEvidenceState =
	| "requested"
	| "changes_requested"
	| "passed"
	| "ask"
	| "blocked_unavailable"
	| "waived";

export interface WorkReviewEvidenceView {
	gate: ReviewGateName;
	review_input_hash: string;
	state: ReviewEvidenceState;
	passing_reviewer_refs: Array<{ provider: string; ref: string }>;
	next_provider: ReviewProvider | null;
}

export interface WorkParallelismEvidenceView {
	assessment_id: string;
	assessment_input_hash: string;
	decision: "parallel" | "solo" | "not_parallelizable";
	state:
		| "assessed"
		| "delegation_due"
		| "delegated"
		| "results_recorded"
		| "continue_solo"
		| "ask"
		| "blocked_unavailable";
	selected_provider: DelegationProvider | null;
	next_provider: DelegationProvider | null;
	waiver_assessment_id: string | null;
	waiver_assessment_input_hash: string | null;
	/** Number of assessed lanes that the selected runtime must support. */
	required_agents: number;
}

export interface WorkExecutionStateView {
	work_id: string;
	contract_revision: number;
	contract_hash: string;
	policy_hash: string;
	review: Partial<Record<ReviewGateName, WorkReviewEvidenceView>>;
	parallelism: WorkParallelismEvidenceView | null;
}

export interface CanonicalReviewInputs {
	review_input_hash: string;
}

export interface CanonicalParallelismInputs {
	assessment_input_hash: string;
	runtime_capability: RuntimeAttestedCapability;
}

export interface CanonicalExecutionInputsView {
	planning_review: CanonicalReviewInputs | null;
	completion_review:
		| CanonicalReviewInputs
		| {
				unavailable: Exclude<
					InputStatus,
					"not_required" | "current" | "missing"
				>;
		  }
		| null;
	parallelism: CanonicalParallelismInputs | null;
}

export interface EvaluateWorkProtectedActionOptions {
	execution_state: WorkExecutionStateView;
	action: "implementation_entry" | "completion";
	canonical_inputs: CanonicalExecutionInputsView;
	review_gate: NormalizedReviewGate;
	delegation_policy: NormalizedDelegationPolicy;
}

const readinessReasonSchema = z.enum([
	"current_inputs_required",
	"git_unavailable",
	"ref_unresolvable",
	"git_output_limit_exceeded",
	"review_request_required",
	"review_changes_requested",
	"review_provider_unavailable",
	"reviewers_insufficient",
	"assessment_required",
	"assessment_changed",
	"delegation_required",
	"delegation_provider_unavailable",
	"explicit_user_choice_required",
]);
const inputStatusSchema = z.enum([
	"not_required",
	"current",
	"missing",
	"git_unavailable",
	"ref_unresolvable",
	"git_output_limit_exceeded",
]);
const runtimeObligationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("current_inputs_required"),
			input: z.enum(["planning_review", "completion_review", "parallelism"]),
			reason_code: z.enum([
				"current_inputs_required",
				"git_unavailable",
				"ref_unresolvable",
				"git_output_limit_exceeded",
			]),
		})
		.strict(),
	z
		.object({
			kind: z.literal("request_review"),
			reason_code: z.literal("review_request_required"),
			gate: z.enum(["planning", "completion"]),
			provider: z.enum(["omx", "codex_native", "separate_process"]),
			role: z.string().trim().min(1),
			review_input_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		})
		.strict(),
	z
		.object({
			kind: z.literal("assess_parallelism"),
			reason_code: z.literal("assessment_required"),
			assessment_input_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		})
		.strict(),
	z
		.object({
			kind: z.literal("delegate"),
			reason_code: z.literal("delegation_required"),
			provider: z.enum(["native_agents", "tmux_team"]),
			assessment_id: z.string().trim().min(1),
			assessment_input_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		})
		.strict(),
	z
		.object({
			kind: z.literal("ask_user"),
			reason_code: z.literal("explicit_user_choice_required"),
			assessment_id: z.string().trim().min(1).nullable(),
		})
		.strict(),
]);

export const workProtectedActionReadinessSchema = z
	.object({
		allowed: z.boolean(),
		contextual_state: z
			.object({
				review: z.enum([
					"off",
					"pending",
					"requested",
					"changes_requested",
					"passed",
					"ask",
					"blocked_unavailable",
					"waived",
				]),
				parallelism: z.enum([
					"off",
					"assessment_due",
					"assessed",
					"delegation_due",
					"delegated",
					"results_recorded",
					"continue_solo",
					"ask",
					"blocked_unavailable",
				]),
			})
			.strict(),
		input_status: z
			.object({
				planning_review: inputStatusSchema,
				completion_review: inputStatusSchema,
				parallelism: inputStatusSchema,
			})
			.strict(),
		reason_codes: z.array(readinessReasonSchema),
		blockers: z.array(readinessReasonSchema),
		advisories: z.array(readinessReasonSchema),
		obligations: z.array(runtimeObligationSchema),
	})
	.strict();

export function evaluateWorkProtectedAction(
	options: EvaluateWorkProtectedActionOptions,
): WorkProtectedActionReadiness {
	const expectedGate =
		options.action === "implementation_entry" ? "planning" : "completion";
	if (options.review_gate.gate !== expectedGate) {
		throw new Error(
			`protected action ${options.action} requires the ${expectedGate} review gate`,
		);
	}
	const result: WorkProtectedActionReadiness = {
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
	};

	evaluateReview(options, result);
	if (options.action === "implementation_entry") {
		evaluateParallelism(options, result);
	}
	result.reason_codes = orderedUnique([
		...result.blockers,
		...result.advisories,
		...result.obligations.map((item) => item.reason_code),
	]);
	result.blockers = orderedUnique(result.blockers);
	result.advisories = orderedUnique(result.advisories);
	result.obligations = orderedUniqueObligations(result.obligations);
	result.allowed = result.blockers.length === 0;
	return workProtectedActionReadinessSchema.parse(result);
}

function evaluateReview(
	options: EvaluateWorkProtectedActionOptions,
	result: WorkProtectedActionReadiness,
): void {
	const gate = options.review_gate;
	const inputKey =
		gate.gate === "planning" ? "planning_review" : "completion_review";
	if (gate.enforcement === "off") return;
	const input = options.canonical_inputs[inputKey];
	if (!input) {
		result.contextual_state.review = "pending";
		addInputProblem(
			result,
			inputKey,
			"missing",
			gate.enforcement === "required",
		);
		return;
	}
	if ("unavailable" in input) {
		result.contextual_state.review = "pending";
		addInputProblem(
			result,
			inputKey,
			input.unavailable,
			gate.enforcement === "required",
		);
		return;
	}
	result.input_status[inputKey] = "current";
	if (gate.waived_by) {
		result.contextual_state.review = "waived";
		return;
	}
	const evidence = options.execution_state.review[gate.gate];
	if (!evidence || evidence.review_input_hash !== input.review_input_hash) {
		result.contextual_state.review = "pending";
		const provider = evidence?.next_provider ?? gate.provider_order[0];
		if (provider) {
			result.obligations.push({
				kind: "request_review",
				reason_code: "review_request_required",
				gate: gate.gate,
				provider,
				role: gate.role_hint,
				review_input_hash: input.review_input_hash,
			});
		}
		addPolicyReason(
			result,
			"review_request_required",
			gate.enforcement === "required",
		);
		return;
	}
	result.contextual_state.review = evidence.state;
	switch (evidence.state) {
		case "passed": {
			const distinct = uniqueInstanceRefs(evidence.passing_reviewer_refs);
			if (distinct.length < gate.minimum_reviewers) {
				result.contextual_state.review = "pending";
				addPolicyReason(
					result,
					"reviewers_insufficient",
					gate.enforcement === "required",
				);
			}
			return;
		}
		case "changes_requested":
			addPolicyReason(
				result,
				"review_changes_requested",
				gate.enforcement === "required",
			);
			return;
		case "blocked_unavailable":
			addPolicyReason(
				result,
				"review_provider_unavailable",
				gate.enforcement === "required",
			);
			return;
		case "ask":
			result.obligations.push({
				kind: "ask_user",
				reason_code: "explicit_user_choice_required",
				assessment_id: null,
			});
			addPolicyReason(result, "explicit_user_choice_required", true);
			return;
		case "requested":
			addPolicyReason(
				result,
				"review_request_required",
				gate.enforcement === "required",
			);
			return;
		case "waived":
			return;
	}
}

function evaluateParallelism(
	options: EvaluateWorkProtectedActionOptions,
	result: WorkProtectedActionReadiness,
): void {
	const policy = options.delegation_policy;
	if (policy.parallelism === "off") return;
	const strict = policy.parallelism === "required";
	const input = options.canonical_inputs.parallelism;
	if (!input) {
		result.contextual_state.parallelism = "assessment_due";
		addInputProblem(result, "parallelism", "missing", strict);
		return;
	}
	result.input_status.parallelism = "current";
	const evidence = options.execution_state.parallelism;
	if (
		!evidence ||
		evidence.assessment_input_hash !== input.assessment_input_hash
	) {
		result.contextual_state.parallelism = "assessment_due";
		result.obligations.push({
			kind: "assess_parallelism",
			reason_code: "assessment_required",
			assessment_input_hash: input.assessment_input_hash,
		});
		addPolicyReason(
			result,
			evidence ? "assessment_changed" : "assessment_required",
			strict,
		);
		return;
	}
	if (evidence.decision === "not_parallelizable") {
		result.contextual_state.parallelism = "continue_solo";
		return;
	}
	if (evidence.decision === "solo") {
		const currentWaiver =
			evidence.waiver_assessment_id === evidence.assessment_id &&
			evidence.waiver_assessment_input_hash === input.assessment_input_hash;
		if (!strict || currentWaiver) {
			result.contextual_state.parallelism = "continue_solo";
			return;
		}
		result.contextual_state.parallelism = "delegation_due";
		addPolicyReason(result, "delegation_required", true);
		return;
	}
	result.contextual_state.parallelism = evidence.state;
	if (evidence.state === "delegation_due" || evidence.state === "assessed") {
		result.contextual_state.parallelism = "delegation_due";
		const requiredAgents = evidence.required_agents;
		const expectedProvider = selectDelegationProvider(
			policy,
			input.runtime_capability,
			requiredAgents,
		);
		if (requiredAgents < 2 || evidence.selected_provider !== expectedProvider) {
			result.contextual_state.parallelism = "assessment_due";
			result.obligations.push({
				kind: "assess_parallelism",
				reason_code: "assessment_required",
				assessment_input_hash: input.assessment_input_hash,
			});
			addPolicyReason(result, "assessment_changed", strict);
			return;
		}
		const provider = evidence.next_provider
			? providerHasCapacity(
					evidence.next_provider,
					input.runtime_capability,
					requiredAgents,
				)
				? evidence.next_provider
				: null
			: selectDelegationProvider(
					policy,
					input.runtime_capability,
					requiredAgents,
				);
		if (provider) {
			result.obligations.push({
				kind: "delegate",
				reason_code: "delegation_required",
				provider,
				assessment_id: evidence.assessment_id,
				assessment_input_hash: evidence.assessment_input_hash,
			});
		}
		addPolicyReason(result, "delegation_required", strict);
		return;
	}
	if (evidence.state === "blocked_unavailable") {
		addPolicyReason(result, "delegation_provider_unavailable", strict);
		return;
	}
	if (evidence.state === "ask") {
		result.obligations.push({
			kind: "ask_user",
			reason_code: "explicit_user_choice_required",
			assessment_id: evidence.assessment_id,
		});
		addPolicyReason(result, "explicit_user_choice_required", true);
	}
}

function addInputProblem(
	result: WorkProtectedActionReadiness,
	input: keyof WorkProtectedActionReadiness["input_status"],
	status: Exclude<InputStatus, "not_required" | "current">,
	blocking: boolean,
): void {
	result.input_status[input] = status;
	const reason = status === "missing" ? "current_inputs_required" : status;
	result.obligations.push({
		kind: "current_inputs_required",
		input,
		reason_code: reason,
	});
	addPolicyReason(result, reason, blocking);
}

function addPolicyReason(
	result: WorkProtectedActionReadiness,
	reason: ReadinessReasonCode,
	blocking: boolean,
): void {
	(blocking ? result.blockers : result.advisories).push(reason);
}

export function calculateReviewInputHash(input: {
	gate: ReviewGateName;
	work_id: string;
	contract_revision: number;
	contract_hash: string;
	policy_hash: string;
	inputs: unknown;
}): string {
	return sha256(canonicalJson(input));
}

export function calculateAssessmentInputHash(input: {
	work_id: string;
	contract_revision: number;
	contract_hash: string;
	policy_hash: string;
	material_scope: {
		repository_scopes: RepositoryScope[];
		external_effects: ExternalEffect[];
	};
	runtime_capability: RuntimeAttestedCapability;
	worktree_fingerprint: string;
}): string {
	return sha256(canonicalJson(input));
}

export function validateRepositoryScope(
	scope: RepositoryScope,
): RepositoryScope {
	if (scope.kind === "repo") return { kind: "repo", access: scope.access };
	return { ...scope, path: validateRepositoryPath(scope.path) };
}

export function validateRepositoryPath(value: string): string {
	if (
		value.length === 0 ||
		value !== value.trim() ||
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.includes("\\") ||
		value.includes("//") ||
		/[?*\[\]{}]/u.test(value)
	) {
		throw new Error(`unsafe repository path: ${value}`);
	}
	const segments = value.split("/");
	if (
		segments.some(
			(segment) => segment === "." || segment === ".." || segment === "",
		)
	) {
		throw new Error(`unsafe repository path: ${value}`);
	}
	return value;
}

export function repositoryScopesOverlap(
	left: RepositoryScope,
	right: RepositoryScope,
): boolean {
	if (left.kind === "repo" || right.kind === "repo") return true;
	if (left.kind === "file" && right.kind === "file")
		return left.path === right.path;
	if (left.kind === "tree" && right.kind === "tree") {
		return (
			containsPath(left.path, right.path) || containsPath(right.path, left.path)
		);
	}
	const file = left.kind === "file" ? left : right;
	const tree = left.kind === "tree" ? left : right;
	return containsPath(tree.path, file.path);
}

export function assertParallelLanesSafe(
	lanes: Array<{
		lane_id: string;
		repository_scopes: RepositoryScope[];
		external_effects: ExternalEffect[];
		depends_on: string[];
	}>,
): void {
	const ids = new Set(lanes.map((lane) => lane.lane_id));
	if (ids.size !== lanes.length) throw new Error("duplicate lane_id");
	for (const lane of lanes) {
		for (const dependency of lane.depends_on) {
			if (!ids.has(dependency) || dependency === lane.lane_id) {
				throw new Error(`invalid lane dependency: ${dependency}`);
			}
		}
	}
	assertAcyclic(lanes);
	for (let leftIndex = 0; leftIndex < lanes.length; leftIndex += 1) {
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < lanes.length;
			rightIndex += 1
		) {
			const left = lanes[leftIndex]!;
			const right = lanes[rightIndex]!;
			if (isOrdered(left.lane_id, right.lane_id, lanes)) continue;
			const repoConflict = left.repository_scopes.some((leftScope) =>
				right.repository_scopes.some(
					(rightScope) =>
						repositoryScopesOverlap(leftScope, rightScope) &&
						(leftScope.access === "write" || rightScope.access === "write"),
				),
			);
			const effectConflict = left.external_effects.some((leftEffect) =>
				right.external_effects.some(
					(rightEffect) =>
						leftEffect.resource_kind === rightEffect.resource_kind &&
						leftEffect.resource_ref === rightEffect.resource_ref &&
						(leftEffect.access === "write" ||
							rightEffect.access === "write" ||
							leftEffect.irreversible ||
							rightEffect.irreversible),
				),
			);
			if (repoConflict || effectConflict) {
				throw new Error(
					`parallel lanes ${left.lane_id} and ${right.lane_id} conflict`,
				);
			}
		}
	}
}

export function selectDelegationProvider(
	policy: NormalizedDelegationPolicy,
	capability: RuntimeAttestedCapability,
	requiredAgents = 1,
): DelegationProvider | null {
	if (!Number.isSafeInteger(requiredAgents) || requiredAgents < 1) {
		throw new Error(
			"required delegation agent count must be a positive safe integer",
		);
	}
	const requiredProvider: DelegationProvider | null =
		policy.native_agents === "required"
			? "native_agents"
			: policy.tmux_team === "required"
				? "tmux_team"
				: null;
	const candidates: DelegationProvider[] = requiredProvider
		? [requiredProvider]
		: [...policy.fallback_order];
	for (const provider of candidates) {
		const preference =
			provider === "native_agents" ? policy.native_agents : policy.tmux_team;
		if (
			preference !== "never" &&
			providerHasCapacity(provider, capability, requiredAgents)
		) {
			return provider;
		}
	}
	return null;
}

function providerHasCapacity(
	provider: DelegationProvider,
	capability: RuntimeAttestedCapability,
	requiredAgents: number,
): boolean {
	const reported = capability.providers.find(
		(item) => item.provider === provider,
	);
	return (
		reported?.availability === "available" &&
		reported.max_agents >= requiredAgents
	);
}

export function selectNextReviewProvider(input: {
	gate: NormalizedReviewGate;
	policy: NormalizedReviewPolicy;
	current_provider: ReviewProvider;
	outcome: "authorization_error" | "unsupported_authority" | "unavailable";
}): ReviewProvider | null {
	if (!input.policy.fallback_on.includes(input.outcome)) return null;
	const currentIndex = input.gate.provider_order.indexOf(
		input.current_provider,
	);
	if (currentIndex < 0) return null;
	return input.gate.provider_order[currentIndex + 1] ?? null;
}

function uniqueInstanceRefs(values: Array<{ provider: string; ref: string }>) {
	const seen = new Set<string>();
	return values.filter((value) => {
		const key = canonicalJson(value);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function containsPath(tree: string, candidate: string): boolean {
	return candidate === tree || candidate.startsWith(`${tree}/`);
}

function assertAcyclic(
	lanes: Array<{ lane_id: string; depends_on: string[] }>,
): void {
	const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) throw new Error("lane dependencies must be acyclic");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of byId.get(id)?.depends_on ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const lane of lanes) visit(lane.lane_id);
}

function isOrdered(
	left: string,
	right: string,
	lanes: Array<{ lane_id: string; depends_on: string[] }>,
): boolean {
	const byId = new Map(lanes.map((lane) => [lane.lane_id, lane.depends_on]));
	const reaches = (
		from: string,
		target: string,
		seen = new Set<string>(),
	): boolean => {
		if (from === target) return true;
		if (seen.has(from)) return false;
		seen.add(from);
		return (byId.get(from) ?? []).some((dependency) =>
			reaches(dependency, target, seen),
		);
	};
	return reaches(left, right) || reaches(right, left);
}

const REASON_ORDER: readonly ReadinessReasonCode[] = [
	"current_inputs_required",
	"git_unavailable",
	"ref_unresolvable",
	"git_output_limit_exceeded",
	"review_request_required",
	"review_changes_requested",
	"review_provider_unavailable",
	"reviewers_insufficient",
	"assessment_required",
	"assessment_changed",
	"delegation_required",
	"delegation_provider_unavailable",
	"explicit_user_choice_required",
];

function orderedUnique(
	values: readonly ReadinessReasonCode[],
): ReadinessReasonCode[] {
	const seen = new Set(values);
	return REASON_ORDER.filter((reason) => seen.has(reason));
}

function orderedUniqueObligations(
	values: RuntimeObligation[],
): RuntimeObligation[] {
	const seen = new Set<string>();
	return [...values]
		.sort((left, right) =>
			compareCodeUnits(canonicalJson(left), canonicalJson(right)),
		)
		.filter((value) => {
			const key = canonicalJson(value);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("canonical JSON rejects non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	throw new Error(`canonical JSON rejects ${typeof value}`);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
