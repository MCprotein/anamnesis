import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { readWorkLedger } from "../core/work_ledger.js";

import {
	amendWork,
	assertProgressRetryIsAppendCompatible,
	assessWorkDelegation,
	briefWork,
	confirmWorkBrief,
	createWork,
	publicWorkExecutionMutation,
	readinessWork,
	recordWorkDelegation,
	requestWorkReview,
	statusWork,
	switchWork,
	transitionWork,
	type WorkMutationInput,
	waiveWorkDelegation,
} from "./work.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const value = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-work-command-"),
	);
	roots.push(value);
	return value;
}

function contractDraft(
	sourceEventId: string,
	additions: string[] = [],
	classification: "new_unit" | "same_unit" | "interruption" = "new_unit",
): Buffer {
	return Buffer.from(
		YAML.stringify({
			work: {
				title: "한국어 🚀 Work",
				completion_contract: "All requirements verified",
			},
			boundary: {
				state: "accepted",
				classification,
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: [
				{
					id: "req_a",
					summary: "Preserve raw prompt",
					source_event_ids: ["src_create"],
				},
				...additions.map((id) => ({
					id,
					summary: id,
					source_event_ids: [sourceEventId],
				})),
			],
			open_conflicts: [],
		}),
	);
}

function mutation(
	projectRoot: string,
	overrides: Partial<WorkMutationInput> = {},
): WorkMutationInput {
	const ledgerPath = path.join(
		projectRoot,
		".anamnesis/work-units/wu_one/ledger.jsonl",
	);
	return {
		project_root: projectRoot,
		work_id: "wu_one",
		event_id: "evt_create",
		occurred_at: "2026-08-13T00:00:00.000Z",
		draft: contractDraft("src_create"),
		expected_head: fs.existsSync(ledgerPath)
			? readWorkLedger(ledgerPath).head
			: null,
		source_stdin: {
			event_id: "src_create",
			captured_at: "2026-08-13T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact",
			allocation_status: "allocated",
			body: Buffer.from("첫 줄\r\n둘째 줄 🚀\r\n", "utf8"),
		},
		...overrides,
	};
}

describe("Work command service", () => {
	it("returns bounded review contracts, slices action inputs, and preserves exact retry CAS", () => {
		const projectRoot = root();
		fs.writeFileSync(
			path.join(projectRoot, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "strict-review-command" },
				tools: ["codex"],
				fragments: [],
				settings: { work_policy: { review: { preset: "strict" } } },
			}),
		);
		const created = createWork(mutation(projectRoot));
		const executionInputs = {
			planning_review_inputs: {
				artifacts: [
					{
						kind: "runtime_attested_inline" as const,
						ref: "plan:one",
						content: "bounded plan",
						assurance: "runtime_attested" as const,
					},
				],
			},
			completion_review_inputs: {
				base_ref: "missing-base",
				head_ref: "missing-head",
				verification_assertions: [],
				evidence_refs: [],
			},
		};
		const draft = Buffer.from(
			YAML.stringify({ execution_inputs: executionInputs }),
		);
		const first = requestWorkReview({
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "review_request_one",
			occurred_at: "2026-08-13T00:10:00.000Z",
			expected_head: created.projection.ledger_head!,
			draft,
			gate: "planning",
			activity_id: "activity_one",
		});
		const publicResult = publicWorkExecutionMutation(first);
		expect(publicResult.execution_contract).toMatchObject({
			kind: "review_request",
			gate: "planning",
			capability: "independent_agent",
			blocking: true,
		});
		expect(publicResult).not.toHaveProperty("projection");

		requestWorkReview({
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "review_request_two",
			occurred_at: "2026-08-13T00:11:00.000Z",
			expected_head: first.projection.ledger_head!,
			draft,
			gate: "planning",
			activity_id: "activity_two",
		});
		expect(
			requestWorkReview({
				project_root: projectRoot,
				work_id: "wu_one",
				event_id: "review_request_one",
				occurred_at: "2026-08-13T00:10:00.000Z",
				expected_head: created.projection.ledger_head!,
				draft,
				gate: "planning",
				activity_id: "activity_one",
			}).projection.ledger_head,
		).toBe(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).projection
				.ledger_head,
		);

		const readiness = readinessWork({
			project_root: projectRoot,
			work_id: "wu_one",
			action: "implementation_entry",
			execution_inputs: {
				completion_review_inputs: executionInputs.completion_review_inputs,
			},
		});
		expect(readiness).toMatchObject({
			allowed: false,
			input_status: {
				planning_review: "missing",
				completion_review: "not_required",
			},
		});
		expect(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).readiness,
		).toBe("current_inputs_required");
		const headBeforeReadiness = readWorkLedger(
			path.join(projectRoot, ".anamnesis/work-units/wu_one/ledger.jsonl"),
		).head;
		fs.writeFileSync(path.join(projectRoot, "Agentfile"), "not: [valid");
		expect(
			readinessWork({
				project_root: projectRoot,
				work_id: "wu_one",
				action: "implementation_entry",
				execution_inputs: {
					completion_review_inputs: executionInputs.completion_review_inputs,
				},
			}),
		).toEqual(readiness);
		expect(
			readWorkLedger(
				path.join(projectRoot, ".anamnesis/work-units/wu_one/ledger.jsonl"),
			).head,
		).toBe(headBeforeReadiness);
	});

	it("records delegation fallback and binds a source-authorized waiver", () => {
		const projectRoot = root();
		fs.writeFileSync(
			path.join(projectRoot, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "delegation-command" },
				tools: ["codex"],
				fragments: [],
				settings: {
					work_policy: {
						delegation: {
							parallelism: "required",
							fallback_order: ["native_agents", "tmux_team"],
						},
					},
				},
			}),
		);
		const created = createWork(mutation(projectRoot));
		const parallelismInputs = {
			parallelism_inputs: {
				material_scope: {
					repository_scopes: [
						{ kind: "repo" as const, access: "read" as const },
					],
					external_effects: [],
				},
				runtime_capability: {
					assurance: "runtime_attested" as const,
					capability_ref: "capability:one",
					providers: [
						{
							provider: "native_agents" as const,
							availability: "available" as const,
							max_agents: 2,
						},
						{
							provider: "tmux_team" as const,
							availability: "available" as const,
							max_agents: 2,
						},
					],
				},
			},
		};
		const lanes = ["a", "b"].map((id) => ({
			lane_id: `lane_${id}`,
			requirement_ids: ["req_a"],
			repository_scopes: [
				{
					kind: "file" as const,
					path: `lane/${id}.ts`,
					access: "write" as const,
				},
			],
			external_effects: [],
			depends_on: [],
			verification_owner: "leader" as const,
		}));
		const assessmentBase = {
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "assessment_invalid",
			occurred_at: "2026-08-13T00:19:00.000Z",
			expected_head: created.projection.ledger_head!,
		};
		expect(() =>
			assessWorkDelegation({
				...assessmentBase,
				draft: Buffer.from(
					YAML.stringify({
						execution_inputs: parallelismInputs,
						assessment_id: "assessment_capacity_mismatch",
						decision: "parallel",
						lanes,
						selected_provider: "tmux_team",
						rationale_codes: ["two_disjoint_write_scopes"],
						evidence_refs: ["plan:parallel"],
					}),
				),
			}),
		).toThrow(/runtime capacity/);
		expect(() =>
			assessWorkDelegation({
				...assessmentBase,
				event_id: "assessment_bad_rationale",
				draft: Buffer.from(
					YAML.stringify({
						execution_inputs: parallelismInputs,
						assessment_id: "assessment_bad_rationale",
						decision: "not_parallelizable",
						lanes: [lanes[0]],
						selected_provider: null,
						rationale_codes: ["because_i_said_so"],
						evidence_refs: ["plan:parallel"],
					}),
				),
			}),
		).toThrow(/allowed indivisibility rationale/);
		const assessed = assessWorkDelegation({
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "assessment_one",
			occurred_at: "2026-08-13T00:20:00.000Z",
			expected_head: created.projection.ledger_head!,
			draft: Buffer.from(
				YAML.stringify({
					execution_inputs: parallelismInputs,
					assessment_id: "assessment_one",
					decision: "parallel",
					lanes,
					selected_provider: "native_agents",
					rationale_codes: ["two_disjoint_write_scopes"],
					evidence_refs: ["plan:parallel"],
				}),
			),
		});
		expect(assessed.execution_contract).toMatchObject({
			kind: "delegation_assessment",
			state: "assessed",
			next_provider: "native_agents",
		});
		expect(() =>
			assessWorkDelegation({
				project_root: projectRoot,
				work_id: "wu_one",
				event_id: "assessment_duplicate_input",
				occurred_at: "2026-08-13T00:20:30.000Z",
				expected_head: assessed.projection.ledger_head!,
				draft: Buffer.from(
					YAML.stringify({
						execution_inputs: parallelismInputs,
						assessment_id: "assessment_duplicate_input",
						decision: "parallel",
						lanes,
						selected_provider: "native_agents",
						rationale_codes: ["two_disjoint_write_scopes"],
						evidence_refs: ["plan:parallel"],
					}),
				),
			}),
		).toThrow(/changed canonical input hash/);
		const failed = recordWorkDelegation({
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "delegation_failure",
			occurred_at: "2026-08-13T00:21:00.000Z",
			expected_head: assessed.projection.ledger_head!,
			draft: Buffer.from(
				YAML.stringify({
					assessment_id: "assessment_one",
					provider: "native_agents",
					outcome: "authorization_error",
					failure_input: {
						capability_ref: "capability:one",
						authority_ref: "authority:denied",
					},
					failure_refs: ["failure:authorization"],
				}),
			),
		});
		expect(failed.execution_contract).toMatchObject({
			kind: "delegation_record",
			next_provider: "tmux_team",
		});
		const waiverInput = {
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "delegation_waiver",
			occurred_at: "2026-08-13T00:22:00.000Z",
			expected_head: failed.projection.ledger_head!,
			draft: Buffer.from(
				YAML.stringify({
					assessment_id: "assessment_one",
					reason: "operator chose bounded solo continuation",
					authority_ref: "user:owner",
					evidence_refs: ["decision:user"],
				}),
			),
			source_stdin: {
				event_id: "source_waiver",
				captured_at: "2026-08-13T00:22:00.000Z",
				client: "codex",
				content_type: "text/plain; charset=utf-8",
				fidelity: "native_exact" as const,
				allocation_status: "allocated" as const,
				body: Buffer.from("user explicitly authorizes solo"),
			},
		};
		const waived = waiveWorkDelegation(waiverInput);
		expect(waived.execution_contract).toMatchObject({
			kind: "delegation_waiver",
			state: "continue_solo",
		});
		expect(() =>
			waiveWorkDelegation({
				...waiverInput,
				source_stdin: {
					...waiverInput.source_stdin,
					body: Buffer.from("changed authority body"),
				},
			}),
		).toThrow("source event ID collision");
	});

	it("returns the authoritative delegation hash for the results chain", () => {
		const projectRoot = root();
		fs.writeFileSync(
			path.join(projectRoot, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "delegation-chain" },
				tools: ["codex"],
				fragments: [],
				settings: {
					work_policy: { delegation: { parallelism: "required" } },
				},
			}),
		);
		const created = createWork(mutation(projectRoot));
		const lanes = ["a", "b"].map((id) => ({
			lane_id: `lane_${id}`,
			requirement_ids: ["req_a"],
			repository_scopes: [
				{
					kind: "file" as const,
					path: `lane/${id}.ts`,
					access: "write" as const,
				},
			],
			external_effects: [],
			depends_on: [],
			verification_owner: "leader" as const,
		}));
		const assessed = assessWorkDelegation({
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "assessment_chain",
			occurred_at: "2026-08-13T01:00:00.000Z",
			expected_head: created.projection.ledger_head!,
			draft: Buffer.from(
				YAML.stringify({
					execution_inputs: {
						parallelism_inputs: {
							material_scope: {
								repository_scopes: [{ kind: "repo", access: "read" }],
								external_effects: [],
							},
							runtime_capability: {
								assurance: "runtime_attested",
								capability_ref: "capability:chain",
								providers: [
									{
										provider: "native_agents",
										availability: "available",
										max_agents: 2,
									},
								],
							},
						},
					},
					assessment_id: "assessment_chain",
					decision: "parallel",
					lanes,
					selected_provider: "native_agents",
					rationale_codes: ["disjoint_scopes"],
					evidence_refs: ["plan:chain"],
				}),
			),
		});
		const childContracts = lanes.map((lane) => ({
			lane_id: lane.lane_id,
			work_id: "wu_one",
			basis_contract_revision: 1,
			requirement_ids: lane.requirement_ids,
			invariant_refs: ["invariant:none"],
			invariant_hash: `sha256:${"a".repeat(64)}`,
			repository_scopes: lane.repository_scopes,
			external_effects: [],
			side_effect_exclusions: ["no_external_writes"],
			expected_artifact_refs: [`artifact:${lane.lane_id}`],
			expected_evidence_refs: [`evidence:${lane.lane_id}`],
			source_pointers: ["source:req_a"],
		}));
		const delegated = recordWorkDelegation({
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "delegated_chain",
			occurred_at: "2026-08-13T01:01:00.000Z",
			expected_head: assessed.projection.ledger_head!,
			draft: Buffer.from(
				YAML.stringify({
					assessment_id: "assessment_chain",
					provider: "native_agents",
					outcome: "delegated",
					child_contracts: childContracts,
				}),
			),
		});
		const contract = delegated.execution_contract;
		expect(contract?.kind).toBe("delegation_record");
		if (contract?.kind !== "delegation_record") throw new Error("contract");
		expect(contract.delegation_contract_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

		const results = recordWorkDelegation({
			project_root: projectRoot,
			work_id: "wu_one",
			event_id: "results_chain",
			occurred_at: "2026-08-13T01:02:00.000Z",
			expected_head: delegated.projection.ledger_head!,
			draft: Buffer.from(
				YAML.stringify({
					assessment_id: "assessment_chain",
					provider: "native_agents",
					outcome: "results_recorded",
					delegation_contract_hash: contract.delegation_contract_hash,
					result_refs: ["result:lane_a", "result:lane_b"],
				}),
			),
		});
		expect(results.execution_contract).toEqual({
			kind: "delegation_record",
			assessment_id: "assessment_chain",
			outcome: "results_recorded",
			provider: "native_agents",
			state: "results_recorded",
			next_provider: null,
			delegation_contract_hash: contract.delegation_contract_hash,
			result_refs: ["result:lane_a", "result:lane_b"],
		});
		expect(() =>
			waiveWorkDelegation({
				project_root: projectRoot,
				work_id: "wu_one",
				event_id: "late_chain_waiver",
				occurred_at: "2026-08-13T01:03:00.000Z",
				expected_head: results.projection.ledger_head!,
				draft: Buffer.from(
					YAML.stringify({
						assessment_id: "assessment_chain",
						reason: "too late",
						authority_ref: "user:owner",
						evidence_refs: ["decision:late"],
					}),
				),
				source_stdin: {
					event_id: "source_late_chain_waiver",
					captured_at: "2026-08-13T01:03:00.000Z",
					client: "codex",
					content_type: "text/plain; charset=utf-8",
					fidelity: "native_exact",
					allocation_status: "allocated",
					body: Buffer.from("late waiver"),
				},
			}),
		).toThrow(/cannot overwrite delegated or completed evidence/);
	});

	it("creates with byte-exact raw source and the default all-off policy", () => {
		const projectRoot = root();
		fs.writeFileSync(
			path.join(projectRoot, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "work-command-test" },
				tools: ["codex"],
				fragments: [],
				settings: {
					work_policy: {
						reconciliation: { preset: "off" },
						review: { preset: "off" },
						delegation: { parallelism: "off" },
					},
				},
			}),
		);
		const input = mutation(projectRoot);
		const result = createWork(input);
		expect(result.schema_version).toBe("anamnesis.work-command-result.v1");
		expect(result.projection.contract_revision).toBe(1);
		expect(result.projection.policy_snapshot?.policy.review.preset).toBe("off");
		expect(
			result.projection.policy_snapshot?.policy.delegation.parallelism,
		).toBe("off");
		expect(
			fs.readFileSync(
				path.join(projectRoot, ".anamnesis/work-inputs/objects/src_create.txt"),
			),
		).toEqual(input.source_stdin?.body);
	});

	it("amends the same Work and reports transition progress from a validated refold", () => {
		const projectRoot = root();
		createWork(mutation(projectRoot));
		const amended = amendWork(
			mutation(projectRoot, {
				event_id: "evt_amend",
				occurred_at: "2026-08-13T00:01:00.000Z",
				draft: contractDraft("src_amend", ["req_b"], "same_unit"),
				source_stdin: {
					...mutation(projectRoot).source_stdin!,
					event_id: "src_amend",
					body: Buffer.from("추가 요구사항", "utf8"),
				},
			}),
		);
		expect(amended.work_id).toBe("wu_one");
		expect(amended.projection.contract_revision).toBe(2);

		transitionWork(
			mutation(projectRoot, {
				event_id: "evt_verify",
				occurred_at: "2026-08-13T00:02:00.000Z",
				draft: Buffer.from(
					YAML.stringify({
						requirement_id: "req_a",
						status: "verified",
						evidence_refs: ["test:raw"],
					}),
				),
				source_stdin: undefined,
			}),
		);
		const status = statusWork({ project_root: projectRoot, work_id: "wu_one" });
		expect(status).not.toHaveProperty("readiness");
		expect(status.projection.progress).toMatchObject({
			verified: 1,
			applicable: 2,
			percent: 50,
		});
		const brief = briefWork({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_brief",
			client_session_ref: "session-a",
			occurred_at: "2026-08-13T00:03:00.000Z",
		});
		expect(brief.sections.map((section) => section.id)).toEqual([
			"work",
			"requirements",
			"done",
			"remaining",
			"blockers",
			"progress",
			"next",
		]);
		expect(brief.delivery_state).toBe("pending");
		expect(brief.sections[1]?.values[0]).toBe(
			"req_a: Preserve raw prompt [verified]",
		);
		expect(
			confirmWorkBrief({
				project_root: projectRoot,
				work_id: "wu_one",
				cursor_id: "cursor_brief",
				delivery_token: brief.delivery_token,
				confirmed_at: "2026-08-13T00:03:01.000Z",
			}).schema_version,
		).toBe("anamnesis.work-brief-confirmation.v1");
		expect(() =>
			confirmWorkBrief({
				project_root: projectRoot,
				work_id: "wu_one",
				cursor_id: "cursor_brief",
				delivery_token: "wrong",
				confirmed_at: "2026-08-13T00:03:02.000Z",
			}),
		).toThrow("token mismatch");
	});

	it("retries an already committed event idempotently", () => {
		const projectRoot = root();
		const input = mutation(projectRoot);
		createWork(input);
		const retried = createWork(input);
		expect(retried.allocation.ledger.idempotent).toBe(true);
		expect(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).projection
				.contract_revision,
		).toBe(1);
	});

	it("rejects an event-id retry when the draft changed", () => {
		const projectRoot = root();
		const input = mutation(projectRoot);
		createWork(input);
		expect(() =>
			createWork({
				...input,
				draft: Buffer.from(
					input.draft
						.toString("utf8")
						.replace("Preserve raw prompt", "Silently changed requirement"),
				),
			}),
		).toThrow("event ID collision");
		expect(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).projection
				.requirements[0]?.summary,
		).toBe("Preserve raw prompt");
		expect(() =>
			createWork({
				...input,
				draft: contractDraft("src_collision", ["req_collision"]),
				source_stdin: {
					...input.source_stdin!,
					event_id: "src_collision",
					body: Buffer.from("must not be orphaned"),
				},
			}),
		).toThrow("event ID collision");
		expect(
			fs.existsSync(
				path.join(
					projectRoot,
					".anamnesis/work-inputs/objects/src_collision.txt",
				),
			),
		).toBe(false);
	});

	it("enforces create/new_unit and amend/same_unit boundaries", () => {
		const projectRoot = root();
		expect(() =>
			createWork({
				...mutation(projectRoot),
				draft: contractDraft("src_create", [], "same_unit"),
			}),
		).toThrow("create requires boundary.classification=new_unit");
		const needsUser = YAML.parse(contractDraft("src_create").toString("utf8"));
		needsUser.boundary.state = "needs_user";
		needsUser.boundary.confidence = "low";
		expect(() =>
			createWork({
				...mutation(projectRoot),
				draft: Buffer.from(YAML.stringify(needsUser)),
			}),
		).toThrow("create requires boundary.state=accepted");
		createWork(mutation(projectRoot));
		expect(() =>
			amendWork(
				mutation(projectRoot, {
					event_id: "evt_bad_boundary",
					source_stdin: {
						...mutation(projectRoot).source_stdin!,
						event_id: "src_bad_boundary",
					},
					draft: contractDraft("src_bad_boundary", ["req_b"], "new_unit"),
				}),
			),
		).toThrow("amend requires boundary.classification=same_unit");
	});

	it("preserves the frozen Work policy and reports later project drift", () => {
		const projectRoot = root();
		const writePolicy = (preset: "strict" | "off") =>
			fs.writeFileSync(
				path.join(projectRoot, "Agentfile"),
				YAML.stringify({
					version: 2,
					project: { name: "policy-drift" },
					tools: ["codex"],
					fragments: [],
					settings: { work_policy: { review: { preset } } },
				}),
			);
		writePolicy("strict");
		createWork(mutation(projectRoot));
		writePolicy("off");
		expect(
			createWork(mutation(projectRoot, { expected_head: null })).allocation
				?.ledger.idempotent,
		).toBe(true);
		const amendInput = mutation(projectRoot, {
			event_id: "evt_policy_drift",
			draft: contractDraft("src_policy_drift", ["req_b"], "same_unit"),
			source_stdin: {
				...mutation(projectRoot).source_stdin!,
				event_id: "src_policy_drift",
			},
		});
		const amended = amendWork(amendInput);
		expect(amended.projection.policy_snapshot?.policy.review.preset).toBe(
			"strict",
		);
		expect(amendWork(amendInput).allocation?.ledger.idempotent).toBe(true);
		const status = statusWork({ project_root: projectRoot, work_id: "wu_one" });
		expect(status.policy_drift).toMatchObject({
			drifted: true,
			policy_changed: true,
			revision_changed: false,
		});
	});

	it("classifies concurrent progress by requirement scope", () => {
		const record = (requirementId: string, eventId: string) =>
			({
				event_id: eventId,
				kind: "work_requirement_transitioned",
				payload: { requirement_id: requirementId },
			}) as never;
		expect(() =>
			assertProgressRetryIsAppendCompatible(
				[record("req_a", "evt_other")],
				"req_a",
				"evt_candidate",
			),
		).toThrow("concurrent Work requirement transition conflict");
		expect(() =>
			assertProgressRetryIsAppendCompatible(
				[record("req_b", "evt_other")],
				"req_a",
				"evt_candidate",
			),
		).not.toThrow();
	});

	it("fails closed on implementation entry while planning review evidence is unavailable", () => {
		const projectRoot = root();
		fs.writeFileSync(
			path.join(projectRoot, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "strict-transition" },
				tools: ["codex"],
				fragments: [],
				settings: { work_policy: { review: { preset: "strict" } } },
			}),
		);
		createWork(mutation(projectRoot));
		expect(() =>
			transitionWork(
				mutation(projectRoot, {
					event_id: "evt_strict_start",
					draft: Buffer.from(
						YAML.stringify({
							requirement_id: "req_a",
							status: "in_progress",
							evidence_refs: [],
						}),
					),
					source_stdin: undefined,
				}),
			),
		).toThrow("implementation entry is blocked");
		expect(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).projection
				.requirements[0]?.status,
		).toBe("pending");
	});

	it("derives cursor delta by folding the confirmed ledger prefix", () => {
		const projectRoot = root();
		createWork(mutation(projectRoot));
		const first = briefWork({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_delta",
			occurred_at: "2026-08-13T00:00:01.000Z",
		});
		confirmWorkBrief({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_delta",
			delivery_token: first.delivery_token,
			confirmed_at: "2026-08-13T00:00:02.000Z",
		});
		amendWork(
			mutation(projectRoot, {
				event_id: "evt_delta_amend",
				occurred_at: "2026-08-13T00:01:00.000Z",
				draft: contractDraft("src_delta", ["req_b"], "same_unit"),
				source_stdin: {
					...mutation(projectRoot).source_stdin!,
					event_id: "src_delta",
					body: Buffer.from("delta requirement"),
				},
			}),
		);
		const second = briefWork({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_delta",
			occurred_at: "2026-08-13T00:01:01.000Z",
		});
		expect(second.briefing.baseline_available).toBe(true);
		expect(second.briefing.delta.added_requirement_ids).toEqual(["req_b"]);
	});

	it("rejects ambiguous source input and drafts that omit the current source event", () => {
		const projectRoot = root();
		expect(() =>
			createWork({
				...mutation(projectRoot),
				source_file: mutation(projectRoot).source_stdin,
			}),
		).toThrow("exactly one");
		expect(() =>
			createWork({
				...mutation(projectRoot),
				draft: Buffer.from(
					YAML.stringify({
						work: { title: "x", completion_contract: "y" },
						boundary: {
							state: "accepted",
							classification: "new_unit",
							reason_codes: [],
							confidence: "high",
						},
						requirements: [
							{ id: "req_x", summary: "x", source_event_ids: ["src_other"] },
						],
						open_conflicts: [],
					}),
				),
			}),
		).toThrow("must reference the current source event");
	});

	it("keeps cursor integration behind a typed switch adapter seam", () => {
		const projectRoot = root();
		createWork(mutation(projectRoot));
		const result = switchWork(
			{
				project_root: projectRoot,
				work_id: "wu_one",
				cursor_id: "cursor_one",
				client_session_ref: "session-a",
				occurred_at: "2026-08-13T00:03:00.000Z",
			},
			{
				switchWork: (input) =>
					`${input.cursor_id}:${input.projection.contract_revision}`,
			},
		);
		expect(result).toBe("cursor_one:1");
	});
});
