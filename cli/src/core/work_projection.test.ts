import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../util/hash.js";
import {
	calculateWorkContractHash,
	calculateWorkDelegationContractHash,
	calculateWorkDelegationFailureFingerprint,
	type WorkContractDefinition,
	type WorkParallelLane,
} from "./work_contract.js";
import { appendWorkLedger, type WorkLedgerRecord } from "./work_ledger.js";
import { createWorkPolicySnapshot, resolveWorkPolicy } from "./work_policy.js";
import {
	calculateWorkProgress,
	foldWorkProjection,
	rebuildWorkProjection,
	writeWorkProjectionAtomic,
} from "./work_projection.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function temp(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-projection-"));
	roots.push(root);
	return root;
}

function records(
	events: Array<{ id: string; kind: string; payload: Record<string, unknown> }>,
): WorkLedgerRecord[] {
	let previous: string | null = null;
	return events.map((event, index) => {
		const record = {
			schema_version: "anamnesis.work-ledger.v1" as const,
			event_id: event.id,
			occurred_at: `2026-08-13T00:00:0${index}.000Z`,
			kind: event.kind,
			payload: event.payload,
			previous_hash: previous,
			record_hash: sha256(`record-${index}`),
		};
		previous = record.record_hash;
		return record;
	});
}

function executionFixture() {
	const policy = createWorkPolicySnapshot(
		1,
		resolveWorkPolicy([
			{
				kind: "project",
				source_refs: [{ source: "Agentfile", ref: "work_policy" }],
				config: {
					review: { preset: "strict" },
					delegation: {
						parallelism: "required",
						max_agents: 2,
						native_agents: "auto",
						tmux_team: "auto",
						fallback_order: ["tmux_team", "native_agents"],
						unavailable: "fallback",
					},
				},
			},
		]),
	);
	const definition: WorkContractDefinition = {
		work: {
			id: "wu_exec",
			title: "execution",
			completion_contract: "verified",
		},
		boundary: {
			state: "accepted",
			classification: "same_unit",
			reason_codes: ["same_completion_contract"],
			confidence: "high",
		},
		policy_snapshot: policy,
		requirements: [
			{ id: "req_a", summary: "a", source_event_ids: ["src_a"] },
			{ id: "req_b", summary: "b", source_event_ids: ["src_b"] },
		],
		open_conflicts: [],
	};
	const contractHash = calculateWorkContractHash(definition);
	const gate = policy.policy.review.gates.find(
		(item) => item.gate === "planning",
	)!;
	const artifactRefs = [{ ref: "plan", hash: sha256("plan") }];
	const lanes: WorkParallelLane[] = [
		{
			lane_id: "lane_a",
			requirement_ids: ["req_a"],
			repository_scopes: [{ kind: "tree", path: "cli/src/a", access: "write" }],
			external_effects: [],
			depends_on: [],
			verification_owner: "leader",
		},
		{
			lane_id: "lane_b",
			requirement_ids: ["req_b"],
			repository_scopes: [{ kind: "tree", path: "cli/src/b", access: "write" }],
			external_effects: [],
			depends_on: [],
			verification_owner: "leader",
		},
	];
	const basis = {
		work_id: "wu_exec",
		basis_contract_revision: 1,
		basis_contract_hash: contractHash,
		policy_hash: policy.policy_hash,
	};
	return { policy, definition, contractHash, gate, artifactRefs, lanes, basis };
}
describe("Work projection", () => {
	it("folds a source-bound waiver and moves it to stale evidence after reassessment", () => {
		const fixture = executionFixture();
		const firstHash = sha256("waiver-assessment-one");
		const base = [
			{
				id: "waiver_create",
				kind: "work_created",
				payload: {
					schema_version: "anamnesis.work-contract-event.v1",
					work_id: "wu_exec",
					contract_revision: 1,
					previous_contract_revision: null,
					previous_contract_hash: null,
					contract_hash: fixture.contractHash,
					contract: fixture.definition,
				},
			},
			{
				id: "waiver_assessment_one",
				kind: "work_parallelism_assessed",
				payload: {
					schema_version: "anamnesis.work-parallelism-assessment-event.v1",
					...fixture.basis,
					assessment_id: "waiver_assessment_one",
					assessment_input_hash: firstHash,
					decision: "parallel",
					lanes: fixture.lanes,
					selected_provider: "tmux_team",
					rationale_codes: ["parallel"],
					evidence_refs: ["assessment:evidence"],
				},
			},
			{
				id: "waiver_event",
				kind: "work_delegation_waived",
				payload: {
					schema_version: "anamnesis.work-delegation-waiver-event.v1",
					...fixture.basis,
					assessment_id: "waiver_assessment_one",
					assessment_input_hash: firstHash,
					reason: "operator approved",
					authority_ref: "user:operator",
					source_event_id: "source:waiver",
					evidence_refs: ["waiver:evidence"],
				},
			},
		];
		const waived = foldWorkProjection(records(base));
		expect(waived.parallelism).toMatchObject({
			recorded_state: "continue_solo",
			assessment_id: "waiver_assessment_one",
			evidence_event_ids: ["waiver_assessment_one", "waiver_event"],
		});
		const reassessed = foldWorkProjection(
			records([
				...base,
				{
					id: "waiver_assessment_two",
					kind: "work_parallelism_assessed",
					payload: {
						schema_version: "anamnesis.work-parallelism-assessment-event.v1",
						...fixture.basis,
						assessment_id: "waiver_assessment_two",
						assessment_input_hash: sha256("waiver-assessment-two"),
						decision: "parallel",
						lanes: fixture.lanes,
						selected_provider: "tmux_team",
						rationale_codes: ["material_scope_change"],
						evidence_refs: ["assessment:evidence:two"],
					},
				},
			]),
		);
		expect(reassessed.parallelism.recorded_state).toBe("assessed");
		expect(reassessed.parallelism.stale_evidence).toContainEqual({
			event_id: "waiver_event",
			input_hash: firstHash,
			reason: "superseded_assessment",
			failure_refs: [],
		});
	});
	it("dedupes exact reviewer pairs, distinguishes provider namespaces, and clears passes on changes", () => {
		const policy = createWorkPolicySnapshot(
			1,
			resolveWorkPolicy([
				{
					kind: "project",
					source_refs: [{ source: "Agentfile", ref: "review" }],
					config: {
						review: {
							preset: "custom",
							gates: [
								{
									gate: "planning",
									enforcement: "required",
									reviewer: {
										capability: "independent_agent",
										minimum_reviewers: 2,
									},
									provider_order: ["omx", "codex_native"],
									unavailable: "fail_closed",
								},
							],
							fallback_on: ["unsupported_authority"],
						},
					},
				},
			]),
		);
		const definition: WorkContractDefinition = {
			work: {
				id: "wu_reviewers",
				title: "reviewers",
				completion_contract: "done",
			},
			boundary: {
				state: "accepted",
				classification: "same_unit",
				reason_codes: ["same"],
				confidence: "high",
			},
			policy_snapshot: policy,
			requirements: [{ id: "req", summary: "req", source_event_ids: ["src"] }],
			open_conflicts: [],
		};
		const contractHash = calculateWorkContractHash(definition);
		const basis = {
			work_id: "wu_reviewers",
			basis_contract_revision: 1,
			basis_contract_hash: contractHash,
			policy_hash: policy.policy_hash,
		};
		const gate = policy.policy.review.gates.find(
			(item) => item.gate === "planning",
		)!;
		const inputHash = sha256("reviewers");
		const artifacts = [{ ref: "plan", hash: sha256("plan") }];
		const attempt = (
			id: string,
			provider: "omx" | "codex_native",
			outcome: "passed" | "changes_requested",
		) => ({
			id,
			kind: "work_review_attempt_recorded",
			payload: {
				schema_version: "anamnesis.work-review-attempt-event.v1",
				...basis,
				gate: "planning",
				activity_id: "activity",
				attempt_id: id,
				review_input_hash: inputHash,
				provider,
				role: gate.role_hint,
				outcome,
				reviewer_instance_ref: { provider, ref: "same-ref" },
				author_instance_refs: [{ provider: "separate_process", ref: "author" }],
				independence_assurance: "runtime_attested",
				independence_evidence_refs: [`independence:${id}`],
				artifact_refs: artifacts,
				finding_refs: [`finding:${id}`],
			},
		});
		const baseEvents = [
			{
				id: "create",
				kind: "work_created",
				payload: {
					schema_version: "anamnesis.work-contract-event.v1",
					work_id: "wu_reviewers",
					contract_revision: 1,
					previous_contract_revision: null,
					previous_contract_hash: null,
					contract_hash: contractHash,
					contract: definition,
				},
			},
			{
				id: "request",
				kind: "work_review_requested",
				payload: {
					schema_version: "anamnesis.work-review-request-event.v1",
					...basis,
					gate: "planning",
					activity_id: "activity",
					review_input_hash: inputHash,
					artifact_refs: artifacts,
					provider_order: gate.provider_order,
					role_hint: gate.role_hint,
					minimum_reviewers: gate.minimum_reviewers,
				},
			},
			attempt("pass_one", "omx", "passed"),
			attempt("pass_duplicate", "omx", "passed"),
			{
				id: "fallback",
				kind: "work_review_attempt_recorded",
				payload: {
					schema_version: "anamnesis.work-review-attempt-event.v1",
					...basis,
					gate: "planning",
					activity_id: "activity",
					attempt_id: "fallback",
					review_input_hash: inputHash,
					provider: "omx",
					role: gate.role_hint,
					outcome: "unsupported_authority",
					failure_input: { capability_ref: "cap" },
					failure_refs: ["failure:fallback"],
				},
			},
			attempt("pass_cross_provider", "codex_native", "passed"),
		];
		const passed = foldWorkProjection(records(baseEvents));
		const passedGate = passed.review_gates.find(
			(item) => item.gate === "planning",
		)!;
		expect(passedGate.state).toBe("passed");
		expect(passedGate.passing_reviewer_refs).toEqual([
			{ provider: "omx", ref: "same-ref" },
			{ provider: "codex_native", ref: "same-ref" },
		]);
		const changed = foldWorkProjection(
			records([
				...baseEvents,
				attempt("changes", "codex_native", "changes_requested"),
			]),
		);
		const changedGate = changed.review_gates.find(
			(item) => item.gate === "planning",
		)!;
		expect(changedGate.state).toBe("changes_requested");
		expect(changedGate.passing_reviewer_refs).toEqual([]);
	});
	it("replays durable review fallback and delegation evidence without changing progress", () => {
		const fixture = executionFixture();
		const reviewHash = sha256("review-input");
		const assessmentHash = sha256("assessment-input");
		const events: Array<{
			id: string;
			kind: string;
			payload: Record<string, unknown>;
		}> = [
			{
				id: "create_exec",
				kind: "work_created",
				payload: {
					schema_version: "anamnesis.work-contract-event.v1",
					work_id: "wu_exec",
					contract_revision: 1,
					previous_contract_revision: null,
					previous_contract_hash: null,
					contract_hash: fixture.contractHash,
					contract: fixture.definition,
				},
			},
			{
				id: "review_request",
				kind: "work_review_requested",
				payload: {
					schema_version: "anamnesis.work-review-request-event.v1",
					...fixture.basis,
					gate: "planning",
					activity_id: "review_activity",
					review_input_hash: reviewHash,
					artifact_refs: fixture.artifactRefs,
					provider_order: fixture.gate.provider_order,
					role_hint: fixture.gate.role_hint,
					minimum_reviewers: fixture.gate.minimum_reviewers,
				},
			},
			{
				id: "review_failure",
				kind: "work_review_attempt_recorded",
				payload: {
					schema_version: "anamnesis.work-review-attempt-event.v1",
					...fixture.basis,
					gate: "planning",
					activity_id: "review_activity",
					attempt_id: "attempt_omx",
					review_input_hash: reviewHash,
					provider: fixture.gate.provider_order[0],
					role: fixture.gate.role_hint,
					outcome: "unsupported_authority",
					failure_input: { capability_ref: "cap_review" },
					failure_refs: ["failure:omx"],
				},
			},
			{
				id: "review_pass",
				kind: "work_review_attempt_recorded",
				payload: {
					schema_version: "anamnesis.work-review-attempt-event.v1",
					...fixture.basis,
					gate: "planning",
					activity_id: "review_activity",
					attempt_id: "attempt_native",
					review_input_hash: reviewHash,
					provider: fixture.gate.provider_order[1],
					role: fixture.gate.role_hint,
					outcome: "passed",
					reviewer_instance_ref: {
						provider: fixture.gate.provider_order[1],
						ref: "reviewer",
					},
					author_instance_refs: [{ provider: "omx", ref: "author" }],
					independence_assurance: "runtime_attested",
					independence_evidence_refs: ["independence:1"],
					artifact_refs: fixture.artifactRefs,
					finding_refs: ["finding:pass"],
				},
			},
			{
				id: "review_request_repeat",
				kind: "work_review_requested",
				payload: {
					schema_version: "anamnesis.work-review-request-event.v1",
					...fixture.basis,
					gate: "planning",
					activity_id: "review_activity_repeat",
					review_input_hash: reviewHash,
					artifact_refs: fixture.artifactRefs,
					provider_order: fixture.gate.provider_order,
					role_hint: fixture.gate.role_hint,
					minimum_reviewers: fixture.gate.minimum_reviewers,
				},
			},
			{
				id: "assessment",
				kind: "work_parallelism_assessed",
				payload: {
					schema_version: "anamnesis.work-parallelism-assessment-event.v1",
					...fixture.basis,
					assessment_id: "assessment_1",
					assessment_input_hash: assessmentHash,
					decision: "parallel",
					lanes: fixture.lanes,
					selected_provider: "tmux_team",
					rationale_codes: ["two_disjoint_write_scopes"],
					evidence_refs: ["assessment:evidence"],
				},
			},
		];
		const failureDraft = {
			...fixture.basis,
			assessment_id: "assessment_1",
			assessment_input_hash: assessmentHash,
			provider: "tmux_team" as const,
			outcome: "unsupported_authority" as const,
			failure_input: { capability_ref: "cap_parallel", authority_ref: "lease" },
			failure_refs: ["failure:tmux"],
		};
		events.push({
			id: "delegation_failure",
			kind: "work_delegation_outcome_recorded",
			payload: {
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				...failureDraft,
				failure_fingerprint: calculateWorkDelegationFailureFingerprint(
					failureDraft,
					fixture.lanes,
				),
			},
		});
		const childContracts = fixture.lanes.map((lane) => ({
			lane_id: lane.lane_id,
			work_id: "wu_exec",
			basis_contract_revision: 1,
			requirement_ids: [...lane.requirement_ids],
			invariant_refs: ["invariant:1"],
			invariant_hash: sha256("invariant"),
			repository_scopes: [...lane.repository_scopes],
			external_effects: [...lane.external_effects],
			side_effect_exclusions: ["no_external_write"],
			expected_artifact_refs: ["artifact:child"],
			expected_evidence_refs: ["evidence:child"],
			source_pointers: ["docs/WORK-UNIT-DESIGN.md"],
		}));
		const delegatedDraft = {
			...fixture.basis,
			assessment_id: "assessment_1",
			assessment_input_hash: assessmentHash,
			provider: "native_agents" as const,
			child_contracts: childContracts,
		};
		const delegationContractHash =
			calculateWorkDelegationContractHash(delegatedDraft);
		events.push(
			{
				id: "delegated",
				kind: "work_delegation_outcome_recorded",
				payload: {
					schema_version: "anamnesis.work-delegation-outcome-event.v1",
					...delegatedDraft,
					outcome: "delegated",
					delegation_contract_hash: delegationContractHash,
				},
			},
			{
				id: "results",
				kind: "work_delegation_outcome_recorded",
				payload: {
					schema_version: "anamnesis.work-delegation-outcome-event.v1",
					...fixture.basis,
					assessment_id: "assessment_1",
					assessment_input_hash: assessmentHash,
					provider: "native_agents",
					outcome: "results_recorded",
					delegation_contract_hash: delegationContractHash,
					result_refs: ["result:one"],
				},
			},
		);
		const ledger = records(events);
		const projection = foldWorkProjection(ledger);
		const replay = foldWorkProjection(ledger);
		const gate = projection.review_gates.find(
			(item) => item.gate === "planning",
		)!;
		expect(replay).toEqual(projection);
		expect(gate).toMatchObject({
			state: "requested",
			recorded_input_hash: reviewHash,
			activity_id: "review_activity_repeat",
			next_provider: fixture.gate.provider_order[0],
			passing_reviewer_refs: [],
			finding_refs: [],
			failure_refs: [],
			evidence_event_ids: ["review_request_repeat"],
		});
		expect(gate.state).not.toBe("passed");
		expect(gate.stale_evidence).toEqual([
			{
				event_id: "review_request",
				input_hash: reviewHash,
				reason: "superseded_review_request",
				finding_refs: [],
				failure_refs: [],
			},
			{
				event_id: "review_failure",
				input_hash: reviewHash,
				reason: "superseded_review_request",
				finding_refs: [],
				failure_refs: ["failure:omx"],
			},
			{
				event_id: "review_pass",
				input_hash: reviewHash,
				reason: "superseded_review_request",
				finding_refs: ["finding:pass"],
				failure_refs: [],
			},
		]);
		expect(projection.parallelism).toMatchObject({
			recorded_state: "results_recorded",
			assessment_id: "assessment_1",
			selected_provider: "tmux_team",
			required_agents: 2,
			next_provider: null,
			failure_refs: ["failure:tmux"],
			evidence_event_ids: [
				"assessment",
				"delegation_failure",
				"delegated",
				"results",
			],
		});
		expect(projection.progress).toEqual(
			foldWorkProjection(ledger.slice(0, 1)).progress,
		);
		expect(projection).not.toHaveProperty("allowed");
		expect(projection).not.toHaveProperty("runtime_obligations");

		const revisedPolicy = createWorkPolicySnapshot(2, fixture.policy.policy);
		const revisedDefinition: WorkContractDefinition = {
			...fixture.definition,
			policy_snapshot: revisedPolicy,
			requirements: [
				...fixture.definition.requirements,
				{ id: "req_c", summary: "c", source_event_ids: ["src_c"] },
			],
		};
		const revisedHash = calculateWorkContractHash(revisedDefinition);
		const revised = foldWorkProjection(
			records([
				...events,
				{
					id: "contract_revision",
					kind: "work_contract_revised",
					payload: {
						schema_version: "anamnesis.work-contract-event.v1",
						work_id: "wu_exec",
						contract_revision: 2,
						previous_contract_revision: 1,
						previous_contract_hash: fixture.contractHash,
						contract_hash: revisedHash,
						contract: revisedDefinition,
					},
				},
			]),
		);
		const revisedGate = revised.review_gates.find(
			(item) => item.gate === "planning",
		)!;
		expect(revisedGate.state).toBe("pending");
		expect(
			revisedGate.stale_evidence.find(
				(item) => item.event_id === "review_failure",
			),
		).toMatchObject({ failure_refs: ["failure:omx"] });
		expect(
			revisedGate.stale_evidence.find(
				(item) => item.event_id === "review_pass",
			),
		).toMatchObject({ finding_refs: ["finding:pass"] });
		expect(revised.parallelism.recorded_state).toBe("off");
		expect(
			revised.parallelism.stale_evidence.find(
				(item) => item.event_id === "delegation_failure",
			),
		).toMatchObject({ failure_refs: ["failure:tmux"] });
	});
	it("restarts review routing on a new input and records provider exhaustion", () => {
		const fixture = executionFixture();
		const firstHash = sha256("review-first");
		const secondHash = sha256("review-second");
		const assessmentHash = sha256("assessment-exhausted");
		const reviewRequest = (id: string, inputHash: string) => ({
			id,
			kind: "work_review_requested",
			payload: {
				schema_version: "anamnesis.work-review-request-event.v1",
				...fixture.basis,
				gate: "planning",
				activity_id: id,
				review_input_hash: inputHash,
				artifact_refs: fixture.artifactRefs,
				provider_order: fixture.gate.provider_order,
				role_hint: fixture.gate.role_hint,
				minimum_reviewers: fixture.gate.minimum_reviewers,
			},
		});
		const reviewFailure = (
			id: string,
			inputHash: string,
			provider: "omx" | "codex_native" | "separate_process",
		) => ({
			id,
			kind: "work_review_attempt_recorded",
			payload: {
				schema_version: "anamnesis.work-review-attempt-event.v1",
				...fixture.basis,
				gate: "planning",
				activity_id: inputHash === firstHash ? "review_first" : "review_second",
				attempt_id: id,
				review_input_hash: inputHash,
				provider,
				role: fixture.gate.role_hint,
				outcome: "unsupported_authority",
				failure_input: { capability_ref: `cap:${provider}` },
				failure_refs: [`failure:${provider}`],
			},
		});
		const create = {
			id: "exhaustion_create",
			kind: "work_created",
			payload: {
				schema_version: "anamnesis.work-contract-event.v1",
				work_id: "wu_exec",
				contract_revision: 1,
				previous_contract_revision: null,
				previous_contract_hash: null,
				contract_hash: fixture.contractHash,
				contract: fixture.definition,
			},
		};
		const restarted = foldWorkProjection(
			records([
				create,
				reviewRequest("review_first", firstHash),
				reviewFailure("review_first_failure", firstHash, "omx"),
				reviewRequest("review_second", secondHash),
			]),
		);
		expect(
			restarted.review_gates.find((item) => item.gate === "planning"),
		).toMatchObject({
			state: "requested",
			recorded_input_hash: secondHash,
			next_provider: fixture.gate.provider_order[0],
		});

		const assessment = {
			id: "assessment_exhausted",
			kind: "work_parallelism_assessed",
			payload: {
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				...fixture.basis,
				assessment_id: "assessment_exhausted",
				assessment_input_hash: assessmentHash,
				decision: "parallel",
				lanes: fixture.lanes,
				selected_provider: "tmux_team",
				rationale_codes: ["parallel"],
				evidence_refs: ["assessment:evidence"],
			},
		};
		const delegationFailure = (
			id: string,
			provider: "tmux_team" | "native_agents",
		) => {
			const draft = {
				...fixture.basis,
				assessment_id: "assessment_exhausted",
				assessment_input_hash: assessmentHash,
				provider,
				outcome: "unsupported_authority" as const,
				failure_input: { capability_ref: `cap:${provider}` },
				failure_refs: [`failure:${provider}`],
			};
			return {
				id,
				kind: "work_delegation_outcome_recorded",
				payload: {
					schema_version: "anamnesis.work-delegation-outcome-event.v1",
					...draft,
					failure_fingerprint: calculateWorkDelegationFailureFingerprint(
						draft,
						fixture.lanes,
					),
				},
			};
		};
		const exhausted = foldWorkProjection(
			records([
				create,
				reviewRequest("review_second", secondHash),
				reviewFailure("review_omx_failed", secondHash, "omx"),
				reviewFailure("review_native_failed", secondHash, "codex_native"),
				reviewFailure("review_process_failed", secondHash, "separate_process"),
				assessment,
				delegationFailure("delegation_tmux_failed", "tmux_team"),
				delegationFailure("delegation_native_failed", "native_agents"),
			]),
		);
		expect(
			exhausted.review_gates.find((item) => item.gate === "planning"),
		).toMatchObject({ state: "blocked_unavailable", next_provider: null });
		expect(exhausted.parallelism).toMatchObject({
			recorded_state: "blocked_unavailable",
			next_provider: null,
		});
	});
	it("rejects execution evidence that contradicts an inactive policy", () => {
		const fixture = executionFixture();
		const policy = createWorkPolicySnapshot(1, resolveWorkPolicy([]));
		const definition: WorkContractDefinition = {
			...fixture.definition,
			policy_snapshot: policy,
		};
		const contractHash = calculateWorkContractHash(definition);
		const basis = {
			work_id: "wu_exec",
			basis_contract_revision: 1,
			basis_contract_hash: contractHash,
			policy_hash: policy.policy_hash,
		};
		const create = {
			id: "inactive_create",
			kind: "work_created",
			payload: {
				schema_version: "anamnesis.work-contract-event.v1",
				work_id: "wu_exec",
				contract_revision: 1,
				previous_contract_revision: null,
				previous_contract_hash: null,
				contract_hash: contractHash,
				contract: definition,
			},
		};
		const planning = policy.policy.review.gates.find(
			(item) => item.gate === "planning",
		)!;
		expect(() =>
			foldWorkProjection(
				records([
					create,
					{
						id: "inactive_review",
						kind: "work_review_requested",
						payload: {
							schema_version: "anamnesis.work-review-request-event.v1",
							...basis,
							gate: "planning",
							activity_id: "inactive_review",
							review_input_hash: sha256("inactive-review"),
							artifact_refs: fixture.artifactRefs,
							provider_order: planning.provider_order,
							role_hint: planning.role_hint,
							minimum_reviewers: planning.minimum_reviewers,
						},
					},
				]),
			),
		).toThrow(/inactive policy gate/);
		expect(() =>
			foldWorkProjection(
				records([
					create,
					{
						id: "inactive_parallelism",
						kind: "work_parallelism_assessed",
						payload: {
							schema_version: "anamnesis.work-parallelism-assessment-event.v1",
							...basis,
							assessment_id: "inactive_parallelism",
							assessment_input_hash: sha256("inactive-parallelism"),
							decision: "solo",
							lanes: fixture.lanes.slice(0, 1),
							selected_provider: null,
							rationale_codes: ["not_parallelizable"],
							evidence_refs: ["assessment:evidence"],
						},
					},
				]),
			),
		).toThrow(/policy mode off/);
	});
	it("rejects unsafe weighted sums", () => {
		expect(
			calculateWorkProgress([
				{
					id: "fraction",
					summary: "fraction",
					status: "verified",
					source_event_ids: [],
					evidence_refs: ["x"],
					weight: 0.5,
					updated_at: "x",
				},
			]).percent,
		).toBe(100);
		expect(() =>
			calculateWorkProgress([
				{
					id: "a",
					summary: "a",
					status: "verified",
					source_event_ids: [],
					evidence_refs: ["x"],
					weight: Number.MAX_SAFE_INTEGER,
					updated_at: "x",
				},
				{
					id: "b",
					summary: "b",
					status: "verified",
					source_event_ids: [],
					evidence_refs: ["x"],
					weight: 1,
					updated_at: "x",
				},
			]),
		).toThrow(/safe integer/);
	});

	it("rejects non-positive weights at the exported progress boundary", () => {
		for (const weight of [0, -1]) {
			expect(() =>
				calculateWorkProgress([
					{
						id: "bad_weight",
						summary: "bad",
						status: "pending",
						source_event_ids: ["src"],
						evidence_refs: [],
						weight,
						updated_at: "2026-08-13T00:00:00.000Z",
					},
				]),
			).toThrow(/finite and positive/);
		}
	});
	it("folds validated typed contract, policy, progress, and close readiness", () => {
		const definition: WorkContractDefinition = {
			work: { id: "wu_typed", title: "typed", completion_contract: "verified" },
			boundary: {
				state: "accepted",
				classification: "same_unit",
				reason_codes: ["same_completion_contract"],
				confidence: "high",
			},
			policy_snapshot: createWorkPolicySnapshot(
				1,
				resolveWorkPolicy([
					{
						kind: "project",
						source_refs: [{ source: "Agentfile", ref: "settings.work_policy" }],
						config: { review: { preset: "strict" } },
					},
				]),
			),
			requirements: [
				{ id: "req_typed", summary: "typed", source_event_ids: ["src_typed"] },
			],
			open_conflicts: [],
		};
		const contractHash = calculateWorkContractHash(definition);
		const projection = foldWorkProjection(
			records([
				{
					id: "lev_create",
					kind: "work_created",
					payload: {
						schema_version: "anamnesis.work-contract-event.v1",
						work_id: "wu_typed",
						contract_revision: 1,
						previous_contract_revision: null,
						previous_contract_hash: null,
						contract_hash: contractHash,
						contract: definition,
					},
				},
				{
					id: "lev_progress",
					kind: "work_requirement_transitioned",
					payload: {
						schema_version: "anamnesis.work-progress-event.v1",
						work_id: "wu_typed",
						requirement_id: "req_typed",
						basis_contract_hash: contractHash,
						status: "verified",
						evidence_refs: ["test:typed"],
					},
				},
			]),
		);
		expect(projection.contract_hash).toBe(contractHash);
		expect(projection.title).toBe("typed");
		expect(projection.completion_contract).toBe("verified");
		expect(projection.policy_snapshot?.policy_hash).toBe(
			projection.policy_hash,
		);
		expect(projection.configured_required_gates).toEqual([
			"planning",
			"completion",
		]);
		expect(projection.progress).toMatchObject({
			pending: 0,
			in_progress: 0,
			denominator_empty: false,
			percent: 100,
		});
		expect(projection.requirements_ready).toBe(true);
	});

	it.each([
		["provisional", false],
		["needs_user", false],
		["accepted", true],
	] as const)("requires an accepted typed boundary for close readiness: %s", (boundaryState, expected) => {
		const definition: WorkContractDefinition = {
			work: {
				id: `wu_${boundaryState}`,
				title: boundaryState,
				completion_contract: "verified",
			},
			boundary: {
				state: boundaryState,
				classification: "same_unit",
				reason_codes: ["same_completion_contract"],
				confidence: "high",
			},
			policy_snapshot: createWorkPolicySnapshot(1, resolveWorkPolicy([])),
			requirements: [
				{
					id: "req_boundary",
					summary: "boundary",
					source_event_ids: ["src_boundary"],
				},
			],
			open_conflicts: [],
		};
		const contractHash = calculateWorkContractHash(definition);
		const projection = foldWorkProjection(
			records([
				{
					id: "lev_create",
					kind: "work_created",
					payload: {
						schema_version: "anamnesis.work-contract-event.v1",
						work_id: definition.work.id,
						contract_revision: 1,
						previous_contract_revision: null,
						previous_contract_hash: null,
						contract_hash: contractHash,
						contract: definition,
					},
				},
				{
					id: "lev_progress",
					kind: "work_requirement_transitioned",
					payload: {
						schema_version: "anamnesis.work-progress-event.v1",
						work_id: definition.work.id,
						requirement_id: "req_boundary",
						basis_contract_hash: contractHash,
						status: "verified",
						evidence_refs: ["test:boundary"],
					},
				},
			]),
		);

		expect(projection.requirements_ready).toBe(expected);
	});

	it("folds committed records deterministically with reproducible progress", () => {
		const input = records([
			{
				id: "lev_1",
				kind: "work_created",
				payload: { work_id: "wu_one", contract_revision: 1 },
			},
			{
				id: "lev_2",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "preserve exact prompt",
					source_event_ids: ["evt_1"],
				},
			},
			{
				id: "lev_3",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_2",
					summary: "verify projection",
					source_event_ids: ["evt_2"],
				},
			},
			{
				id: "lev_4",
				kind: "requirement_status_changed",
				payload: {
					requirement_id: "req_1",
					status: "verified",
					evidence_refs: ["test:one"],
				},
			},
			{
				id: "lev_5",
				kind: "requirement_status_changed",
				payload: { requirement_id: "req_2", status: "implemented_unverified" },
			},
		]);
		const first = foldWorkProjection(input);
		const second = foldWorkProjection(structuredClone(input));
		expect(second).toEqual(first);
		expect(first.progress).toEqual({
			applicable: 2,
			pending: 0,
			in_progress: 0,
			verified: 1,
			implemented_unverified: 1,
			blocked: 0,
			waived: 0,
			percent: 50,
			weighted: false,
			denominator_empty: false,
		});
		expect(first.title).toBeNull();
		expect(first.completion_contract).toBeNull();
		expect(first.ledger_head).toBe(input.at(-1)?.record_hash);
		expect(first.last_event_id).toBe("lev_5");
	});

	it("deduplicates requirement provenance without renumbering 100 earlier requirements", () => {
		const events = [
			{ id: "lev_0", kind: "work_created", payload: { work_id: "wu_long" } },
			...Array.from({ length: 100 }, (_, index) => ({
				id: `lev_${index + 1}`,
				kind: "requirement_added",
				payload: {
					requirement_id: `req_${index + 1}`,
					summary: `requirement ${index + 1}`,
					source_event_ids: [`evt_${index + 1}`],
				},
			})),
			{
				id: "lev_101",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "duplicate wording ignored",
					source_event_ids: ["evt_101"],
				},
			},
			{
				id: "lev_102",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_101",
					summary: "later requirement",
					source_event_ids: ["evt_102"],
				},
			},
		];
		const projection = foldWorkProjection(records(events));
		expect(projection.requirements).toHaveLength(101);
		expect(projection.requirements[0]).toMatchObject({
			id: "req_1",
			summary: "requirement 1",
			source_event_ids: ["evt_1", "evt_101"],
		});
		expect(projection.requirements[99]?.id).toBe("req_100");
		expect(projection.requirements[100]?.id).toBe("req_101");
	});

	it("excludes waived requirements and uses weights only when all are explicit", () => {
		const progress = calculateWorkProgress([
			{
				id: "a",
				summary: "a",
				status: "verified",
				source_event_ids: [],
				evidence_refs: [],
				weight: 1,
				updated_at: "x",
			},
			{
				id: "b",
				summary: "b",
				status: "blocked",
				source_event_ids: [],
				evidence_refs: [],
				weight: 3,
				updated_at: "x",
			},
			{
				id: "c",
				summary: "c",
				status: "waived",
				source_event_ids: [],
				evidence_refs: [],
				weight: 10,
				updated_at: "x",
			},
		]);
		expect(progress).toMatchObject({
			applicable: 2,
			verified: 1,
			blocked: 1,
			waived: 1,
			weighted: true,
			applicable_weight: 4,
			verified_weight: 1,
			percent: 25,
		});
	});

	it("fails closed instead of silently truncating bounded projections", () => {
		const input = records([
			{ id: "lev_0", kind: "work_created", payload: { work_id: "wu_one" } },
			{
				id: "lev_1",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "one",
					source_event_ids: ["evt_1"],
				},
			},
			{
				id: "lev_2",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_2",
					summary: "two",
					source_event_ids: ["evt_2"],
				},
			},
		]);
		expect(() => foldWorkProjection(input, { maxRequirements: 1 })).toThrow(
			/limit exceeded/,
		);
	});

	it("rebuilds only from a validated newline-committed ledger", () => {
		const root = temp();
		const ledgerPath = path.join(root, "ledger.jsonl");
		const projectionPath = path.join(root, "projection.yaml");
		let head: string | null = null;
		for (const event of [
			{
				event_id: "lev_1",
				occurred_at: "2026-08-13T00:00:00Z",
				kind: "work_created",
				payload: { work_id: "wu_one" },
			},
			{
				event_id: "lev_2",
				occurred_at: "2026-08-13T00:00:01Z",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "committed",
					status: "waived",
				},
			},
		]) {
			head = appendWorkLedger({
				ledgerPath,
				event,
				expectedHead: head,
			}).head;
		}
		const projection = rebuildWorkProjection(ledgerPath, projectionPath);
		expect(projection.ledger_head).toBe(head);
		expect(fs.statSync(projectionPath).mode & 0o777).toBe(0o600);
		expect(fs.readFileSync(projectionPath, "utf8")).toContain(
			"summary: committed",
		);

		fs.appendFileSync(ledgerPath, '{"uncommitted":');
		expect(() => rebuildWorkProjection(ledgerPath, projectionPath)).toThrow(
			/uncommitted/,
		);
		expect(fs.readFileSync(projectionPath, "utf8")).toContain(
			"summary: committed",
		);
	});

	it("holds the ledger writer lock through projection publication", () => {
		const root = temp();
		const ledgerPath = path.join(root, "ledger.jsonl");
		const projectionPath = path.join(root, "projection.yaml");
		const first = appendWorkLedger({
			ledgerPath,
			event: {
				event_id: "lev_1",
				occurred_at: "2026-08-13T00:00:00Z",
				kind: "work_created",
				payload: { work_id: "wu_one" },
			},
			expectedHead: null,
		});
		let concurrentError = "";
		const projection = rebuildWorkProjection(
			ledgerPath,
			projectionPath,
			{},
			{
				onProjectionFolded: () => {
					try {
						appendWorkLedger({
							ledgerPath,
							event: {
								event_id: "lev_2",
								occurred_at: "2026-08-13T00:00:01Z",
								kind: "contract_revised",
								payload: { work_id: "wu_one", contract_revision: 2 },
							},
							expectedHead: first.head,
							lockTimeoutMs: 1,
							lockRetryMs: 1,
						});
					} catch (error) {
						concurrentError = (error as Error).message;
					}
				},
			},
		);
		expect(concurrentError).toContain("timed out acquiring work ledger lock");
		expect(projection.ledger_head).toBe(first.head);
		expect(fs.readFileSync(projectionPath, "utf8")).toContain(first.head);
	});

	it("requires exactly one explicit creation before semantic events", () => {
		expect(() =>
			foldWorkProjection(
				records([
					{
						id: "lev_1",
						kind: "requirement_added",
						payload: {
							work_id: "wu_fake",
							requirement_id: "req_1",
							summary: "too early",
							source_event_ids: ["evt_1"],
						},
					},
				]),
			),
		).toThrow(/precedes work_created/);

		expect(() =>
			foldWorkProjection(
				records([
					{
						id: "lev_0",
						kind: "future_event",
						payload: { work_id: "wu_fake" },
					},
				]),
			),
		).toThrow(/requires a committed work_created/);

		expect(() =>
			foldWorkProjection(
				records([
					{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
					{ id: "lev_2", kind: "work_created", payload: { work_id: "wu_two" } },
				]),
			),
		).toThrow(/repeated work_created/);
	});

	it("validates bounds and active requirement provenance", () => {
		const created = records([
			{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
		]);
		for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() =>
				foldWorkProjection(created, { maxRecords: invalid }),
			).toThrow(/positive safe integer/);
		}
		expect(() =>
			foldWorkProjection(
				records([
					{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
					{
						id: "lev_2",
						kind: "requirement_added",
						payload: { requirement_id: "req_1", summary: "unprovenanced" },
					},
				]),
			),
		).toThrow(/requires source_event_ids provenance/);
	});

	it("rejects projection directory and final-path symlinks", () => {
		const root = temp();
		const elsewhere = temp();
		const unit = path.join(root, "unit");
		fs.symlinkSync(elsewhere, unit, "dir");
		const projection = foldWorkProjection(
			records([
				{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
			]),
		);
		expect(() =>
			writeWorkProjectionAtomic(path.join(unit, "projection.yaml"), projection),
		).toThrow(/symbolic link/);

		fs.unlinkSync(unit);
		fs.mkdirSync(unit);
		const target = path.join(unit, "projection.yaml");
		fs.symlinkSync(path.join(elsewhere, "escaped.yaml"), target);
		expect(() => writeWorkProjectionAtomic(target, projection)).toThrow(
			/symbolic link/,
		);
	});

	it("rejects a symlink in a lexical projection ancestor without touching the victim", () => {
		const root = temp();
		const victim = temp();
		const linked = path.join(root, "linked");
		fs.symlinkSync(victim, linked, "dir");
		const projection = foldWorkProjection(
			records([
				{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
			]),
		);
		expect(() =>
			writeWorkProjectionAtomic(
				path.join(linked, "nested", "projection.yaml"),
				projection,
			),
		).toThrow(/symbolic link/);
		expect(fs.readdirSync(victim)).toHaveLength(0);
	});
});
